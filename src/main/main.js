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
  session,
  desktopCapturer,
  systemPreferences,
} = require('electron');
const { actionFromArgv } = require('./argv');
const { getSettings, saveSettings, getApiKey } = require('./settings');
const { createMeeting, summarizeFolder } = require('./meeting');
const { formatClock } = require('./transcript');
const history = require('./history');

// `meeting` com o app já aberto abre uma segunda instância só para repassar o comando.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let tray = null;
let quitting = false;
let trayTimer = null;

// idle -> recording -> processing -> idle
const state = { phase: 'idle', meeting: null, recordingStartedAt: null };

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setPhase(phase, extra = {}) {
  state.phase = phase;
  send('state', { phase, ...extra });
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

// ---- Gravação -------------------------------------------------------------

async function startRecording() {
  if (state.phase !== 'idle') return showWindow();

  const settings = getSettings();
  const apiKey = getApiKey();
  if (!apiKey) {
    showWindow();
    send('open-settings', { reason: 'Configure sua chave da OpenAI para começar.' });
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
    onProgress: (progress) => send('transcription-progress', progress),
  });
  state.recordingStartedAt = Date.now();
  setPhase('recording', { startedAt: state.recordingStartedAt });
  send('recorder:start', {
    segmentMinutes: settings.segmentMinutes,
    captureSystemAudio: settings.captureSystemAudio,
    micDeviceId: settings.micDeviceId,
  });
  showWindow();
}

function stopRecording() {
  if (state.phase !== 'recording') return;
  setPhase('processing', { step: 'Finalizando gravação…' });
  // O renderer grava o último segmento e chama 'recorder:stopped'.
  send('recorder:stop');
}

function toggleRecording() {
  if (state.phase === 'recording') stopRecording();
  else startRecording();
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
ipcMain.handle('history:update-task', (_event, { id, index, patch }) =>
  history.updateTask(getSettings().notesDir, id, index, patch),
);

ipcMain.handle('toggle', () => toggleRecording());
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

function refreshTray() {
  if (!tray) return;
  clearInterval(trayTimer);
  if (state.phase === 'recording') {
    const tick = () => tray.setTitle(`● ${formatClock((Date.now() - state.recordingStartedAt) / 1000)}`);
    tick();
    trayTimer = setInterval(tick, 1000);
  } else {
    tray.setTitle(state.phase === 'processing' ? '◌ resumindo' : '◎');
  }

  const { shortcut } = getSettings();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      state.phase === 'recording'
        ? { label: 'Parar e resumir', accelerator: shortcut, click: stopRecording }
        : { label: 'Gravar reunião', accelerator: shortcut, click: startRecording, enabled: state.phase === 'idle' },
      { label: 'Abrir histórico', click: showWindow },
      { label: 'Abrir pasta de notas', click: () => shell.openPath(getSettings().notesDir) },
      { label: 'Configurações…', click: () => { showWindow(); send('open-settings', {}); } },
      { type: 'separator' },
      { label: 'Sair', role: 'quit' },
    ]),
  );
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

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Meeting Notes');
  createWindow();
  refreshTray();
  win.webContents.once('did-finish-load', () => {
    registerShortcut();
    runAction(actionFromArgv(process.argv) || 'show');
  });
});
