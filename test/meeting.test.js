// Pipeline completo contra um servidor fake da OpenAI (o SDK respeita OPENAI_BASE_URL).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SUMMARY = {
  titulo: 'Daily do time',
  resumo: 'Status da sprint.',
  topicos_discutidos: [{ topico: 'Deploy', pontos: ['Marcado para sexta'] }],
  decisoes: ['Congelar features na quinta'],
  tarefas: [{ descricao: 'Preparar release notes', responsavel: 'João', prazo: 'quinta', minha: true }],
  pontos_importantes: ['Cliente pediu demo'],
  o_que_voce_deve_saber: ['Você apresenta a demo'],
  perguntas_em_aberto: [],
};

function startFakeOpenAI() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ url: req.url, body });
      if (req.url.endsWith('/audio/transcriptions')) {
        const n = requests.filter((r) => r.url.endsWith('/audio/transcriptions')).length;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`fala do trecho ${n}`);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'x', object: 'chat.completion', created: 0, model: 'gpt-5',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(SUMMARY), refusal: null } }],
        }));
      }
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, requests })));
}

test('reunião: transcreve segmentos em ordem, resume e salva os arquivos', async () => {
  const { server, requests } = await startFakeOpenAI();
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  const { createMeeting } = require('../src/main/meeting');

  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-notes-'));
  const meeting = createMeeting({
    settings: {
      notesDir, language: 'pt', transcriptionModel: 'gpt-4o-transcribe',
      summaryModel: 'gpt-5', userName: 'João', keepAudio: false,
    },
    apiKey: 'sk-test',
    onProgress: () => {},
  });

  meeting.addSegment({ index: 0, startSec: 0, data: new Uint8Array([1, 2, 3]).buffer });
  meeting.addSegment({ index: 1, startSec: 300, data: new Uint8Array([4, 5, 6]).buffer });
  const result = await meeting.finish(600);
  server.close();

  const transcriptions = requests.filter((r) => r.url.endsWith('/audio/transcriptions'));
  assert.equal(transcriptions.length, 2);
  assert.match(transcriptions[0].body, /gpt-4o-transcribe/);
  assert.match(transcriptions[0].body, /name="language"\r\n\r\npt/);
  // o segundo trecho recebe o final do primeiro como contexto
  assert.match(transcriptions[1].body, /name="prompt"\r\n\r\nfala do trecho 1/);

  const chat = JSON.parse(requests.find((r) => r.url.endsWith('/chat/completions')).body);
  assert.equal(chat.model, 'gpt-5');
  assert.equal(chat.response_format.json_schema.strict, true);
  assert.match(chat.messages[1].content, /\[00:05:00\] fala do trecho 2/);

  assert.equal(result.summary.titulo, 'Daily do time');
  assert.equal(result.id, path.basename(result.folder));
  const files = fs.readdirSync(result.folder).sort();
  assert.deepEqual(files, ['meta.json', 'resumo.json', 'resumo.md', 'transcricao.md']); // áudio apagado
  assert.match(fs.readFileSync(path.join(result.folder, 'resumo.md'), 'utf8'), /\*\*\(minha\)\*\* Preparar release notes/);
  assert.match(fs.readFileSync(path.join(result.folder, 'transcricao.md'), 'utf8'), /\[00:00:00\] fala do trecho 1/);
});
