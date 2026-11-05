const path = require('node:path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  globalShortcut,
  ipcMain,
  nativeImage,
  shell,
  clipboard,
  screen,
  session,
  desktopCapturer,
  systemPreferences,
} = require('electron');
const { actionFromArgv } = require('./argv');
const { getSettings, saveSettings, getApiKey, modelsDir } = require('./settings');
const localWhisper = require('./local-whisper');
const { createMeeting, summarizeFolder } = require('./meeting');
const { formatClock } = require('./transcript');
const history = require('./history');

// `meeting` com o app já aberto abre uma segunda instância só para repassar o comando.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null; // janela principal (histórico); também é onde a gravação roda
let popover = null; // lista de tarefas que abre pelo ícone da menu bar
let tray = null;
let quitting = false;
let trayTimer = null;

// idle -> recording -> processing -> idle
const state = { phase: 'idle', meeting: null, recordingStartedAt: null };

// Só para a janela principal (comandos do gravador, navegação).
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Para todas as janelas (estado da gravação, mudanças nas tarefas).
function broadcast(channel, payload) {
  for (const target of [win, popover]) {
    if (target && !target.isDestroyed()) target.webContents.send(channel, payload);
  }
}

function setPhase(phase, extra = {}) {
  state.phase = phase;
  broadcast('state', { phase, startedAt: state.recordingStartedAt, ...extra });
  refreshTray();
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 760,
    minHeight: 480,
    show: false,
    fullscreenable: false,
    titleBarStyle: 'hiddenInset',
    title: 'Meeting Notes',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      // A gravação acontece no renderer; não pode ser pausada com a janela escondida.
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Com a janela aberta o app aparece no Dock e no ⌘Tab; fechada, vive só na menu bar.
  win.on('show', () => app.dock?.show());
  win.on('hide', () => app.dock?.hide());
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

// ---- Painel da menu bar -----------------------------------------------------

const POPOVER_SIZE = { width: 360, height: 520 };

function createPopover() {
  popover = new BrowserWindow({
    ...POPOVER_SIZE,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popover.loadFile(path.join(__dirname, '..', 'renderer', 'popover.html'));
  // Como um menu: clicou fora, fecha.
  popover.on('blur', () => {
    popoverHiddenAt = Date.now();
    popover.hide();
  });
}

let popoverHiddenAt = 0;

function togglePopover() {
  if (popover.isVisible()) return popover.hide();
  // Clicar no ícone com o painel aberto dispara o blur (fecha) e logo depois o clique: não reabre.
  if (Date.now() - popoverHiddenAt < 250) return;
  const trayBounds = tray.getBounds();
  const { workArea } = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - POPOVER_SIZE.width / 2);
  popover.setPosition(
    Math.min(Math.max(x, workArea.x + 8), workArea.x + workArea.width - POPOVER_SIZE.width - 8),
    Math.round(trayBounds.y + trayBounds.height + 6),
  );
  popover.show();
  popover.focus();
  popover.webContents.send('popover:shown');
}

// ---- Gravação -------------------------------------------------------------

// `show: false` quando a gravação começa pelo painel da menu bar: a janela principal fica quieta.
async function startRecording({ show = true } = {}) {
  if (state.phase !== 'idle') return show && showWindow();

  const settings = getSettings();
  const apiKey = getApiKey();
  if (!apiKey) {
    showWindow();
    send('open-settings', { reason: 'Configure sua chave da OpenAI para começar.' });
    return;
  }

  const local = settings.transcriptionEngine === 'local';
  const status = local ? localWhisper.localStatus({ whisperCliPath: settings.whisperCliPath, modelsDir: modelsDir() }) : null;
  if (local && !status.ready) {
    showWindow();
    const steps = localWhisper.missingSteps(status).join(' e ');
    send('open-settings', { reason: `Para transcrever no Mac, ${steps}. Ou troque a transcrição para OpenAI.` });
    return;
  }

  const micOk = await systemPreferences.askForMediaAccess('microphone');
  if (!micOk) {
    showWindow();
    send('error', {
      message: 'Sem acesso ao microfone. Libere em Ajustes do Sistema › Privacidade e Segurança › Microfone.',
    });
    return;
  }

  state.meeting = createMeeting({
    settings,
    apiKey,
    local: local ? { cli: status.cli, modelsDir: modelsDir() } : null,
    onProgress: (progress) => broadcast('transcription-progress', progress),
  });
  state.recordingStartedAt = Date.now();
  setPhase('recording', { startedAt: state.recordingStartedAt });
  send('recorder:start', {
    segmentMinutes: settings.segmentMinutes,
    captureSystemAudio: settings.captureSystemAudio,
    micDeviceId: settings.micDeviceId,
    toWav: local,
  });
  if (show) showWindow();
}

function stopRecording() {
  if (state.phase !== 'recording') return;
  setPhase('processing', { step: 'Finalizando gravação…' });
  // O renderer grava o último segmento e chama 'recorder:stopped'.
  send('recorder:stop');
}

function toggleRecording(options) {
  if (state.phase === 'recording') stopRecording();
  else startRecording(options);
}

function runAction(action) {
  if (action === 'toggle') toggleRecording();
  else if (action === 'start') startRecording();
  else if (action === 'stop') stopRecording();
  else if (action === 'show') showWindow();
}

async function deliver(promise) {
  setPhase('processing', { step: 'Gerando resumo com a IA…' });
  try {
    const result = await promise;
    setPhase('idle');
    send('meeting:done', result);
    broadcast('tasks-changed');
    showWindow();
    new Notification({ title: 'Resumo da reunião pronto', body: result.summary.titulo }).show();
  } catch (error) {
    setPhase('idle');
    send('meeting:error', { message: error.message });
    showWindow();
  }
}

ipcMain.handle('recorder:segment', (_event, segment) => {
  state.meeting?.addSegment(segment);
});

ipcMain.handle('recorder:stopped', async () => {
  const meeting = state.meeting;
  if (!meeting) return;
  const durationSec = (Date.now() - state.recordingStartedAt) / 1000;
  state.meeting = null;
  setPhase('processing', { step: 'Transcrevendo o final da reunião…' });
  await deliver(meeting.finish(durationSec));
});

ipcMain.handle('recorder:failed', (_event, message) => {
  state.meeting = null;
  setPhase('idle');
  send('error', { message });
});

// Resume (de novo) uma reunião do histórico que tem transcrição.
ipcMain.handle('history:summarize', (_event, id) => {
  if (state.phase !== 'idle') return;
  const settings = getSettings();
  return deliver(
    Promise.resolve().then(() => {
      const folder = history.meetingDir(settings.notesDir, id);
      return summarizeFolder({ folder, settings, apiKey: getApiKey(), meta: history.readMeta(folder) });
    }),
  );
});

ipcMain.handle('history:list', () => history.listMeetings(getSettings().notesDir));
ipcMain.handle('history:get', (_event, id) => history.getMeeting(getSettings().notesDir, id));
ipcMain.handle('history:tasks', () => history.listOpenTasks(getSettings().notesDir));
// Toda mudança em tarefa avisa as duas janelas, para o painel e o histórico ficarem iguais.
function changingTasks(fn) {
  return (_event, args) => {
    const result = fn(getSettings().notesDir, args);
    broadcast('tasks-changed');
    return result;
  };
}

ipcMain.handle('history:update-task', changingTasks((dir, { id, index, patch }) => history.updateTask(dir, id, index, patch)));
ipcMain.handle('tasks:add', changingTasks((dir, { descricao }) => history.addManualTask(dir, descricao)));
ipcMain.handle('tasks:update-manual', changingTasks((dir, { id, patch }) => history.updateManualTask(dir, id, patch)));
ipcMain.handle('tasks:remove-manual', changingTasks((dir, { id }) => history.removeManualTask(dir, id)));

ipcMain.handle('open-meeting', (_event, id) => {
  popover?.hide();
  showWindow();
  send('navigate', { meetingId: id });
});
ipcMain.handle('show-main', (_event, view) => {
  popover?.hide();
  showWindow();
  if (view) send('navigate', { view });
});
// O ⚙︎ do painel abre o mesmo menu de antes.
ipcMain.handle('tray:menu', () => tray.popUpContextMenu(buildTrayMenu()));

// ---- Transcrição local (whisper.cpp) ---------------------------------------

ipcMain.handle('local:status', () =>
  localWhisper.localStatus({ whisperCliPath: getSettings().whisperCliPath, modelsDir: modelsDir() }),
);

const downloads = new Map(); // um download por modelo de cada vez
ipcMain.handle('local:download', (_event, kind) => {
  if (!downloads.has(kind)) {
    const job = localWhisper
      .downloadModel({ kind, modelsDir: modelsDir(), onProgress: (p) => broadcast('local:download-progress', p) })
      .finally(() => downloads.delete(kind));
    downloads.set(kind, job);
  }
  return downloads.get(kind).then(() => localWhisper.localStatus({ whisperCliPath: getSettings().whisperCliPath, modelsDir: modelsDir() }));
});

ipcMain.handle('toggle', (_event, options) => toggleRecording(options));
ipcMain.handle('get-state', () => ({ phase: state.phase, startedAt: state.recordingStartedAt }));
ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:save', (_event, patch) => {
  const settings = saveSettings(patch);
  registerShortcut();
  return settings;
});
ipcMain.handle('open-path', (_event, target) => shell.openPath(target || getSettings().notesDir));
ipcMain.handle('copy', (_event, text) => clipboard.writeText(text));

