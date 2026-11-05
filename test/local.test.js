const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const local = require('../src/main/local-whisper');
const { buildTranscript } = require('../src/main/transcript');

test('local: acha o whisper-cli no caminho configurado ou no Homebrew', () => {
  const only = (file) => (candidate) => candidate === file;
  assert.equal(local.findWhisperCli('', only('/opt/homebrew/bin/whisper-cli')), '/opt/homebrew/bin/whisper-cli');
  assert.equal(local.findWhisperCli('/meu/whisper', only('/meu/whisper')), '/meu/whisper');
  assert.equal(local.findWhisperCli('', () => false), null);
});

test('local: status diz o que falta e só fica pronto com cli + modelo', () => {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'models-'));
  const status = local.localStatus({ whisperCliPath: '/nao/existe', modelsDir });
  assert.equal(status.model.present, false);
  assert.equal(status.model.size, 1624555275);
  if (!status.cli) {
    assert.equal(status.ready, false);
    assert.deepEqual(local.missingSteps(status), [
      'instale o whisper.cpp com "brew install whisper-cpp"',
      'baixe o modelo de transcrição nas Configurações',
    ]);
  }
  fs.writeFileSync(path.join(modelsDir, 'ggml-large-v3-turbo.bin'), 'x');
  assert.equal(local.localStatus({ whisperCliPath: '', modelsDir }).model.present, true);
});

test('local: argumentos do whisper-cli com VAD e prompt opcionais', () => {
  const base = { modelFile: 'm.bin', language: 'pt', audioFile: 'a.wav', outBase: '/tmp/out', threads: 4 };
  assert.deepEqual(local.buildArgs(base), ['-m', 'm.bin', '-f', 'a.wav', '-l', 'pt', '-oj', '-of', '/tmp/out', '-np', '-sns', '-t', '4']);
  const full = local.buildArgs({ ...base, vadFile: 'vad.bin', prompt: 'contexto', language: '' });
  assert.deepEqual(full.slice(4, 6), ['-l', 'auto']);
  assert.deepEqual(full.slice(-5), ['--vad', '-vm', 'vad.bin', '--prompt', 'contexto']);
});

test('local: lê o JSON do whisper.cpp e descarta alucinações de silêncio', () => {
  const utterances = local.parseWhisperJson({
    transcription: [
      { offsets: { from: 1200, to: 3400 }, text: ' Deixa que eu mando a proposta.' },
      { offsets: { from: 3400, to: 5000 }, text: ' Legendas pela comunidade Amara.org' },
      { offsets: { from: 5000, to: 6000 }, text: '   ' },
      { offsets: { from: 6000, to: 7000 }, text: ' Obrigado por assistir!' },
    ],
  });
  assert.deepEqual(utterances, [{ start: 1.2, end: 3.4, speaker: null, text: 'Deixa que eu mando a proposta.' }]);

  // sem diarização: microfone continua "Você" e o sistema vira "Participante"
  const transcript = buildTranscript([
    { index: 0, startSec: 0, source: 'mic', utterances },
    { index: 0, startSec: 0, source: 'system', utterances: [{ start: 0, end: 1, speaker: null, text: 'Quem manda?' }] },
  ]);
  assert.equal(transcript, '[00:00:00] Participante: Quem manda?\n\n[00:00:01] Você: Deixa que eu mando a proposta.');
});

test('wav: cabeçalho PCM 16 kHz mono e pico', async () => {
  const { encodeWav, peakOf, WHISPER_SAMPLE_RATE } = await import('../src/renderer/wav.js');
  const samples = new Float32Array([0, 0.5, -1, 1.5]);
  const view = new DataView(encodeWav(samples));
  const text = (offset) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)));
  assert.equal(text(0), 'RIFF');
  assert.equal(text(8), 'WAVE');
  assert.equal(view.getUint16(22, true), 1); // mono
  assert.equal(view.getUint32(24, true), WHISPER_SAMPLE_RATE);
  assert.equal(view.getUint32(40, true), samples.length * 2);
  assert.equal(view.byteLength, 44 + samples.length * 2);
  assert.deepEqual([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true)), [0, 16383, -32768, 32767]);
  assert.equal(peakOf(samples), 1.5);
});
