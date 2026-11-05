const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (listener) => {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('api', {
  // comandos do processo principal
  onRecorderStart: on('recorder:start'),
  onRecorderStop: on('recorder:stop'),
  onState: on('state'),
  onProgress: on('transcription-progress'),
  onDone: on('meeting:done'),
  onMeetingError: on('meeting:error'),
  onError: on('error'),
  onOpenSettings: on('open-settings'),
  onTasksChanged: on('tasks-changed'),
  onNavigate: on('navigate'),
  onPopoverShown: on('popover:shown'),
  onDownloadProgress: on('local:download-progress'),

  // gravação
  sendSegment: (segment) => ipcRenderer.invoke('recorder:segment', segment),
  recorderStopped: () => ipcRenderer.invoke('recorder:stopped'),
  recorderFailed: (message) => ipcRenderer.invoke('recorder:failed', message),
  toggle: (options) => ipcRenderer.invoke('toggle', options),
  getState: () => ipcRenderer.invoke('get-state'),

  // histórico
  listMeetings: () => ipcRenderer.invoke('history:list'),
  getMeeting: (id) => ipcRenderer.invoke('history:get', id),
  listOpenTasks: () => ipcRenderer.invoke('history:tasks'),
  updateTask: (id, index, patch) => ipcRenderer.invoke('history:update-task', { id, index, patch }),
  summarizeMeeting: (id) => ipcRenderer.invoke('history:summarize', id),
  addTask: (descricao) => ipcRenderer.invoke('tasks:add', { descricao }),
  updateManualTask: (id, patch) => ipcRenderer.invoke('tasks:update-manual', { id, patch }),
  removeManualTask: (id) => ipcRenderer.invoke('tasks:remove-manual', { id }),

  // transcrição local
  localStatus: () => ipcRenderer.invoke('local:status'),
  downloadModel: (kind) => ipcRenderer.invoke('local:download', kind),

  // navegação entre janelas
  openMeeting: (id) => ipcRenderer.invoke('open-meeting', id),
  showMain: (view) => ipcRenderer.invoke('show-main', view),
  showTrayMenu: () => ipcRenderer.invoke('tray:menu'),

  // diversos
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  openPath: (target) => ipcRenderer.invoke('open-path', target),
  copy: (text) => ipcRenderer.invoke('copy', text),
});
