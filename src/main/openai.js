const { OpenAI, toFile } = require('openai');
const { SUMMARY_SCHEMA, buildMessages } = require('./summary');
const { tailForPrompt } = require('./transcript');

function client(apiKey) {
  if (!apiKey) throw new Error('Configure sua chave da OpenAI nas Configurações.');
  return new OpenAI({ apiKey, timeout: 5 * 60 * 1000, maxRetries: 2 });
}

async function transcribeSegment({ apiKey, model, language, audio, fileName, previousText }) {
  const response = await client(apiKey).audio.transcriptions.create({
    file: await toFile(audio, fileName, { type: 'audio/webm' }),
    model,
    language: language || undefined,
    prompt: tailForPrompt(previousText) || undefined,
    response_format: 'text',
  });
  // Com response_format 'text' o SDK devolve string; mantemos o fallback por segurança.
  return typeof response === 'string' ? response : response.text;
}

async function summarize({ apiKey, model, transcript, userName, startedAt }) {
  const completion = await client(apiKey).chat.completions.create({
    model,
    messages: buildMessages(transcript, { userName, startedAt }),
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'meeting_summary', strict: true, schema: SUMMARY_SCHEMA },
    },
  });
  const message = completion.choices[0].message;
  if (message.refusal) throw new Error(`A IA recusou o pedido: ${message.refusal}`);
  return JSON.parse(message.content);
}

module.exports = { transcribeSegment, summarize };
