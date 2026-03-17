import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

const terminals = {};
const fitAddons = {};
const paneData = {}; // store pane metadata per id
let allProjects = []; // populated from config on init
const grid = document.getElementById('pane-grid');
const paneCountEl = document.getElementById('pane-count');
const colsInput = document.getElementById('grid-cols');
const rowsInput = document.getElementById('grid-rows');
const ctxMenu = document.getElementById('context-menu');

let activePaneId = null;
let zoomedPaneId = null;
let ctxTargetPaneId = null;
let dragSourcePaneId = null;

const THEME = {
  background: '#000000',
  foreground: '#e0e0e0',
  cursor: '#6c63ff',
  cursorAccent: '#000000',
  selectionBackground: '#6c63ff44',
  black: '#000000',
  red: '#e74c3c',
  green: '#2ecc71',
  yellow: '#f39c12',
  blue: '#3498db',
  magenta: '#9b59b6',
  cyan: '#1abc9c',
  white: '#ecf0f1',
  brightBlack: '#555',
  brightRed: '#ff6b6b',
  brightGreen: '#69db7c',
  brightYellow: '#ffd43b',
  brightBlue: '#74b9ff',
  brightMagenta: '#d980fa',
  brightCyan: '#63cdda',
  brightWhite: '#ffffff'
};

// ── Utilities ──

function updatePaneCount(count) {
  paneCountEl.textContent = `${count} pane${count !== 1 ? 's' : ''}`;
}

function refitAll() {
  requestAnimationFrame(() => {
    Object.entries(fitAddons).forEach(([id, fa]) => {
      try {
        fa.fit();
        const t = terminals[id];
        if (t) window.api.terminalResize(parseInt(id), t.cols, t.rows);
      } catch (e) { /* ignore */ }
    });
  });
}

function setGridLayout(cols, rows) {
  document.documentElement.style.setProperty('--cols', cols);
  document.documentElement.style.setProperty('--rows', rows);
  colsInput.value = cols;
  rowsInput.value = rows;
  refitAll();
}

function getAllPaneIds() {
  return Array.from(grid.querySelectorAll('.pane')).map(el => parseInt(el.dataset.paneId));
}

// ── Active Pane ──

function setActivePane(paneId) {
  if (activePaneId === paneId) return;
  const oldEl = grid.querySelector('.pane.active');
  if (oldEl) oldEl.classList.remove('active');
  activePaneId = paneId;
  const newEl = grid.querySelector(`.pane[data-pane-id="${paneId}"]`);
  if (newEl) {
    newEl.classList.add('active');
    // Clear activity indicator when pane becomes active
    newEl.classList.remove('has-activity');
  }
  const terminal = terminals[paneId];
  if (terminal) terminal.focus();
}

// ── Zoom ──

function toggleZoom(paneId) {
  if (zoomedPaneId === paneId) {
    grid.classList.remove('zoomed');
    const el = grid.querySelector(`.pane[data-pane-id="${paneId}"]`);
    if (el) el.classList.remove('zoomed-pane');
    zoomedPaneId = null;
    setTimeout(refitAll, 50);
    window.api.updateConfig({ zoomedPaneId: null });
  } else {
    if (zoomedPaneId !== null) {
      const prevEl = grid.querySelector(`.pane[data-pane-id="${zoomedPaneId}"]`);
      if (prevEl) prevEl.classList.remove('zoomed-pane');
    }
    zoomedPaneId = paneId;
    const el = grid.querySelector(`.pane[data-pane-id="${paneId}"]`);
    if (el) el.classList.add('zoomed-pane');
    grid.classList.add('zoomed');
    setActivePane(paneId);
    setTimeout(refitAll, 50);
    window.api.updateConfig({ zoomedPaneId: paneId });
  }
}

// ── Cycle Panes (Ctrl+Tab / Ctrl+Shift+Tab) ──

