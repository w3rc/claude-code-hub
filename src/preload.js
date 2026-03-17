const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Fire-and-forget
  terminalInput: (paneId, data) => ipcRenderer.send('terminal-input', paneId, data),
  terminalResize: (paneId, cols, rows) => ipcRenderer.send('terminal-resize', paneId, cols, rows),
  paneSpawn: (paneId) => ipcRenderer.send('pane-spawn', paneId),
  paneKill: (paneId) => ipcRenderer.send('pane-kill', paneId),
  paneRestart: (paneId) => ipcRenderer.send('pane-restart', paneId),
  restartAll: () => ipcRenderer.send('restart-all'),

  // Request-response
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (partial) => ipcRenderer.invoke('update-config', partial),
  changeDirectory: (paneId) => ipcRenderer.invoke('change-directory', paneId),
  switchDirectory: (paneId, directory) => ipcRenderer.invoke('switch-directory', paneId, directory),
  renamePane: (paneId, label) => ipcRenderer.invoke('rename-pane', paneId, label),
  swapPanes: (a, b) => ipcRenderer.invoke('swap-panes', a, b),
  addPane: () => ipcRenderer.invoke('add-pane'),
  removePane: (paneId) => ipcRenderer.invoke('remove-pane', paneId),

  // Window controls
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),

  // Listeners
  onTerminalData: (callback) => {
    ipcRenderer.on('terminal-data', (_, paneId, data) => callback(paneId, data));
  },
  onPaneExited: (callback) => {
    ipcRenderer.on('pane-exited', (_, paneId, code) => callback(paneId, code));
  },
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openInVSCode: (directory) => ipcRenderer.send('open-in-vscode', directory),
  onTerminalReset: (callback) => {
    ipcRenderer.on('terminal-reset', (_, paneId) => callback(paneId));
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
