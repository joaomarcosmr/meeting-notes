// Transcrição local com whisper.cpp (`brew install whisper-cpp`): grátis, offline
// e o áudio não sai do Mac. Não separa os participantes entre si, mas como o
// microfone e o sistema são trilhas diferentes, "Você" continua identificado.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { tailForPrompt } = require('./transcript');

const MODELS = {
  // Melhor equilíbrio qualidade/velocidade; roda com Metal nos chips Apple.
  model: {
    file: 'ggml-large-v3-turbo.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
    size: 1624555275,
  },
  // Detector de voz: pula os silêncios, onde o Whisper costuma inventar frases.
  vad: {
    file: 'ggml-silero-v6.2.0.bin',
    url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin',
    size: 885098,
  },
};

// O app aberto pelo Finder não herda o PATH do terminal: procuramos nos lugares do Homebrew.
const CLI_CANDIDATES = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'];

function findWhisperCli(customPath, exists = isExecutable) {
  return [customPath, ...CLI_CANDIDATES].find((candidate) => candidate && exists(candidate)) || null;
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function modelPath(modelsDir, kind) {
  return path.join(modelsDir, MODELS[kind].file);
}

function localStatus({ whisperCliPath, modelsDir }) {
  const cli = findWhisperCli(whisperCliPath);
  const model = modelPath(modelsDir, 'model');
  const vad = modelPath(modelsDir, 'vad');
  const status = {
    cli,
    model: { path: model, present: fs.existsSync(model), size: MODELS.model.size },
    vad: { path: vad, present: fs.existsSync(vad), size: MODELS.vad.size },
  };
  status.ready = Boolean(cli && status.model.present);
  return status;
}

function missingSteps(status) {
  const steps = [];
  if (!status.cli) steps.push('instale o whisper.cpp com "brew install whisper-cpp"');
  if (!status.model.present) steps.push('baixe o modelo de transcrição nas Configurações');
  return steps;
}

function buildArgs({ modelFile, vadFile, language, audioFile, outBase, prompt, threads }) {
  const args = ['-m', modelFile, '-f', audioFile, '-l', language || 'auto', '-oj', '-of', outBase, '-np', '-sns', '-t', String(threads)];
  if (vadFile) args.push('--vad', '-vm', vadFile);
  if (prompt) args.push('--prompt', prompt);
  return args;
}

// Frases que o Whisper "alucina" em trechos sem fala (vêm dos dados de treino, legendas de vídeo).
const HALLUCINATIONS = [
  /legendas? (pela|por) comunidade amara\.org/i,
  /^\s*(obrigad[oa] por assistir|inscreva-se no canal)[.!]*\s*$/i,
  /^\s*\[(música|musica|silêncio|silencio|aplausos)\]\s*$/i,
];

function parseWhisperJson(json) {
  return (json.transcription || [])
    .map((item) => ({
      start: item.offsets.from / 1000,
      end: item.offsets.to / 1000,
      speaker: null,
      text: item.text.trim(),
    }))
    .filter((u) => u.text && !HALLUCINATIONS.some((pattern) => pattern.test(u.text)));
}

async function transcribeLocal({ cli, modelsDir, language, audioFile, previousText }) {
  const outBase = path.join(os.tmpdir(), `meeting-notes-${process.pid}-${Date.now()}`);
  const vadFile = modelPath(modelsDir, 'vad');
  const args = buildArgs({
    modelFile: modelPath(modelsDir, 'model'),
    vadFile: fs.existsSync(vadFile) ? vadFile : null,
    language,
    audioFile,
    outBase,
    prompt: tailForPrompt(previousText),
    // Deixa núcleos livres para a reunião (a call) continuar fluida.
    threads: Math.max(2, Math.floor(os.cpus().length / 2)),
  });

  await new Promise((resolve, reject) => {
    execFile(cli, args, { maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`whisper.cpp falhou: ${(stderr || error.message).trim().split('\n').pop()}`));
      else resolve();
    });
  });

  const jsonFile = `${outBase}.json`;
  try {
    return parseWhisperJson(JSON.parse(fs.readFileSync(jsonFile, 'utf8')));
  } finally {
    fs.rmSync(jsonFile, { force: true });
  }
}

// Baixa um modelo para modelsDir, com progresso. Grava em .part e só renomeia
// no fim, para um download interrompido nunca parecer um modelo válido.
async function downloadModel({ kind, modelsDir, onProgress = () => {} }) {
  const { url, size } = MODELS[kind];
  const target = modelPath(modelsDir, kind);
  const partial = `${target}.part`;
  fs.mkdirSync(modelsDir, { recursive: true });

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download falhou: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || size;
  let received = 0;
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    onProgress({ kind, received, total });
  });
  await pipeline(body, fs.createWriteStream(partial));
  if (received !== total) throw new Error('Download incompleto, tente de novo.');
  fs.renameSync(partial, target);
  return target;
}

module.exports = {
  MODELS,
  findWhisperCli,
  localStatus,
  missingSteps,
  buildArgs,
  parseWhisperJson,
  transcribeLocal,
  downloadModel,
};
