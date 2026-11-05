// Uma reunião gravada: recebe os segmentos de áudio enquanto a gravação acontece,
// transcreve em segundo plano e, ao final, gera e salva o resumo.

const fs = require('node:fs');
const path = require('node:path');
const { createTranscriptionQueue } = require('./queue');
const { buildTranscript } = require('./transcript');
const { transcribeSegment, summarize } = require('./openai');
const { transcribeLocal } = require('./local-whisper');
const { saveMeta, saveSummary, saveTranscript, readTranscript } = require('./history');

function folderStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}h${pad(date.getMinutes())}`;
}

// Gera o resumo de uma pasta que já tem transcrição. Usado no fim da gravação e
// para resumir de novo uma reunião antiga (ex.: o resumo falhou por falta de cota).
async function summarizeFolder({ folder, settings, apiKey, meta }) {
  const transcript = readTranscript(folder);
  if (!transcript) throw new Error('Essa reunião não tem transcrição para resumir.');
  const summary = await summarize({
    apiKey,
    model: settings.summaryModel,
    transcript,
    userName: settings.userName,
    startedAt: meta.startedAt,
  });
  const markdown = saveSummary(folder, summary, meta);
  return { id: path.basename(folder), summary, markdown, folder };
}

// `local`: { cli, modelsDir } quando a transcrição é feita pelo whisper.cpp no Mac.
function createMeeting({ settings, apiKey, local, onProgress }) {
  const startedAt = new Date();
  let folder = path.join(settings.notesDir, folderStamp(startedAt));
  // Duas gravações no mesmo minuto não podem cair na mesma pasta.
  for (let n = 2; fs.existsSync(folder); n++) folder = path.join(settings.notesDir, `${folderStamp(startedAt)} (${n})`);
  const audioDir = path.join(folder, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const meta = { startedAt: startedAt.toISOString(), durationSec: null };
  saveMeta(folder, meta);

  const queue = createTranscriptionQueue((segment, previous) => {
    const previousText = previous?.utterances.map((u) => u.text).join(' ');
    if (local) {
      return transcribeLocal({ ...local, language: settings.language, audioFile: segment.file, previousText });
    }
    return transcribeSegment({
      apiKey,
      model: settings.transcriptionModel,
      language: settings.language,
      audio: fs.readFileSync(segment.file),
      fileName: path.basename(segment.file),
      previousText,
    });
  }, { onProgress });

  let transcribed = false;

  // Cada trecho chega duas vezes: uma do microfone (você) e outra do áudio do sistema (os outros).
  function addSegment({ index, startSec, source = 'mic', format = 'webm', data }) {
    const file = path.join(audioDir, `parte-${String(index + 1).padStart(3, '0')}-${source}.${format}`);
    fs.writeFileSync(file, Buffer.from(data));
    queue.push({ index, startSec, source, file });
  }

  async function finish(totalDurationSec) {
    meta.durationSec = Math.round(totalDurationSec);
    saveMeta(folder, meta);
    const segments = await queue.drain();
    if (!segments.length) {
      fs.rmSync(folder, { recursive: true, force: true });
      throw new Error('Não detectei nenhuma fala na gravação.');
    }

    saveTranscript(folder, buildTranscript(segments));
    transcribed = true;

    // Só apaga o áudio quando tudo foi transcrito: se algo falhou, ele fica para reprocessar.
    if (!settings.keepAudio && segments.every((s) => !s.error)) {
      fs.rmSync(audioDir, { recursive: true, force: true });
    }
    if (segments.every((s) => s.error)) {
      throw new Error(`Falha ao transcrever o áudio: ${segments[0].error}`);
    }
    return summarizeFolder({ folder, settings, apiKey, meta });
  }

  // Se o resumo falhar (rede, chave, cota), a transcrição já está salva e dá para tentar de novo.
  function retrySummary() {
    return summarizeFolder({ folder, settings, apiKey, meta });
  }

  return { folder, startedAt, addSegment, finish, retrySummary, hasTranscript: () => transcribed };
}

module.exports = { createMeeting, summarizeFolder };
