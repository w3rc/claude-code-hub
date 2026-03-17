const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');

// Config
const CONFIG_DIR = path.join(os.homedir(), '.claude-code-hub');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function getDefaultConfig() {
  // Try loading from project-local config.json first
  try {
    const localConfig = path.join(__dirname, '..', 'config.json');
    if (fs.existsSync(localConfig)) {
      return JSON.parse(fs.readFileSync(localConfig, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load local config.json:', e.message);
  }
  // Bare default — single pane pointing to home
  return {
    panes: [
      { id: 1, directory: os.homedir(), label: 'Home' }
    ],
    columns: 1,
    rows: 1,
    zoomedPaneId: null
  };
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load config:', e.message);
  }
  return getDefaultConfig();
}

function saveConfig(config) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e.message);
  }
}

let config = loadConfig();
const ptys = new Map();
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    backgroundColor: '#000000',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function getShell() {
  return process.env.SHELL || '/bin/bash';
}

function spawnPty(paneId) {
  const pane = config.panes.find(p => p.id === paneId);
  if (!pane) return;

  killPty(paneId);

  const dir = fs.existsSync(pane.directory) ? pane.directory : os.homedir();

  const claudeCmd = path.join(os.homedir(), '.local', 'bin', 'claude') + ' --dangerously-skip-permissions --chrome';
  // Signal renderer to clear the terminal before new process starts
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal-reset', paneId);
  }

  const ptyProcess = pty.spawn(getShell(), ['-l', '-c', claudeCmd], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: dir,
    env: { ...process.env, TERM: 'xterm-256color' }
  });

  ptyProcess.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-data', paneId, data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    ptys.delete(paneId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pane-exited', paneId, exitCode);
    }
  });

  ptys.set(paneId, ptyProcess);
}

function killPty(paneId) {
  const p = ptys.get(paneId);
  if (p) {
    try { p.kill(); } catch (e) { /* already dead */ }
    ptys.delete(paneId);
  }
}

function killAllPtys() {
  for (const [id] of ptys) {
    killPty(id);
  }
}

// IPC Handlers
function registerIPC() {
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window-close', () => mainWindow?.close());

  ipcMain.on('open-external', (_, url) => {
    shell.openExternal(url);
  });

  ipcMain.on('open-in-vscode', (_, directory) => {
    const { exec } = require('child_process');
    exec(`code-insiders "${directory}"`);
  });

  ipcMain.on('terminal-input', (_, paneId, data) => {
    const p = ptys.get(paneId);
    if (p) p.write(data);
  });

  ipcMain.on('terminal-resize', (_, paneId, cols, rows) => {
    const p = ptys.get(paneId);
    if (p) {
      try { p.resize(cols, rows); } catch (e) { /* ignore */ }
    }
  });

  ipcMain.on('pane-spawn', (_, paneId) => {
    spawnPty(paneId);
  });

  ipcMain.on('pane-kill', (_, paneId) => {
    killPty(paneId);
  });

  ipcMain.on('pane-restart', (_, paneId) => {
    spawnPty(paneId);
  });

  ipcMain.on('restart-all', () => {
    for (const pane of config.panes) {
      spawnPty(pane.id);
    }
  });

  ipcMain.handle('get-config', () => {
    return config;
  });

  ipcMain.handle('update-config', (_, partial) => {
    config = { ...config, ...partial };
    saveConfig(config);
    return config;
  });

  ipcMain.handle('rename-pane', (_, paneId, newLabel) => {
    const pane = config.panes.find(p => p.id === paneId);
    if (pane) {
      pane.label = newLabel;
      saveConfig(config);
    }
    return { label: newLabel };
  });

  ipcMain.handle('swap-panes', (_, paneIdA, paneIdB) => {
    const indexA = config.panes.findIndex(p => p.id === paneIdA);
    const indexB = config.panes.findIndex(p => p.id === paneIdB);
    if (indexA !== -1 && indexB !== -1) {
      [config.panes[indexA], config.panes[indexB]] = [config.panes[indexB], config.panes[indexA]];
      saveConfig(config);
    }
    return config;
  });

  ipcMain.handle('change-directory', async (_, paneId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select project directory'
    });

    if (result.canceled || !result.filePaths.length) return null;

    const newDir = result.filePaths[0];
    const pane = config.panes.find(p => p.id === paneId);
    if (pane) {
      pane.directory = newDir;
      // Only update label if it was auto-generated (matches old dir basename)
      const oldBasename = path.basename(pane.directory);
      if (pane.label === oldBasename || pane.label === 'Home') {
        pane.label = path.basename(newDir);
      }
      pane.directory = newDir;
      saveConfig(config);
      spawnPty(paneId);
    }

    return { directory: newDir, label: pane?.label || path.basename(newDir) };
  });

  ipcMain.handle('switch-directory', async (_, paneId, directory) => {
    const pane = config.panes.find(p => p.id === paneId);
    if (!pane) return null;
    pane.directory = directory;
    pane.label = path.basename(directory);
    saveConfig(config);
    spawnPty(paneId);
    return { directory, label: pane.label };
  });

  ipcMain.handle('add-pane', () => {
    const maxId = config.panes.reduce((max, p) => Math.max(max, p.id), 0);
    const newPane = {
      id: maxId + 1,
      directory: os.homedir(),
      label: 'Home'
    };
    config.panes.push(newPane);
    saveConfig(config);
    return newPane;
  });

  ipcMain.handle('remove-pane', (_, paneId) => {
    killPty(paneId);
    config.panes = config.panes.filter(p => p.id !== paneId);
    saveConfig(config);
    return config;
  });
}

// App lifecycle
app.whenReady().then(() => {
  registerIPC();
  createWindow();
});

app.on('window-all-closed', () => {
  killAllPtys();
  app.quit();
});

app.on('before-quit', () => {
  killAllPtys();
});
