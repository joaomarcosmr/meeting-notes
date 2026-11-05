// Histórico de reuniões salvo em disco. Cada reunião é uma pasta dentro de notesDir:
//   meta.json        { startedAt, durationSec }
//   resumo.json      resumo estruturado (+ `concluida` nas tarefas marcadas na interface)
//   resumo.md        o mesmo resumo em Markdown, regenerado a cada mudança
//   transcricao.md   transcrição com marcação de tempo

const fs = require('node:fs');
const path = require('node:path');
const { renderMarkdown } = require('./summary');

const TRANSCRIPT_HEADER = '# Transcrição\n\n';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// O id vem da interface: só aceitamos o nome de uma pasta direta de notesDir.
function meetingDir(notesDir, id) {
  if (typeof id !== 'string' || !id || id !== path.basename(id) || id.startsWith('.')) {
    throw new Error(`Reunião inválida: ${id}`);
  }
  return path.join(notesDir, id);
}

function readMeta(folder) {
  const meta = readJson(path.join(folder, 'meta.json')) || {};
  if (!meta.startedAt) meta.startedAt = fs.statSync(folder).birthtime.toISOString();
  return meta;
}

function saveMeta(folder, meta) {
  fs.writeFileSync(path.join(folder, 'meta.json'), JSON.stringify(meta, null, 2));
}

function saveSummary(folder, summary, meta = readMeta(folder)) {
  fs.writeFileSync(path.join(folder, 'resumo.json'), JSON.stringify(summary, null, 2));
  const markdown = renderMarkdown(summary, meta);
  fs.writeFileSync(path.join(folder, 'resumo.md'), markdown);
  return markdown;
}

function saveTranscript(folder, transcript) {
  fs.writeFileSync(path.join(folder, 'transcricao.md'), `${TRANSCRIPT_HEADER}${transcript}\n`);
}

function readTranscript(folder) {
  try {
    const text = fs.readFileSync(path.join(folder, 'transcricao.md'), 'utf8');
    return text.startsWith(TRANSCRIPT_HEADER) ? text.slice(TRANSCRIPT_HEADER.length).trimEnd() : text.trimEnd();
  } catch {
    return null;
  }
}

function searchText(summary) {
  if (!summary) return '';
  return [
    summary.titulo,
    summary.resumo,
    ...summary.tarefas.map((t) => `${t.descricao} ${t.responsavel || ''}`),
    ...summary.pontos_importantes,
    ...summary.o_que_voce_deve_saber,
    ...summary.decisoes,
    ...summary.topicos_discutidos.flatMap((t) => [t.topico, ...t.pontos]),
  ]
    .join(' ')
    .toLowerCase();
}

function listMeetings(notesDir) {
  if (!fs.existsSync(notesDir)) return [];
  return fs
    .readdirSync(notesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(({ name }) => {
      const folder = path.join(notesDir, name);
      const summary = readJson(path.join(folder, 'resumo.json'));
      const hasTranscript = fs.existsSync(path.join(folder, 'transcricao.md'));
      // Pasta sem resumo nem transcrição: gravação em andamento ou que não chegou a gerar nada.
      if (!summary && !hasTranscript) return null;
      const meta = readMeta(folder);
      const tasks = summary?.tarefas || [];
      return {
        id: name,
        titulo: summary?.titulo || 'Reunião sem resumo',
        resumo: summary?.resumo || '',
        startedAt: meta.startedAt,
        durationSec: meta.durationSec ?? null,
        hasSummary: Boolean(summary),
        tasksOpen: tasks.filter((t) => !t.concluida).length,
        myTasksOpen: tasks.filter((t) => t.minha && !t.concluida).length,
        searchText: searchText(summary),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function getMeeting(notesDir, id) {
  const folder = meetingDir(notesDir, id);
  if (!fs.existsSync(folder)) throw new Error('Essa reunião não existe mais.');
  let markdown = null;
  try {
    markdown = fs.readFileSync(path.join(folder, 'resumo.md'), 'utf8');
  } catch {
    // sem resumo ainda
  }
  return {
    id,
    folder,
    meta: readMeta(folder),
    summary: readJson(path.join(folder, 'resumo.json')),
    markdown,
    transcript: readTranscript(folder),
  };
}

// Mudanças feitas na interface: concluir a tarefa ou corrigir se ela é sua.
const EDITABLE_TASK_FIELDS = ['concluida', 'minha'];

function updateTask(notesDir, id, index, patch) {
  const folder = meetingDir(notesDir, id);
  const summary = readJson(path.join(folder, 'resumo.json'));
  const task = summary?.tarefas?.[index];
  if (!task) throw new Error('Tarefa não encontrada.');
  for (const field of EDITABLE_TASK_FIELDS) {
    if (field in patch) task[field] = Boolean(patch[field]);
  }
  saveSummary(folder, summary);
  return getMeeting(notesDir, id);
}

function listOpenTasks(notesDir) {
  return listMeetings(notesDir)
    .filter((m) => m.tasksOpen)
    .flatMap((m) => {
      const summary = readJson(path.join(notesDir, m.id, 'resumo.json'));
      return summary.tarefas
        .map((task, index) => ({ ...task, index, meetingId: m.id, meetingTitle: m.titulo, startedAt: m.startedAt }))
        .filter((task) => !task.concluida);
    });
}

module.exports = {
  meetingDir,
  readMeta,
  saveMeta,
  saveSummary,
  saveTranscript,
  readTranscript,
  listMeetings,
  getMeeting,
  updateTask,
  listOpenTasks,
};
