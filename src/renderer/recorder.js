// Captura microfone e áudio do sistema e grava cada um na sua trilha: o
// microfone é você, o sistema são os outros, e é isso que permite saber quem
// disse o quê. As duas trilhas são cortadas juntas em segmentos independentes
// (cada um é um .webm completo, com cabeçalho próprio), para que possam ser
// transcritos enquanto a reunião ainda acontece.

import { prepareSegment } from './wav.js';

const MIME = 'audio/webm;codecs=opus';

// `toWav`: a transcrição local (whisper.cpp) precisa de WAV; a da OpenAI aceita o .webm, menor.
export async function createRecorder({ segmentMinutes, captureSystemAudio, micDeviceId, toWav, onSegment, onWarning }) {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: micDeviceId && micDeviceId !== 'default' ? { exact: micDeviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  let display = null;
  if (captureSystemAudio) {
    try {
      // O vídeo é exigido pelo getDisplayMedia, mas não é usado. Ele pode ficar
      // pendurado para sempre (permissão de tela), então não pode segurar a gravação.
      const request = navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: 1, height: 1, frameRate: 1 },
      });
      display = await Promise.race([
        request,
        new Promise((_, reject) => setTimeout(() => reject(new Error('o macOS não respondeu')), 4000)),
      ]).catch((error) => {
        request.then((late) => late.getTracks().forEach((t) => t.stop())).catch(() => {});
        throw error;
      });
      const [systemTrack] = display.getAudioTracks();
      // Sem permissão o macOS entrega uma trilha já encerrada, sem erro nenhum.
      if (!systemTrack || systemTrack.readyState === 'ended') {
        onWarning('Sem áudio do sistema: gravando só o microfone. Libere "Gravação de tela e áudio do sistema" em Ajustes › Privacidade.');
        display.getTracks().forEach((t) => t.stop());
        display = null;
      }
    } catch (error) {
      onWarning(`Sem áudio do sistema (${error.message}). Gravando só o microfone.`);
      display = null;
    }
  }

  // O AudioContext serve só para o medidor de volume; a gravação usa as trilhas originais.
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const lanes = [
    { source: 'mic', stream: new MediaStream(mic.getAudioTracks()) },
    display && { source: 'system', stream: new MediaStream(display.getAudioTracks()) },
  ].filter(Boolean);
  for (const lane of lanes) context.createMediaStreamSource(lane.stream).connect(analyser);

  const segmentMs = segmentMinutes * 60 * 1000;
  const startedAt = performance.now();
  let index = 0;
  let current = [];
  let stopping = false;
  let timer = null;
  const pending = [];

  function recordLane(lane, segment) {
    const recorder = new MediaRecorder(lane.stream, { mimeType: MIME, audioBitsPerSecond: 32000 });
    const chunks = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    pending.push(
      new Promise((resolve) => {
        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: MIME });
          try {
            // Trecho sem som nenhum (ex.: ninguém falou na call) não vale transcrição nem custo.
            const prepared = blob.size ? await prepareSegment(context, blob, { toWav }) : { silent: true };
            if (!prepared.silent) {
              await onSegment({ ...segment, source: lane.source, data: prepared.data, format: prepared.format });
            }
          } catch (error) {
            // Não perde o áudio: manda o original (fica salvo em disco mesmo que a transcrição falhe).
            onWarning(`Falha ao converter um trecho de áudio: ${error.message}`);
            await onSegment({ ...segment, source: lane.source, data: await blob.arrayBuffer(), format: 'webm' });
          }
          resolve();
        };
      }),
    );
    recorder.start(1000);
    return recorder;
  }

  function startSegment() {
    const segment = { index: index++, startSec: (performance.now() - startedAt) / 1000 };
    current = lanes.map((lane) => recordLane(lane, segment));
    timer = setTimeout(rotate, segmentMs);
  }

  function rotate() {
    if (stopping) return;
    const previous = current;
    startSegment(); // começa o próximo antes de fechar o anterior: sem buraco entre segmentos
    previous.forEach((recorder) => recorder.stop());
  }

  function level() {
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    return peak;
  }

  async function stop() {
    stopping = true;
    clearTimeout(timer);
    current.filter((r) => r.state !== 'inactive').forEach((r) => r.stop());
    await Promise.all(pending);
    [mic, display].filter(Boolean).forEach((s) => s.getTracks().forEach((t) => t.stop()));
    await context.close();
  }

  startSegment();
  return { stop, level, hasSystemAudio: Boolean(display) };
}
