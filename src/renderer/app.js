import { createRecorder } from './recorder.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['empty', 'recording', 'processing', 'meeting', 'tasks', 'error', 'settings'];

let recorder = null;
let phase = 'idle';
let startedAt = null;
let tickTimer = null;
let currentView = 'empty';
let viewBeforeSettings = 'empty';
let meetings = [];
let selected = null; // reunião aberta: { id, summary, markdown, transcript, meta, folder }

function show(view) {
  currentView = view;
  for (const name of VIEWS) $(`view-${name}`).hidden = name !== view;
  $('nav-tasks').classList.toggle('active', view === 'tasks');
  if (view !== 'meeting') selected = null;
  renderList();
}

function banner(message) {
  $('banner').textContent = message || '';
  $('banner').hidden = !message;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function clock(totalSeconds) {
  const s = Math.floor(totalSeconds);
  return [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');
}

function formatWhen(iso, durationSec) {
  const date = new Date(iso);
  const parts = [date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })];
  parts.push(date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
  if (durationSec) parts.push(`${Math.max(1, Math.round(durationSec / 60))} min`);
  return parts.join(' · ');
}

function dayGroup(iso) {
  const date = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today - new Date(date).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  if (days < 7) return 'Últimos 7 dias';
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

// ---- Barra lateral --------------------------------------------------------

async function refreshHistory() {
  meetings = await window.api.listMeetings();
  const myOpen = meetings.reduce((sum, m) => sum + m.myTasksOpen, 0);
  $('tasks-count').textContent = myOpen || '';
  renderList();
  if (currentView === 'tasks') renderTasks();
}

function renderList() {
  const query = $('search').value.trim().toLowerCase();
  const visible = query
    ? meetings.filter((m) => m.searchText.includes(query) || m.titulo.toLowerCase().includes(query))
    : meetings;

  const list = $('meeting-list');
  list.replaceChildren();
  if (!visible.length) {
    list.append(el('p', query ? 'Nada encontrado.' : 'Suas reuniões aparecem aqui.', 'muted small empty-list'));
    return;
  }

  let group = null;
  for (const meeting of visible) {
    const label = dayGroup(meeting.startedAt);
    if (label !== group) {
      group = label;
      list.append(el('h4', label));
    }
    const item = el('button', undefined, 'meeting-item');
    if (selected?.id === meeting.id) item.classList.add('active');
    item.append(el('span', meeting.titulo, 'title'));
    const meta = el('span', formatWhen(meeting.startedAt, meeting.durationSec), 'meta');
    if (!meeting.hasSummary) meta.append(el('b', ' · sem resumo', 'warn'));
    else if (meeting.tasksOpen) meta.append(el('b', ` · ${meeting.tasksOpen} tarefa${meeting.tasksOpen > 1 ? 's' : ''}`));
    item.append(meta);
    item.addEventListener('click', () => openMeeting(meeting.id));
    list.append(item);
  }
}

$('search').addEventListener('input', renderList);
document.addEventListener('keydown', (event) => {
  if (event.metaKey && event.key === 'f') {
    event.preventDefault();
    $('search').focus();
  }
});

// ---- Reunião aberta -------------------------------------------------------

async function openMeeting(id, tab = 'summary') {
  try {
    const meeting = await window.api.getMeeting(id);
    show('meeting');
    selected = meeting;
    renderMeeting(tab);
    renderList();
  } catch (error) {
    banner(error.message);
    await refreshHistory();
  }
}

function renderMeeting(tab) {
  const { summary, meta, transcript } = selected;
  $('meeting-title').textContent = summary?.titulo || 'Reunião sem resumo';
  $('meeting-meta').textContent = formatWhen(meta.startedAt, meta.durationSec);
  $('copy-button').hidden = !selected.markdown;

  const root = $('meeting-summary');
  root.replaceChildren();
  if (summary) {
    renderSummary(root, summary);
  } else {
    root.append(el('p', 'O resumo dessa reunião não foi gerado (a IA falhou ou a gravação foi interrompida).', 'muted'));
    if (transcript) {
      const button = el('button', 'Gerar resumo agora', 'primary');
      button.addEventListener('click', () => window.api.summarizeMeeting(selected.id));
      root.append(button);
    }
  }

  const transcriptRoot = $('meeting-transcript');
  transcriptRoot.replaceChildren();
  if (!transcript) transcriptRoot.append(el('p', 'Sem transcrição.', 'muted'));
  for (const paragraph of (transcript || '').split(/\n{2,}/)) {
    const match = /^\[(\d\d:\d\d:\d\d)\]\s*(.*)$/s.exec(paragraph);
    const p = el('p');
    if (match) p.append(el('span', match[1], 'stamp'), document.createTextNode(match[2]));
    else p.textContent = paragraph;
    transcriptRoot.append(p);
  }
  selectTab(tab);
}

function selectTab(tab) {
  for (const button of document.querySelectorAll('.tab')) button.classList.toggle('active', button.dataset.tab === tab);
  $('meeting-summary').hidden = tab !== 'summary';
  $('meeting-transcript').hidden = tab !== 'transcript';
}

for (const button of document.querySelectorAll('.tab')) {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
}

function section(title, items, render = (item) => el('li', item)) {
  const wrap = el('section');
  wrap.append(el('h2', title));
  if (!items.length) {
    wrap.append(el('p', 'Nada registrado.', 'muted'));
    return wrap;
  }
  const list = el('ul');
  items.forEach((item) => list.append(render(item)));
  wrap.append(list);
  return wrap;
}

function taskItem(task, onToggle, extra) {
  const li = el('li', undefined, 'task');
  li.classList.toggle('mine', Boolean(task.minha));
  li.classList.toggle('done', Boolean(task.concluida));
  const label = el('label');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = Boolean(task.concluida);
  box.addEventListener('change', () => onToggle(box.checked));
  const body = el('div');
  body.append(el('span', task.descricao));
  const meta = [task.minha && 'Minha', task.responsavel && `👤 ${task.responsavel}`, task.prazo && `📅 ${task.prazo}`];
  if (extra) meta.push(extra);
  const metaText = meta.filter(Boolean).join(' · ');
  if (metaText) body.append(el('small', metaText));
  label.append(box, body);
  li.append(label);
  return li;
}

async function toggleTask(id, index, done) {
  const updated = await window.api.setTaskDone(id, index, done);
  if (selected?.id === id) {
    selected = updated;
    renderMeeting('summary');
  }
  await refreshHistory();
}

function renderSummary(root, summary) {
  root.append(el('p', summary.resumo, 'lead'));

  // Minhas tarefas primeiro, concluídas por último; o índice original identifica a tarefa no arquivo.
  const tasks = summary.tarefas
    .map((task, index) => ({ task, index }))
    .sort((a, b) => Number(Boolean(a.task.concluida)) - Number(Boolean(b.task.concluida)) || Number(b.task.minha) - Number(a.task.minha));
  root.append(
    section('✅ Tarefas', tasks, ({ task, index }) => taskItem(task, (done) => toggleTask(selected.id, index, done))),
  );
  root.append(section('⭐ Pontos importantes', summary.pontos_importantes));
  root.append(section('💡 O que você deve saber', summary.o_que_voce_deve_saber));
  root.append(section('🤝 Decisões', summary.decisoes));

  const topics = el('section');
  topics.append(el('h2', '💬 O que foi discutido'));
  if (!summary.topicos_discutidos.length) topics.append(el('p', 'Nada registrado.', 'muted'));
  for (const topic of summary.topicos_discutidos) {
    topics.append(el('h3', topic.topico));
    const list = el('ul');
    topic.pontos.forEach((p) => list.append(el('li', p)));
    topics.append(list);
  }
  root.append(topics);
  root.append(section('❓ Perguntas em aberto', summary.perguntas_em_aberto));
}

$('copy-button').addEventListener('click', async () => {
  await window.api.copy(selected.markdown);
  $('copy-button').textContent = 'Copiado!';
  setTimeout(() => ($('copy-button').textContent = 'Copiar resumo'), 1500);
});
$('meeting-folder-button').addEventListener('click', () => window.api.openPath(selected.folder));

// ---- Tarefas de todas as reuniões ----------------------------------------

async function renderTasks() {
  const onlyMine = $('only-mine').checked;
  const tasks = (await window.api.listOpenTasks()).filter((t) => !onlyMine || t.minha);
  const root = $('tasks-list');
  root.replaceChildren();
  if (!tasks.length) {
    root.append(el('p', onlyMine ? 'Nenhuma tarefa sua pendente. 🎉' : 'Nenhuma tarefa pendente. 🎉', 'muted'));
    return;
  }
  let meetingId = null;
  let list = null;
  for (const task of tasks) {
    if (task.meetingId !== meetingId) {
      meetingId = task.meetingId;
      const heading = el('button', undefined, 'task-group');
      heading.append(el('span', task.meetingTitle), el('small', formatWhen(task.startedAt)));
      heading.addEventListener('click', () => openMeeting(task.meetingId));
      list = el('ul');
      root.append(heading, list);
    }
    list.append(taskItem(task, (done) => toggleTask(task.meetingId, task.index, done)));
  }
}

$('nav-tasks').addEventListener('click', async () => {
  show('tasks');
  await renderTasks();
});
$('only-mine').addEventListener('change', renderTasks);

// ---- Gravação -------------------------------------------------------------

// Promise da inicialização: se o usuário parar enquanto ela ainda acontece, o stop espera.
let starting = null;

window.api.onRecorderStart((options) => {
  banner('');
  starting = (async () => {
    try {
      recorder = await createRecorder({
        ...options,
        onSegment: (segment) => window.api.sendSegment(segment),
        onWarning: banner,
      });
      $('sources').textContent = recorder.hasSystemAudio ? '🎙 Microfone + 🔊 áudio do sistema' : '🎙 Só microfone';
    } catch (error) {
      recorder = null;
      await window.api.recorderFailed(`Não foi possível iniciar a gravação: ${error.message}`);
    }
  })();
});

window.api.onRecorderStop(async () => {
  await starting;
  if (recorder) await recorder.stop();
  recorder = null;
  await window.api.recorderStopped();
});

function startTicking() {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const elapsed = clock((Date.now() - startedAt) / 1000);
    $('timer').textContent = elapsed;
    $('record-label').textContent = `Parar e resumir · ${elapsed}`;
    if (recorder) $('meter-fill').style.width = `${Math.min(100, recorder.level() * 220)}%`;
  }, 100);
}