function cyclePanes(reverse) {
  const ids = getAllPaneIds();
  if (ids.length === 0) return;
  const currentIdx = ids.indexOf(activePaneId);
  let nextIdx;
  if (reverse) {
    nextIdx = currentIdx <= 0 ? ids.length - 1 : currentIdx - 1;
  } else {
    nextIdx = currentIdx >= ids.length - 1 ? 0 : currentIdx + 1;
  }
  const nextId = ids[nextIdx];
  setActivePane(nextId);
  if (zoomedPaneId !== null && zoomedPaneId !== nextId) {
    toggleZoom(zoomedPaneId);
    toggleZoom(nextId);
  }
}

// ── Rename ──

function startRename(paneId) {
  const paneEl = grid.querySelector(`.pane[data-pane-id="${paneId}"]`);
  if (!paneEl) return;
  const labelEl = paneEl.querySelector('.pane-label');
  const currentLabel = labelEl.textContent;

  const input = document.createElement('input');
  input.className = 'pane-label-input';
  input.value = currentLabel;
  input.type = 'text';

  labelEl.replaceWith(input);
  input.focus();
  input.select();

  const finish = async () => {
    const newLabel = input.value.trim() || currentLabel;
    const newSpan = document.createElement('span');
    newSpan.className = 'pane-label';
    newSpan.textContent = newLabel;
    newSpan.title = paneData[paneId]?.directory || '';
    input.replaceWith(newSpan);
    if (newLabel !== currentLabel) {
      await window.api.renamePane(paneId, newLabel);
    }
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = currentLabel; input.blur(); }
  });
}

// ── Project Quick-Switch Dropdown ──

function showProjectDropdown(paneId, paneEl) {
  // Remove any existing dropdown
  const existing = document.querySelector('.project-dropdown');
  if (existing) existing.remove();

  const currentDir = paneData[paneId]?.directory;
  const settingsBtn = paneEl.querySelector('.pane-btn.settings');
  const btnRect = settingsBtn.getBoundingClientRect();

  const dropdown = document.createElement('div');
  dropdown.className = 'project-dropdown';

  allProjects.forEach(p => {
    const item = document.createElement('div');
    item.className = 'project-dropdown-item';
    if (p.directory === currentDir) item.classList.add('active');
    item.textContent = p.label;
    item.title = p.directory;
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      dropdown.remove();
      if (p.directory === currentDir) return;
      const result = await window.api.switchDirectory(paneId, p.directory);
      if (result) {
        const label = paneEl.querySelector('.pane-label');
        label.textContent = result.label;
        label.title = result.directory;
        paneData[paneId] = { directory: result.directory, label: result.label };
        const overlay = paneEl.querySelector('.pane-overlay');
        if (overlay) overlay.remove();
        paneEl.querySelector('.pane-btn.restart').classList.remove('visible');
      }
    });
    dropdown.appendChild(item);
  });

  // Separator + Browse option
  const sep = document.createElement('div');
  sep.className = 'project-dropdown-sep';
  dropdown.appendChild(sep);

  const browseItem = document.createElement('div');
  browseItem.className = 'project-dropdown-item browse';
  browseItem.textContent = 'Browse\u2026';
  browseItem.addEventListener('click', async (e) => {
    e.stopPropagation();
    dropdown.remove();
    const result = await window.api.changeDirectory(paneId);
    if (result) {
      const label = paneEl.querySelector('.pane-label');
      label.textContent = result.label;
      label.title = result.directory;
      paneData[paneId] = { directory: result.directory, label: result.label };
      const overlay = paneEl.querySelector('.pane-overlay');
      if (overlay) overlay.remove();
      paneEl.querySelector('.pane-btn.restart').classList.remove('visible');
    }
  });
  dropdown.appendChild(browseItem);

  document.body.appendChild(dropdown);

  // Position below the settings button
  let left = btnRect.left;
  let top = btnRect.bottom + 4;
  // Adjust if offscreen
  const dRect = dropdown.getBoundingClientRect();
  if (left + dRect.width > window.innerWidth) left = window.innerWidth - dRect.width - 8;
  if (top + dRect.height > window.innerHeight) top = btnRect.top - dRect.height - 4;
  dropdown.style.left = `${left}px`;
  dropdown.style.top = `${top}px`;

  // Close on click outside
  const closeDropdown = (ev) => {
    if (!dropdown.contains(ev.target)) {
      dropdown.remove();
      document.removeEventListener('click', closeDropdown, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeDropdown, true), 0);
}

