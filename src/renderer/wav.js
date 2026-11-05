// Utilitários de áudio sem dependências. O whisper.cpp não lê o .webm/opus do
// MediaRecorder, então cada trecho é convertido para WAV 16 kHz mono (o formato
// nativo do Whisper). O pico serve para pular trechos sem som nenhum.

export const WHISPER_SAMPLE_RATE = 16000;

// Abaixo disso (≈ -36 dBFS) o trecho é tratado como silêncio e não é transcrito.
export const SILENCE_PEAK = 0.015;

export function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

export function encodeWav(samples, sampleRate = WHISPER_SAMPLE_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // tamanho do bloco fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes por segundo
  view.setUint16(32, 2, true); // bytes por amostra
  view.setUint16(34, 16, true); // bits por amostra
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// Decodifica o trecho gravado e, se pedido, reamostra para 16 kHz mono em WAV.
export async function prepareSegment(context, blob, { toWav }) {
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE), WHISPER_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const mono = (await offline.startRendering()).getChannelData(0);

  const silent = peakOf(mono) < SILENCE_PEAK;
  if (silent || !toWav) return { silent, data: silent ? null : await blob.arrayBuffer(), format: 'webm' };
  return { silent, data: encodeWav(mono), format: 'wav' };
}