function renderRecordButton() {
  const button = $('record-button');
  button.classList.toggle('recording', phase === 'recording');
  button.disabled = phase === 'processing';
  if (phase === 'idle') $('record-label').textContent = 'Gravar reunião';
  if (phase === 'processing') $('record-label').textContent = 'Resumindo…';
}

window.api.onState(({ phase: next, startedAt: started, step }) => {
  phase = next;
  renderRecordButton();
  if (phase === 'recording') {
    startedAt = started;
    $('timer').textContent = '00:00:00';
    $('progress-live').textContent = '';
    startTicking();
    show('recording');
  } else {
    clearInterval(tickTimer);
  }
  if (phase === 'processing') {
    $('processing-step').textContent = step || 'Processando…';
    show('processing');
  }
});

window.api.onProgress(({ done, total }) => {
  const text = total ? `${done} de ${total} trechos transcritos` : '';
  $('progress').textContent = text;
  $('progress-live').textContent = text;
});

window.api.onDone(async (result) => {
  await refreshHistory();
  await openMeeting(result.id);
});

window.api.onMeetingError(async (error) => {
  $('error-message').textContent = error.message;
  show('error');
  await refreshHistory();
});

window.api.onError(({ message }) => {
  // Uma gravação em andamento continua na tela; o aviso aparece no banner.
  if (currentView === 'processing' || (currentView === 'recording' && !recorder)) showHome();
  banner(message);
});