// ── Context Menu ──

function showContextMenu(x, y, paneId) {
  ctxTargetPaneId = paneId;
  ctxMenu.style.left = `${x}px`;
  ctxMenu.style.top = `${y}px`;
  ctxMenu.classList.remove('hidden');

  // Ensure menu doesn't go off screen
  const rect = ctxMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) ctxMenu.style.left = `${window.innerWidth - rect.width - 8}px`;
  if (rect.bottom > window.innerHeight) ctxMenu.style.top = `${window.innerHeight - rect.height - 8}px`;
}

function hideContextMenu() {
  ctxMenu.classList.add('hidden');
  ctxTargetPaneId = null;
}

document.addEventListener('click', (e) => {
  if (!ctxMenu.contains(e.target)) hideContextMenu();
});

ctxMenu.addEventListener('click', async (e) => {
  const item = e.target.closest('.ctx-item');
  if (!item || ctxTargetPaneId === null) return;
  const action = item.dataset.action;
  const paneId = ctxTargetPaneId;
  hideContextMenu();

  switch (action) {
    case 'rename':
      startRename(paneId);
      break;
    case 'change-dir': {
      const result = await window.api.changeDirectory(paneId);
      if (result) {
        const paneEl = grid.querySelector(`.pane[data-pane-id="${paneId}"]`);
        if (paneEl) {
          const label = paneEl.querySelector('.pane-label');
          if (label) { label.textContent = result.label; label.title = result.directory; }
        }
        const overlay = paneEl?.querySelector('.pane-overlay');
        if (overlay) overlay.remove();
      }
      break;
    }
    case 'zoom':
      toggleZoom(paneId);
      break;
    case 'split':
      await splitPane(paneId);
      break;
    case 'restart': {
      const paneEl = grid.querySelector(`.pane[data-pane-id="${paneId}"]`);
      const overlay = paneEl?.querySelector('.pane-overlay');
      if (overlay) overlay.remove();
      const restartBtn = paneEl?.querySelector('.pane-btn.restart');
      if (restartBtn) restartBtn.classList.remove('visible');
      window.api.paneRestart(paneId);
      break;
    }
    case 'close': {
      const panes = grid.querySelectorAll('.pane');
      if (panes.length <= 1) break;
      window.api.paneKill(paneId);
      await window.api.removePane(paneId);
      destroyPane(paneId);
      updatePaneCount(grid.children.length);
      break;
    }
  }
});

// ── Split Pane ──

async function splitPane(paneId) {
  const pane = await window.api.addPane();
  const index = grid.children.length;
  const el = createPaneElement(pane, index);
  initTerminal(pane, el);
  updatePaneCount(grid.children.length);
  // Auto-adjust grid if needed
  const total = grid.children.length;
  const cols = parseInt(colsInput.value) || 3;
  const rows = parseInt(rowsInput.value) || 2;
  if (total > cols * rows) {
    const newRows = Math.ceil(total / cols);
    setGridLayout(cols, newRows);
    window.api.updateConfig({ columns: cols, rows: newRows });
  }
}

// ── Drag to Swap ──

