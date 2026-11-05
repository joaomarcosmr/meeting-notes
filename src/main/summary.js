// Contrato do resumo: o JSON Schema enviado à OpenAI (Structured Outputs) e a
// renderação em Markdown que é salva em disco / copiada para o clipboard.

const stringList = { type: 'array', items: { type: 'string' } };
const nullableString = { type: ['string', 'null'] };

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'titulo',
    'resumo',
    'topicos_discutidos',
    'decisoes',
    'tarefas',
    'pontos_importantes',
    'o_que_voce_deve_saber',
    'perguntas_em_aberto',
  ],
  properties: {
    titulo: { type: 'string', description: 'Título curto que identifica a reunião.' },
    resumo: { type: 'string', description: 'Resumo executivo em 2 a 4 frases.' },
    topicos_discutidos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topico', 'pontos'],
        properties: { topico: { type: 'string' }, pontos: stringList },
      },
    },
    decisoes: stringList,
    tarefas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['descricao', 'responsavel', 'prazo', 'minha'],
        properties: {
          descricao: { type: 'string' },
          responsavel: nullableString,
          prazo: nullableString,
          minha: { type: 'boolean', description: 'true se a tarefa é do usuário do app.' },
        },
      },
    },
    pontos_importantes: stringList,
    o_que_voce_deve_saber: stringList,
    perguntas_em_aberto: stringList,
  },
};

function buildMessages(transcript, { userName, startedAt } = {}) {
  const name = userName ? ` (${userName})` : '';
  const system = [
    'Você é um assistente que transforma transcrições de reuniões em notas objetivas, em português do Brasil.',
    'A transcrição foi gerada automaticamente e pode ter erros. Cada fala vem com quem falou:',
    `- "Você" é o usuário do app${name}: é o microfone dele, então tudo que "Você" diz foi dito por ele.`,
    '- "Participante A", "Participante B"... são as outras pessoas da call. As letras são atribuídas a cada bloco de 5 minutos e podem mudar entre blocos: use-as para separar falas próximas, não para identificar alguém ao longo da reunião inteira.',
    '- "Pessoa A", "Pessoa B"... aparecem quando só o microfone foi gravado: aí não se sabe qual delas é o usuário.',
    '- Se "Você" repete quase igual a fala de um participante no mesmo instante, é eco da caixa de som captado pelo microfone: atribua a fala ao participante.',
    'Regras:',
    '- Escreva bullets curtos e concretos; nada de enrolação.',
    '- "tarefas": só o que alguém se comprometeu ou foi pedido a fazer. Inclua responsável e prazo quando mencionados, senão null. Use "Você" como responsável quando for o usuário.',
    `- "minha": true quando a tarefa é do usuário: "Você" se comprometeu ("eu faço", "deixa comigo", "vou ver isso"), aceitou um pedido, ou alguém atribuiu a ele${userName ? ` (pelo nome "${userName}" ou falando diretamente com ele)` : ''}.`,
    '- "decisoes": o que foi efetivamente decidido/acordado.',
    '- "pontos_importantes": números, riscos, mudanças, dependências e informações que não podem se perder.',
    '- "o_que_voce_deve_saber": contexto que o usuário precisa para agir depois da reunião (impactos para ele, alertas, próximos passos dele).',
    '- "perguntas_em_aberto": dúvidas levantadas que ficaram sem resposta.',
    '- Nunca invente informação que não está na transcrição. Se uma seção não tiver conteúdo, deixe a lista vazia.',
  ].join('\n');

  const when = startedAt ? `Data da reunião: ${new Date(startedAt).toLocaleString('pt-BR')}\n\n` : '';
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${when}Transcrição:\n\n${transcript}` },
  ];
}

function bullets(items) {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '_Nada registrado._';
}

function taskLine(task) {
  const meta = [task.responsavel && `👤 ${task.responsavel}`, task.prazo && `📅 ${task.prazo}`]
    .filter(Boolean)
    .join(' · ');
  return `- [${task.concluida ? 'x' : ' '}] ${task.minha ? '**(minha)** ' : ''}${task.descricao}${meta ? ` — ${meta}` : ''}`;
}

function renderMarkdown(summary, { startedAt, durationSec } = {}) {
  const header = [`# ${summary.titulo}`];
  const meta = [];
  if (startedAt) meta.push(new Date(startedAt).toLocaleString('pt-BR'));
  if (durationSec) meta.push(`${Math.round(durationSec / 60)} min`);
  if (meta.length) header.push(`_${meta.join(' · ')}_`);

  const topics = summary.topicos_discutidos.length
    ? summary.topicos_discutidos.map((t) => `### ${t.topico}\n${bullets(t.pontos)}`).join('\n\n')
    : '_Nada registrado._';

  // Tarefas do usuário primeiro: é o que ele mais precisa ver.
  const tasks = [...summary.tarefas].sort((a, b) => Number(b.minha) - Number(a.minha));

  return [
    header.join('\n'),
    `## Resumo\n${summary.resumo}`,
    `## ✅ Tarefas\n${tasks.length ? tasks.map(taskLine).join('\n') : '_Nenhuma tarefa._'}`,
    `## ⭐ Pontos importantes\n${bullets(summary.pontos_importantes)}`,
    `## 💡 O que você deve saber\n${bullets(summary.o_que_voce_deve_saber)}`,
    `## 🤝 Decisões\n${bullets(summary.decisoes)}`,
    `## 💬 O que foi discutido\n${topics}`,
    `## ❓ Perguntas em aberto\n${bullets(summary.perguntas_em_aberto)}`,
  ].join('\n\n') + '\n';
}

module.exports = { SUMMARY_SCHEMA, buildMessages, renderMarkdown };