window.api.onOpenSettings(({ reason }) => openSettings(reason));

$('record-button').addEventListener('click', () => window.api.toggle());
$('stop-button').addEventListener('click', () => window.api.toggle());
$('error-back-button').addEventListener('click', showHome);
$('folder-button').addEventListener('click', () => window.api.openPath());

function showHome() {
  if (meetings.length) openMeeting(meetings[0].id);
  else show('empty');
}

// ---- Configurações --------------------------------------------------------

const form = $('settings-form');

async function fillMicrophones(chosen) {
  const select = form.elements.micDeviceId;
  select.replaceChildren(new Option('Padrão do sistema', 'default'));
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
      .forEach((d) => select.append(new Option(d.label || 'Microfone', d.deviceId)));
  } catch {
    // sem permissão ainda: fica só o padrão
  }
  select.value = [...select.options].some((o) => o.value === chosen) ? chosen : 'default';
}

async function openSettings(reason) {
  if (currentView !== 'settings') viewBeforeSettings = selected ? { meeting: selected.id } : currentView;
  const settings = await window.api.getSettings();
  for (const [key, value] of Object.entries(settings)) {
    const input = form.elements[key];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
  form.elements.apiKey.value = '';
  $('api-key-status').textContent = settings.hasApiKey
    ? 'Chave salva (criptografada no Keychain). Deixe vazio para manter.'
    : 'Nenhuma chave salva.';
  $('settings-reason').textContent = reason || '';
  $('settings-reason').hidden = !reason;
  await fillMicrophones(settings.micDeviceId);
  show('settings');
}

function leaveSettings() {
  if (viewBeforeSettings?.meeting) openMeeting(viewBeforeSettings.meeting);
  else if (viewBeforeSettings === 'tasks') $('nav-tasks').click();
  else if (['recording', 'processing', 'error'].includes(viewBeforeSettings)) show(viewBeforeSettings);
  else showHome();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  data.captureSystemAudio = form.elements.captureSystemAudio.checked;
  data.keepAudio = form.elements.keepAudio.checked;
  const settings = await window.api.saveSettings(data);
  setShortcutHint(settings.shortcut);
  await refreshHistory(); // a pasta das notas pode ter mudado
  leaveSettings();
});

$('settings-cancel').addEventListener('click', leaveSettings);
$('settings-button').addEventListener('click', () => openSettings());

function setShortcutHint(shortcut) {
  const pretty = (shortcut || '')
    .replace(/CommandOrControl|Command|Cmd/g, '⌘')
    .replace(/Alt|Option/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/Control|Ctrl/g, '⌃')
    .replaceAll('+', '');
  for (const node of document.querySelectorAll('.shortcut-hint')) node.textContent = pretty;
  $('record-button').title = `Gravar/parar (${pretty})`;
}

// ---- Início ---------------------------------------------------------------

(async () => {
  const settings = await window.api.getSettings();
  setShortcutHint(settings.shortcut);
  await refreshHistory();
  const state = await window.api.getState();
  phase = state.phase;
  renderRecordButton();
  if (phase === 'recording') {
    startedAt = state.startedAt;
    startTicking();
    show('recording');
  } else if (phase === 'processing') {
    show('processing');
  } else {
    showHome();
  }
})();