function setupDrag(headerEl, paneId) {
  headerEl.setAttribute('draggable', 'true');

  headerEl.addEventListener('dragstart', (e) => {
    dragSourcePaneId = paneId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(paneId));
    // Make drag image slightly transparent
    const paneEl = headerEl.closest('.pane');
    if (paneEl) paneEl.style.opacity = '0.5';
  });

  headerEl.addEventListener('dragend', () => {
    const paneEl = headerEl.closest('.pane');
    if (paneEl) paneEl.style.opacity = '';
    dragSourcePaneId = null;
    // Clear all drag-over states
    grid.querySelectorAll('.pane.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  const paneEl = headerEl.closest('.pane');

  paneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    paneEl.classList.add('drag-over');
  });

  paneEl.addEventListener('dragleave', () => {
    paneEl.classList.remove('drag-over');
  });

  paneEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    paneEl.classList.remove('drag-over');
    const sourcePaneId = parseInt(e.dataTransfer.getData('text/plain'));
    const targetPaneId = paneId;
    if (sourcePaneId === targetPaneId) return;

    // Swap in config
    await window.api.swapPanes(sourcePaneId, targetPaneId);

    // Swap DOM elements
    const sourceEl = grid.querySelector(`.pane[data-pane-id="${sourcePaneId}"]`);
    const targetEl = grid.querySelector(`.pane[data-pane-id="${targetPaneId}"]`);
    if (sourceEl && targetEl) {
      const sourcePlaceholder = document.createElement('div');
      grid.insertBefore(sourcePlaceholder, sourceEl);
      grid.insertBefore(sourceEl, targetEl);
      grid.insertBefore(targetEl, sourcePlaceholder);
      sourcePlaceholder.remove();
    }

    // Update shortcut labels
    updateShortcutLabels();
    refitAll();
  });
}

function updateShortcutLabels() {
  const panes = grid.querySelectorAll('.pane');
  panes.forEach((el, i) => {
    const shortcutEl = el.querySelector('.pane-shortcut');
    if (shortcutEl) {
      shortcutEl.textContent = i < 9 ? `Ctrl+${i + 1}` : '';
    }
  });
}

// ── Create Pane ──

function createPaneElement(pane, index) {
  const el = document.createElement('div');
  el.className = 'pane';
  el.dataset.paneId = pane.id;

  paneData[pane.id] = { directory: pane.directory, label: pane.label };

  const shortcutKey = index < 9 ? `Ctrl+${index + 1}` : '';

  el.innerHTML = `
    <div class="pane-header">
      <span class="pane-id">#${pane.id}</span>
      <span class="pane-label" title="${pane.directory}">${pane.label}</span>
      ${shortcutKey ? `<span class="pane-shortcut">${shortcutKey}</span>` : ''}
      <button class="pane-btn vscode" title="Open in VS Code">&lt;/&gt;</button>
      <button class="pane-btn zoom" title="Zoom (double-click header)">&#x26F6;</button>
      <button class="pane-btn settings" title="Change directory">&#9881;</button>
      <button class="pane-btn restart" title="Restart Claude">&#8635;</button>
    </div>
    <div class="pane-terminal"></div>
  `;

  const header = el.querySelector('.pane-header');

  // Click header to activate
  header.addEventListener('click', (e) => {
    if (e.target.closest('.pane-btn')) return;
    setActivePane(pane.id);
  });

  // Double-click header to zoom
  header.addEventListener('dblclick', (e) => {
    if (e.target.closest('.pane-btn')) return;
    toggleZoom(pane.id);
  });

  // Right-click for context menu
  header.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, pane.id);
  });

  // Setup drag-to-swap
  setupDrag(header, pane.id);

  // VS Code button
  el.querySelector('.pane-btn.vscode').addEventListener('click', (e) => {
    e.stopPropagation();
    const dir = paneData[pane.id]?.directory;
    if (dir) window.api.openInVSCode(dir);
  });

  // Zoom button
  el.querySelector('.pane-btn.zoom').addEventListener('click', () => toggleZoom(pane.id));

  // Settings button — project quick-switch dropdown
  el.querySelector('.pane-btn.settings').addEventListener('click', (e) => {
    e.stopPropagation();
    showProjectDropdown(pane.id, el);
  });

  // Restart button
  el.querySelector('.pane-btn.restart').addEventListener('click', () => {
    const overlay = el.querySelector('.pane-overlay');
    if (overlay) overlay.remove();
    el.querySelector('.pane-btn.restart').classList.remove('visible');
    window.api.paneRestart(pane.id);
  });

  // Click anywhere in pane to activate
  el.addEventListener('mousedown', () => setActivePane(pane.id));

  grid.appendChild(el);
  return el;
}

// ── Terminal ──

