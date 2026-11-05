// Captura microfone + áudio do sistema, mistura em uma trilha só e grava em
// segmentos independentes (cada um é um .webm completo, com cabeçalho próprio),
// para que possam ser transcritos enquanto a reunião ainda acontece.

const MIME = 'audio/webm;codecs=opus';

export async function createRecorder({ segmentMinutes, captureSystemAudio, micDeviceId, onSegment, onWarning }) {
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

  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  for (const stream of [mic, display].filter(Boolean)) {
    const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    source.connect(destination);
    source.connect(analyser);
  }

  const segmentMs = segmentMinutes * 60 * 1000;
  const startedAt = performance.now();
  let index = 0;
  let current = null;
  let stopping = false;
  let timer = null;
  const pending = [];

  function startSegment() {
    const recorder = new MediaRecorder(destination.stream, { mimeType: MIME, audioBitsPerSecond: 32000 });
    const chunks = [];
    const segment = { index: index++, startSec: (performance.now() - startedAt) / 1000 };
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    const finished = new Promise((resolve) => {
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: MIME });
        if (blob.size) await onSegment({ ...segment, data: await blob.arrayBuffer() });
        resolve();
      };
    });
    pending.push(finished);
    recorder.start(1000);
    current = recorder;
    timer = setTimeout(rotate, segmentMs);
  }

  function rotate() {
    if (stopping) return;
    const previous = current;
    startSegment(); // começa o próximo antes de fechar o anterior: sem buraco entre segmentos
    previous.stop();
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
    if (current.state !== 'inactive') current.stop();
    await Promise.all(pending);
    [mic, display].filter(Boolean).forEach((s) => s.getTracks().forEach((t) => t.stop()));
    await context.close();
  }

  startSegment();
  return { stop, level, hasSystemAudio: Boolean(display) };
}
