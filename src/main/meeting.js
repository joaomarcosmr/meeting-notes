// Uma reunião gravada: recebe os segmentos de áudio enquanto a gravação acontece,
// transcreve em segundo plano e, ao final, gera e salva o resumo.

const fs = require('node:fs');
const path = require('node:path');
const { createTranscriptionQueue } = require('./queue');
const { joinSegments } = require('./transcript');
const { renderMarkdown } = require('./summary');
const { transcribeSegment, summarize } = require('./openai');

function folderStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}h${pad(date.getMinutes())}`;
}

function createMeeting({ settings, apiKey, onProgress }) {
  const startedAt = new Date();
  const folder = path.join(settings.notesDir, folderStamp(startedAt));
  const audioDir = path.join(folder, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });

  const queue = createTranscriptionQueue(
    (segment, previousText) =>
      transcribeSegment({
        apiKey,
        model: settings.transcriptionModel,
        language: settings.language,
        audio: fs.readFileSync(segment.file),
        fileName: path.basename(segment.file),
        previousText,
      }),
    { onProgress },
  );

  let transcript = null;
  let durationSec = 0;

  function addSegment({ index, startSec, data }) {
    const file = path.join(audioDir, `parte-${String(index + 1).padStart(3, '0')}.webm`);
    fs.writeFileSync(file, Buffer.from(data));
    queue.push({ index, startSec, file });
  }

  async function buildSummary() {
    const summary = await summarize({
      apiKey,
      model: settings.summaryModel,
      transcript,
      userName: settings.userName,
      startedAt,
    });
    const markdown = renderMarkdown(summary, { startedAt, durationSec });
    fs.writeFileSync(path.join(folder, 'resumo.md'), markdown);
    fs.writeFileSync(path.join(folder, 'resumo.json'), JSON.stringify(summary, null, 2));
    return { summary, markdown, folder };
  }

  async function finish(totalDurationSec) {
    durationSec = totalDurationSec;
    const segments = await queue.drain();
    if (!segments.length) throw new Error('Nenhum áudio foi gravado.');

    transcript = joinSegments(segments);
    fs.writeFileSync(path.join(folder, 'transcricao.md'), `# Transcrição\n\n${transcript}\n`);

    // Só apaga o áudio quando tudo foi transcrito: se algo falhou, ele fica para reprocessar.
    if (!settings.keepAudio && segments.every((s) => !s.error)) {
      fs.rmSync(audioDir, { recursive: true, force: true });
    }
    if (segments.every((s) => s.error)) {
      throw new Error(`Falha ao transcrever o áudio: ${segments[0].error}`);
    }
    return buildSummary();
  }

  // Se o resumo falhar (rede, chave, cota), a transcrição já está salva e dá para tentar de novo.
  function retrySummary() {
    if (!transcript) throw new Error('Ainda não há transcrição para resumir.');
    return buildSummary();
  }

  return { folder, startedAt, addSegment, finish, retrySummary, hasTranscript: () => Boolean(transcript) };
}

module.exports = { createMeeting };