// ---- Atalho global e menu bar --------------------------------------------

function registerShortcut() {
  globalShortcut.unregisterAll();
  const { shortcut } = getSettings();
  if (shortcut && !globalShortcut.register(shortcut, toggleRecording)) {
    send('error', { message: `Não foi possível registrar o atalho ${shortcut} (já está em uso?).` });
  }
}

function buildTrayMenu() {
  const { shortcut } = getSettings();
  return Menu.buildFromTemplate([
    state.phase === 'recording'
      ? { label: 'Parar e resumir', accelerator: shortcut, click: stopRecording }
      : { label: 'Gravar reunião', accelerator: shortcut, click: () => startRecording(), enabled: state.phase === 'idle' },
    { label: 'Abrir histórico', click: showWindow },
    { label: 'Abrir pasta de notas', click: () => shell.openPath(getSettings().notesDir) },
    { label: 'Configurações…', click: () => { showWindow(); send('open-settings', {}); } },
    { type: 'separator' },
    { label: 'Sair', role: 'quit' },
  ]);
}

function refreshTray() {
  if (!tray) return;
  clearInterval(trayTimer);
  if (state.phase === 'recording') {
    const tick = () => tray.setTitle(` ${formatClock((Date.now() - state.recordingStartedAt) / 1000)}`);
    tick();
    trayTimer = setInterval(tick, 1000);
  } else {
    tray.setTitle(state.phase === 'processing' ? ' resumindo…' : '');
  }
}

// ---- Ciclo de vida --------------------------------------------------------

app.on('second-instance', (_event, argv) => runAction(actionFromArgv(argv) || 'show'));

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  app.dock?.hide();

  // getDisplayMedia no renderer -> áudio do sistema (loopback via CoreAudio Tap no macOS 14.2+).
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const [screen] = await desktopCapturer.getSources({ types: ['screen'] });
    callback(screen ? { video: screen, audio: 'loopback' } : null);
  });

  // "Template": o macOS pinta o ícone de claro/escuro conforme a menu bar.
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Meeting Notes');
  // Clique abre a lista de tarefas; clique direito, o menu de opções.
  tray.on('click', togglePopover);
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));
  createWindow();
  createPopover();
  refreshTray();
  win.webContents.once('did-finish-load', () => {
    registerShortcut();
    runAction(actionFromArgv(process.argv) || 'show');
  });
});
