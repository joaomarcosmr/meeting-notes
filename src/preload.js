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

  // gravação
  sendSegment: (segment) => ipcRenderer.invoke('recorder:segment', segment),
  recorderStopped: () => ipcRenderer.invoke('recorder:stopped'),
  recorderFailed: (message) => ipcRenderer.invoke('recorder:failed', message),
  toggle: () => ipcRenderer.invoke('toggle'),
  getState: () => ipcRenderer.invoke('get-state'),

  // histórico
  listMeetings: () => ipcRenderer.invoke('history:list'),
  getMeeting: (id) => ipcRenderer.invoke('history:get', id),
  listOpenTasks: () => ipcRenderer.invoke('history:tasks'),
  updateTask: (id, index, patch) => ipcRenderer.invoke('history:update-task', { id, index, patch }),
  summarizeMeeting: (id) => ipcRenderer.invoke('history:summarize', id),

  // diversos
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  openPath: (target) => ipcRenderer.invoke('open-path', target),
  copy: (text) => ipcRenderer.invoke('copy', text),
});
