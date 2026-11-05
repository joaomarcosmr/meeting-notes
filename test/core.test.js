const test = require('node:test');
const assert = require('node:assert/strict');

const { commandToFlag, actionFromArgv } = require('../src/main/argv');
const { createTranscriptionQueue } = require('../src/main/queue');
const { formatClock, joinSegments, tailForPrompt } = require('../src/main/transcript');
const { SUMMARY_SCHEMA, buildMessages, renderMarkdown } = require('../src/main/summary');

test('argv: subcomando vira flag e flag vira ação', () => {
  assert.equal(commandToFlag(undefined), '--toggle');
  assert.equal(commandToFlag('stop'), '--stop');
  assert.throws(() => commandToFlag('explode'), /Comando desconhecido/);
  assert.equal(actionFromArgv(['/path/Electron', '.', '--start']), 'start');
  assert.equal(actionFromArgv(['/path/Electron', '.', '--inspect']), null);
});

test('queue: transcreve em ordem, passa o texto anterior e faz retry', async () => {
  const calls = [];
  let failuresLeft = 1;
  const transcribe = async (segment, previousText) => {
    calls.push({ index: segment.index, previousText });
    if (segment.index === 1 && failuresLeft-- > 0) throw new Error('timeout');
    return `texto ${segment.index}`;
  };
  const progress = [];
  const queue = createTranscriptionQueue(transcribe, { backoffMs: 1, onProgress: (p) => progress.push(p) });
  queue.push({ index: 0, startSec: 0 });
  queue.push({ index: 1, startSec: 300 });

  const results = await queue.drain();
  assert.deepEqual(results.map((r) => r.text), ['texto 0', 'texto 1']);
  assert.deepEqual(calls.map((c) => c.index), [0, 1, 1]);
  assert.equal(calls[1].previousText, 'texto 0');
  assert.deepEqual(progress.at(-1), { done: 2, total: 2 });
});

test('queue: falha definitiva vira lacuna sem derrubar o resto', async () => {
  const queue = createTranscriptionQueue(
    async (segment) => {
      if (segment.index === 0) throw new Error('413 arquivo grande');
      return 'ok';
    },
    { retries: 1, backoffMs: 1 },
  );
  queue.push({ index: 0, startSec: 0 });
  queue.push({ index: 1, startSec: 300 });
  const [first, second] = await queue.drain();
  assert.equal(first.error, '413 arquivo grande');
  assert.equal(second.text, 'ok');
});

test('transcript: marca tempo e lacunas', () => {
  assert.equal(formatClock(3725), '01:02:05');
  const text = joinSegments([
    { startSec: 0, text: ' Oi pessoal. ' },
    { startSec: 300, text: '', error: 'falhou' },
  ]);
  assert.equal(text, '[00:00:00] Oi pessoal.\n\n[00:05:00] (trecho não transcrito: falhou)');
  assert.equal(tailForPrompt('abcdef', 3), 'def');
  assert.equal(tailForPrompt('', 3), '');
});

test('summary: schema é estrito (todas as propriedades obrigatórias)', () => {
  const check = (schema) => {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
      Object.values(schema.properties).forEach(check);
    }
    if (schema.type === 'array') check(schema.items);
  };
  check(SUMMARY_SCHEMA);
});

test('summary: prompt inclui nome do usuário e transcrição', () => {
  const [system, user] = buildMessages('[00:00:00] fala', { userName: 'João' });
  assert.match(system.content, /"João"/);
  assert.match(user.content, /\[00:00:00\] fala/);
});

test('summary: markdown coloca minhas tarefas primeiro e trata seções vazias', () => {
  const md = renderMarkdown(
    {
      titulo: 'Sprint planning',
      resumo: 'Planejamos a sprint.',
      topicos_discutidos: [{ topico: 'Backlog', pontos: ['Priorizar login'] }],
      decisoes: [],
      tarefas: [
        { descricao: 'Revisar PR', responsavel: 'Ana', prazo: null, minha: false },
        { descricao: 'Subir deploy', responsavel: 'João', prazo: 'sexta', minha: true },
      ],
      pontos_importantes: ['Deploy congelado dia 20'],
      o_que_voce_deve_saber: [],
      perguntas_em_aberto: [],
    },
    { durationSec: 1800 },
  );
  assert.match(md, /^# Sprint planning\n_30 min_/);
  const mine = md.indexOf('**(minha)** Subir deploy — 👤 João · 📅 sexta');
  const other = md.indexOf('- [ ] Revisar PR — 👤 Ana');
  assert.ok(mine > 0 && other > mine);
  assert.match(md, /## 🤝 Decisões\n_Nada registrado._/);
  assert.match(md, /### Backlog\n- Priorizar login/);
});
