import { createRecorder } from './recorder.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['idle', 'recording', 'processing', 'result', 'error', 'settings'];

let recorder = null;
let lastResult = null;
let lastError = null;
let startedAt = null;
let tickTimer = null;
let currentView = 'idle';
let viewBeforeSettings = 'idle';

function show(view) {
  currentView = view;
  for (const name of VIEWS) $(`view-${name}`).hidden = name !== view;
}

function banner(message) {
  const el = $('banner');
  el.textContent = message || '';
  el.hidden = !message;
}

function clock(totalSeconds) {
  const s = Math.floor(totalSeconds);
  return [s / 3600, (s % 3600) / 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');
}

// ---- Gravação -------------------------------------------------------------

window.api.onRecorderStart(async (options) => {
  banner('');
  try {
    recorder = await createRecorder({
      ...options,
      onSegment: (segment) => window.api.sendSegment(segment),
      onWarning: banner,
    });
  } catch (error) {
    recorder = null;
    await window.api.recorderFailed(`Não foi possível iniciar a gravação: ${error.message}`);
    return;
  }
  $('sources').textContent = recorder.hasSystemAudio ? '🎙 Microfone + 🔊 áudio do sistema' : '🎙 Só microfone';
  startTicking();
});

window.api.onRecorderStop(async () => {
  stopTicking();
  if (recorder) await recorder.stop();
  recorder = null;
  await window.api.recorderStopped();
});

function startTicking() {
  stopTicking();
  tickTimer = setInterval(() => {
    if (startedAt) $('timer').textContent = clock((Date.now() - startedAt) / 1000);
    if (recorder) $('meter-fill').style.width = `${Math.min(100, recorder.level() * 220)}%`;
  }, 100);
}

function stopTicking() {
  clearInterval(tickTimer);
}

// ---- Estado vindo do processo principal -----------------------------------

window.api.onState(({ phase, startedAt: started, step }) => {
  if (phase === 'recording') {
    startedAt = started;
    $('timer').textContent = '00:00:00';
    $('progress-live').textContent = '';
    show('recording');
  } else if (phase === 'processing') {
    $('processing-step').textContent = step || 'Processando…';
    show('processing');
  }
});

window.api.onProgress(({ done, total }) => {
  const text = total ? `${done} de ${total} trechos transcritos` : '';
  $('progress').textContent = text;
  $('progress-live').textContent = text;
});

window.api.onDone((result) => {
  lastResult = result;
  renderResult(result.summary);
  show('result');
});

window.api.onMeetingError((error) => {
  lastError = error;
  $('error-message').textContent = error.message;
  $('retry-button').hidden = !error.canRetry;
  $('error-folder-button').hidden = !error.folder;
  show('error');
});

window.api.onError(({ message }) => {
  // Uma gravação em andamento continua na tela; o aviso aparece no banner.
  if (currentView === 'processing' || (currentView === 'recording' && !recorder)) show('idle');
  banner(message);
});

window.api.onOpenSettings(({ reason }) => openSettings(reason));

// ---- Resultado ------------------------------------------------------------

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
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

function renderTask(task) {
  const li = el('li', undefined, task.minha ? 'task mine' : 'task');
  li.append(el('span', task.descricao));
  const meta = [task.responsavel && `👤 ${task.responsavel}`, task.prazo && `📅 ${task.prazo}`].filter(Boolean);
  if (meta.length) li.append(el('small', meta.join(' · ')));
  return li;
}

function renderResult(summary) {
  const root = $('result');
  root.replaceChildren();
  root.append(el('h1', summary.titulo), el('p', summary.resumo, 'lead'));

  const tasks = [...summary.tarefas].sort((a, b) => Number(b.minha) - Number(a.minha));
  root.append(section('✅ Tarefas', tasks, renderTask));
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
  await window.api.copy(lastResult.markdown);
  $('copy-button').textContent = 'Copiado!';
  setTimeout(() => ($('copy-button').textContent = 'Copiar resumo'), 1500);
});
$('folder-button').addEventListener('click', () => window.api.openPath(lastResult.folder));
$('new-button').addEventListener('click', () => window.api.toggle());
$('record-button').addEventListener('click', () => window.api.toggle());
$('stop-button').addEventListener('click', () => window.api.toggle());
$('retry-button').addEventListener('click', () => window.api.retrySummary());
$('error-folder-button').addEventListener('click', () => window.api.openPath(lastError?.folder));
$('error-back-button').addEventListener('click', () => show('idle'));

// ---- Configurações --------------------------------------------------------

const form = $('settings-form');

async function fillMicrophones(selected) {
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
  select.value = [...select.options].some((o) => o.value === selected) ? selected : 'default';
}

async function openSettings(reason) {
  if (currentView !== 'settings') viewBeforeSettings = currentView;
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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  data.captureSystemAudio = form.elements.captureSystemAudio.checked;
  data.keepAudio = form.elements.keepAudio.checked;
  const settings = await window.api.saveSettings(data);
  $('shortcut-hint').textContent = prettyShortcut(settings.shortcut);
  show(viewBeforeSettings === 'settings' ? 'idle' : viewBeforeSettings);
});

$('settings-cancel').addEventListener('click', () => show(viewBeforeSettings));
$('settings-button').addEventListener('click', () => openSettings());

function prettyShortcut(shortcut) {
  return (shortcut || '')
    .replace(/CommandOrControl|Command|Cmd/g, '⌘')
    .replace(/Alt|Option/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/Control|Ctrl/g, '⌃')
    .replaceAll('+', '');
}

// ---- Início ---------------------------------------------------------------

(async () => {
  const settings = await window.api.getSettings();
  $('shortcut-hint').textContent = prettyShortcut(settings.shortcut);
  const { phase } = await window.api.getState();
  show(phase === 'idle' ? 'idle' : phase);
})();
