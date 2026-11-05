const test = require('node:test');
const assert = require('node:assert/strict');

const { commandToFlag, actionFromArgv } = require('../src/main/argv');
const { createTranscriptionQueue } = require('../src/main/queue');
const { formatClock, buildTranscript, tailForPrompt } = require('../src/main/transcript');
const { SUMMARY_SCHEMA, buildMessages, renderMarkdown } = require('../src/main/summary');

test('argv: subcomando vira flag e flag vira ação', () => {
  assert.equal(commandToFlag(undefined), '--toggle');
  assert.equal(commandToFlag('stop'), '--stop');
  assert.throws(() => commandToFlag('explode'), /Comando desconhecido/);
  assert.equal(actionFromArgv(['/path/Electron', '.', '--start']), 'start');
  assert.equal(actionFromArgv(['/path/Electron', '.', '--inspect']), null);
});

const said = (text) => [{ start: 0, end: 1, speaker: null, text }];

test('queue: transcreve em ordem, passa o anterior da mesma trilha e faz retry', async () => {
  const calls = [];
  let failuresLeft = 1;
  const transcribe = async (segment, previous) => {
    calls.push({ key: `${segment.index}-${segment.source}`, previous: previous && `${previous.index}-${previous.source}` });
    if (segment.index === 1 && segment.source === 'mic' && failuresLeft-- > 0) throw new Error('timeout');
    return said(`texto ${segment.index} ${segment.source}`);
  };
  const progress = [];
  const queue = createTranscriptionQueue(transcribe, { backoffMs: 1, onProgress: (p) => progress.push(p) });
  queue.push({ index: 0, startSec: 0, source: 'mic' });
  queue.push({ index: 0, startSec: 0, source: 'system' });
  queue.push({ index: 1, startSec: 300, source: 'mic' });

  const results = await queue.drain();
  assert.deepEqual(results.map((r) => r.utterances[0].text), ['texto 0 mic', 'texto 0 system', 'texto 1 mic']);
  assert.deepEqual(calls.map((c) => c.key), ['0-mic', '0-system', '1-mic', '1-mic']);
  assert.equal(calls[1].previous, undefined); // primeira do sistema não herda do microfone
  assert.equal(calls[2].previous, '0-mic');
  assert.deepEqual(progress.at(-1), { done: 3, total: 3 });
});

test('queue: falha definitiva vira lacuna sem derrubar o resto', async () => {
  const queue = createTranscriptionQueue(
    async (segment) => {
      if (segment.index === 0) throw new Error('413 arquivo grande');
      return said('ok');
    },
    { retries: 1, backoffMs: 1 },
  );
  queue.push({ index: 0, startSec: 0, source: 'mic' });
  queue.push({ index: 1, startSec: 300, source: 'mic' });
  const [first, second] = await queue.drain();
  assert.equal(first.error, '413 arquivo grande');
  assert.deepEqual(first.utterances, []);
  assert.equal(second.utterances[0].text, 'ok');
});

test('transcript: microfone é "Você", sistema vira participantes, em ordem de tempo', () => {
  const text = buildTranscript([
    { index: 0, startSec: 0, source: 'mic', utterances: [
      { start: 3, end: 5, speaker: 'A', text: 'Deixa que eu mando a proposta.' },
      { start: 5.5, end: 7, speaker: 'A', text: 'Até sexta.' },
    ] },
    { index: 0, startSec: 0, source: 'system', utterances: [
      { start: 1, end: 2.5, speaker: 'A', text: 'Quem manda a proposta?' },
      { start: 8, end: 9, speaker: 'B', text: 'Fechado.' },
      { start: 9.5, end: 10, speaker: 'B', text: '   ' },
    ] },
    { index: 1, startSec: 300, source: 'system', utterances: [], error: 'falhou' },
  ]);
  assert.equal(text, [
    '[00:00:01] Participante A: Quem manda a proposta?',
    '[00:00:03] Você: Deixa que eu mando a proposta. Até sexta.',
    '[00:00:08] Participante B: Fechado.',
    '[00:05:00] (trecho do áudio do sistema não transcrito: falhou)',
  ].join('\n\n'));
});

test('transcript: só microfone (sem áudio do sistema) não presume quem é você', () => {
  const text = buildTranscript([
    { index: 0, startSec: 0, source: 'mic', utterances: [
      { start: 0, end: 1, speaker: 'A', text: 'Oi.' },
      { start: 2, end: 3, speaker: 'B', text: 'Olá.' },
    ] },
  ]);
  assert.equal(text, '[00:00:00] Pessoa A: Oi.\n\n[00:00:02] Pessoa B: Olá.');
  // modelo sem diarização: bloco sem falante
  assert.equal(buildTranscript([{ index: 0, startSec: 60, source: 'mic', utterances: said('Tudo certo.') }]), '[00:01:00] Tudo certo.');
  assert.equal(formatClock(3725), '01:02:05');
  assert.equal(tailForPrompt('abcdef', 3), 'def');
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

test('summary: prompt explica quem é "Você" e inclui nome e transcrição', () => {
  const [system, user] = buildMessages('[00:00:00] fala', { userName: 'João' });
  assert.match(system.content, /"Você" é o usuário do app \(João\)/);
  assert.match(system.content, /pelo nome "João"/);
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