function initTerminal(pane, container) {
  const termContainer = container.querySelector('.pane-terminal');

  const terminal = new Terminal({
    theme: THEME,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowTransparency: true,
    scrollback: 5000
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon((_, url) => {
    window.api.openExternal(url);
  }));

  terminal.open(termContainer);

  requestAnimationFrame(() => {
    fitAddon.fit();
    window.api.terminalResize(pane.id, terminal.cols, terminal.rows);
  });

  // Intercept shortcuts
  terminal.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;

    // Ctrl+Shift+C: copy selection to clipboard
    if (e.ctrlKey && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
      return false;
    }

    // Ctrl+Shift+V: paste from clipboard
    if (e.ctrlKey && e.shiftKey && e.key === 'V') {
      e.preventDefault();
      navigator.clipboard.readText().then(text => {
        if (text) terminal.paste(text);
      });
      return false;
    }

    // Ctrl+1-9: switch panes
    if (e.ctrlKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const index = parseInt(e.key) - 1;
      const panes = grid.querySelectorAll('.pane');
      if (index < panes.length) {
        const targetId = parseInt(panes[index].dataset.paneId);
        setActivePane(targetId);
        if (zoomedPaneId !== null && zoomedPaneId !== targetId) {
          toggleZoom(zoomedPaneId);
          toggleZoom(targetId);
        }
      }
      return false;
    }

    // Ctrl+Tab / Ctrl+Shift+Tab: cycle panes
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      cyclePanes(e.shiftKey);
      return false;
    }

    // Ctrl+Enter: toggle zoom
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      if (activePaneId !== null) toggleZoom(activePaneId);
      return false;
    }

    // Escape: unzoom
    if (e.key === 'Escape' && zoomedPaneId !== null) {
      toggleZoom(zoomedPaneId);
      return false;
    }

    return true;
  });

  terminal.onData((data) => {
    window.api.terminalInput(pane.id, data);
  });

  // Resize observer with debounce
  let resizeTimeout;
  const observer = new ResizeObserver(() => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      try {
        fitAddon.fit();
        window.api.terminalResize(pane.id, terminal.cols, terminal.rows);
      } catch (e) { /* ignore */ }
    }, 100);
  });
  observer.observe(termContainer);

  terminals[pane.id] = terminal;
  fitAddons[pane.id] = fitAddon;

  window.api.paneSpawn(pane.id);
}

// ── Overlays ──

function showExitOverlay(paneId, exitCode) {
  const paneEl = grid.querySelector(`.pane[data-pane-id="${paneId}"]`);
  if (!paneEl) return;

  paneEl.querySelector('.pane-btn.restart').classList.add('visible');

  const overlay = document.createElement('div');
  overlay.className = 'pane-overlay';
  overlay.innerHTML = `
    <span>Process exited (code ${exitCode})</span>
    <button>Restart Claude</button>
  `;
  overlay.querySelector('button').addEventListener('click', () => {
    overlay.remove();
    paneEl.querySelector('.pane-btn.restart').classList.remove('visible');
    window.api.paneRestart(paneId);
  });
  paneEl.appendChild(overlay);
}

function destroyPane(paneId) {
  const terminal = terminals[paneId];
  if (terminal) {
    terminal.dispose();
    delete terminals[paneId];
    delete fitAddons[paneId];
    delete paneData[paneId];
  }
  const paneEl = grid.querySelector(`.pane[data-pane-id="${paneId}"]`);
  if (paneEl) paneEl.remove();
  if (zoomedPaneId === paneId) {
    grid.classList.remove('zoomed');
    zoomedPaneId = null;
  }
  updateShortcutLabels();
}

// ── IPC Listeners ──

window.api.onTerminalData((paneId, data) => {
  const terminal = terminals[paneId];
  if (terminal) {
    terminal.write(data);
    // Activity indicator: mark pane if not active
    if (paneId !== activePaneId) {
      const paneEl = grid.querySelector(`.pane[data-pane-id="${paneId}"]`);
      if (paneEl && !paneEl.classList.contains('has-activity')) {
        paneEl.classList.add('has-activity');
      }
    }
  }
});

