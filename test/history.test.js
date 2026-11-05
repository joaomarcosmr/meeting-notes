const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const history = require('../src/main/history');

const summary = (titulo, tarefas) => ({
  titulo,
  resumo: `Resumo de ${titulo}`,
  topicos_discutidos: [{ topico: 'Orçamento', pontos: ['Cortar 10%'] }],
  decisoes: [],
  tarefas,
  pontos_importantes: [],
  o_que_voce_deve_saber: [],
  perguntas_em_aberto: [],
});

function fixture() {
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'));
  const add = (id, startedAt, data, transcript = 'oi') => {
    const folder = path.join(notesDir, id);
    fs.mkdirSync(folder);
    history.saveMeta(folder, { startedAt, durationSec: 1200 });
    if (transcript) history.saveTranscript(folder, transcript);
    if (data) history.saveSummary(folder, data);
  };
  add('antiga', '2026-10-01T10:00:00.000Z', summary('Kickoff', [
    { descricao: 'Mandar proposta', responsavel: 'João', prazo: null, minha: true },
  ]));
  add('nova', '2026-11-03T10:00:00.000Z', summary('Daily', [
    { descricao: 'Revisar PR', responsavel: 'Ana', prazo: null, minha: false },
    { descricao: 'Subir deploy', responsavel: 'João', prazo: 'sexta', minha: true },
  ]));
  add('sem-resumo', '2026-11-02T10:00:00.000Z', null, '[00:00:00] conversa');
  fs.mkdirSync(path.join(notesDir, 'gravando-agora', 'audio'), { recursive: true });
  return notesDir;
}

test('history: lista da mais nova para a mais antiga e ignora gravação em andamento', () => {
  const list = history.listMeetings(fixture());
  assert.deepEqual(list.map((m) => m.id), ['nova', 'sem-resumo', 'antiga']);
  assert.equal(list[0].tasksOpen, 2);
  assert.equal(list[0].myTasksOpen, 1);
  assert.equal(list[1].hasSummary, false);
  assert.match(list[2].searchText, /mandar proposta/);
  assert.match(list[2].searchText, /orçamento/);
});

test('history: marcar tarefa atualiza json, markdown e contadores', () => {
  const notesDir = fixture();
  const meeting = history.setTaskDone(notesDir, 'nova', 1, true);
  assert.equal(meeting.summary.tarefas[1].concluida, true);
  assert.match(meeting.markdown, /- \[x\] \*\*\(minha\)\*\* Subir deploy/);
  assert.equal(history.listMeetings(notesDir)[0].myTasksOpen, 0);

  const open = history.listOpenTasks(notesDir);
  assert.deepEqual(open.map((t) => [t.meetingId, t.index, t.descricao]), [
    ['nova', 0, 'Revisar PR'],
    ['antiga', 0, 'Mandar proposta'],
  ]);
});

test('history: lê transcrição sem o cabeçalho e recusa ids fora da pasta', () => {
  const notesDir = fixture();
  assert.equal(history.getMeeting(notesDir, 'sem-resumo').transcript, '[00:00:00] conversa');
  assert.equal(history.getMeeting(notesDir, 'sem-resumo').summary, null);
  assert.throws(() => history.getMeeting(notesDir, '../etc'), /inválida/);
  assert.throws(() => history.setTaskDone(notesDir, 'nova', 9, true), /não encontrada/);
});