window.api.onPaneExited((paneId, exitCode) => {
  showExitOverlay(paneId, exitCode);
});

window.api.onTerminalReset((paneId) => {
  const terminal = terminals[paneId];
  if (terminal) {
    terminal.clear();
    terminal.reset();
    // Refit after reset so the new PTY gets correct dimensions
    const fa = fitAddons[paneId];
    if (fa) {
      requestAnimationFrame(() => {
        try {
          fa.fit();
          window.api.terminalResize(paneId, terminal.cols, terminal.rows);
        } catch (e) { /* ignore */ }
      });
    }
  }
});

// ── Toolbar Controls ──

document.getElementById('btn-restart-all').addEventListener('click', () => {
  // Clear all overlays
  grid.querySelectorAll('.pane-overlay').forEach(o => o.remove());
  grid.querySelectorAll('.pane-btn.restart.visible').forEach(b => b.classList.remove('visible'));
  window.api.restartAll();
});

document.getElementById('btn-add-pane').addEventListener('click', async () => {
  const pane = await window.api.addPane();
  const index = grid.children.length;
  const el = createPaneElement(pane, index);
  initTerminal(pane, el);
  updatePaneCount(grid.children.length);
});

document.getElementById('btn-remove-pane').addEventListener('click', async () => {
  const panes = grid.querySelectorAll('.pane');
  if (panes.length <= 1) return;
  const lastPane = panes[panes.length - 1];
  const paneId = parseInt(lastPane.dataset.paneId);
  window.api.paneKill(paneId);
  await window.api.removePane(paneId);
  destroyPane(paneId);
  updatePaneCount(grid.children.length);
});

colsInput.addEventListener('change', () => {
  const cols = Math.max(1, Math.min(6, parseInt(colsInput.value) || 3));
  const rows = parseInt(rowsInput.value) || 2;
  setGridLayout(cols, rows);
  window.api.updateConfig({ columns: cols, rows: rows });
});

rowsInput.addEventListener('change', () => {
  const cols = parseInt(colsInput.value) || 3;
  const rows = Math.max(1, Math.min(6, parseInt(rowsInput.value) || 2));
  setGridLayout(cols, rows);
  window.api.updateConfig({ columns: cols, rows: rows });
});

// Window controls
document.getElementById('btn-minimize').addEventListener('click', () => window.api.windowMinimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.api.windowMaximize());
document.getElementById('btn-close').addEventListener('click', () => window.api.windowClose());

// ── Global Keyboard Shortcuts (fallback for when no terminal focused) ──

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
    e.preventDefault();
    const index = parseInt(e.key) - 1;
    const panes = grid.querySelectorAll('.pane');
    if (index < panes.length) {
      const paneId = parseInt(panes[index].dataset.paneId);
      setActivePane(paneId);
      if (zoomedPaneId !== null && zoomedPaneId !== paneId) {
        toggleZoom(zoomedPaneId);
        toggleZoom(paneId);
      }
    }
    return;
  }

  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    cyclePanes(e.shiftKey);
    return;
  }

  if (e.key === 'Escape' && zoomedPaneId !== null) {
    toggleZoom(zoomedPaneId);
    return;
  }

  if (e.ctrlKey && e.key === 'Enter' && activePaneId !== null) {
    e.preventDefault();
    toggleZoom(activePaneId);
    return;
  }
});

// ── Initialize ──

async function init() {
  const config = await window.api.getConfig();
  allProjects = config.panes.map(p => ({ directory: p.directory, label: p.label }));
  setGridLayout(config.columns || 3, config.rows || 2);
  updatePaneCount(config.panes.length);

  config.panes.forEach((pane, index) => {
    const el = createPaneElement(pane, index);
    initTerminal(pane, el);
  });

  // Activate first pane
  if (config.panes.length > 0) {
    setActivePane(config.panes[0].id);
  }

  // Restore zoom state
  if (config.zoomedPaneId) {
    const paneExists = config.panes.some(p => p.id === config.zoomedPaneId);
    if (paneExists) toggleZoom(config.zoomedPaneId);
  }
}

init();
