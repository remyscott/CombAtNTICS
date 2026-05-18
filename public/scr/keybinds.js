// public/keybinds.js
// UI module for editing keybindings. Uses shared/configurableInputs and bindingsManager functions.

import { configurableInputs } from '/shared/inputslisting.js';
import {
  loadBindings,
  saveBindings,
  setBinding,
  clearBinding,
  DEFAULT_BINDINGS,
  exportBindings,
  importBindings
} from './bindingsManager.js'; // adjust path if bindingsManager is located elsewhere

const listEl = document.getElementById('bindingsList');
const resetBtn = document.getElementById('resetBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const statusEl = document.getElementById('status');

let currentBindings = loadBindings();
let waitingFor = null; // action name currently capturing

// Pretty display for KeyboardEvent.code and mouse codes
function humanizeCode(code) {
  if (!code) return 'Unassigned';
  if (code.startsWith('Mouse')) {
    // Mouse0 = left, Mouse1 = middle, Mouse2 = right (standard DOM)
    switch (code) {
      case 'Mouse0': return 'LMB';
      case 'Mouse1': return 'MMB';
      case 'Mouse2': return 'RMB';
      default: return code;
    }
  }
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  switch (code) {
    case 'ArrowUp': return '↑';
    case 'ArrowDown': return '↓';
    case 'ArrowLeft': return '←';
    case 'ArrowRight': return '→';
    case 'Space': return 'Space';
    case 'ShiftLeft': case 'ShiftRight': return 'Shift';
    case 'ControlLeft': case 'ControlRight': return 'Ctrl';
    case 'AltLeft': case 'AltRight': return 'Alt';
    default: return code;
  }
}

function render() {
  listEl.innerHTML = '';
  for (const action of Object.keys(configurableInputs)) {
    const row = document.createElement('div');
    row.className = 'row';

    const name = document.createElement('div');
    name.className = 'action';
    name.textContent = action;

    const binding = document.createElement('div');
    binding.className = 'binding';
    binding.textContent = humanizeCode(currentBindings[action]);

    const controls = document.createElement('div');
    controls.className = 'controls';

    const setBtn = document.createElement('button');
    setBtn.textContent = waitingFor === action ? 'Press any key...' : 'Set';
    setBtn.onclick = () => {
      if (waitingFor === action) {
        waitingFor = null;
        render();
        return;
      }
      waitingFor = action;
      render();
    };

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.onclick = () => {
      currentBindings = clearBinding(action);
      // broadcast change so game can update its adapter
      window.dispatchEvent(new CustomEvent('bindings-changed', { detail: currentBindings }));
      render();
    };

    controls.appendChild(setBtn);
    controls.appendChild(clearBtn);

    row.appendChild(name);
    row.appendChild(binding);
    row.appendChild(controls);
    listEl.appendChild(row);
  }
}

// Helpers to normalize captured values to canonical code strings
function keyboardCodeFromEvent(ev) {
  return ev.code || ev.key;
}

function mouseCodeFromEvent(ev) {
  // ev.button: 0 = left, 1 = middle, 2 = right
  return `Mouse${ev.button}`;
}

function assignBindingForCode(code) {
  // remove duplicates (clear same code from other actions)
  for (const a of Object.keys(currentBindings)) {
    if (currentBindings[a] === code) {
      currentBindings = setBinding(a, null);
    }
  }
  // set and persist to the waiting action
  currentBindings = setBinding(waitingFor, code);
  waitingFor = null;
  // notify running game / scenes
  window.dispatchEvent(new CustomEvent('bindings-changed', { detail: currentBindings }));
  render();
}

// Capture keys globally when in "waitingFor" mode
window.addEventListener('keydown', (ev) => {
  if (!waitingFor) return;
  ev.preventDefault();

  const code = keyboardCodeFromEvent(ev);

  // ignore standalone modifiers
  if (code === 'ShiftLeft' || code === 'ShiftRight' ||
      code === 'ControlLeft' || code === 'ControlRight' ||
      code === 'AltLeft' || code === 'AltRight' ||
      code === 'MetaLeft' || code === 'MetaRight') {
    return;
  }

  assignBindingForCode(code);
}, { passive: false });

// Capture mouse buttons when in "waitingFor" mode
window.addEventListener('mousedown', (ev) => {
  if (!waitingFor) return;
  ev.preventDefault();

  // Convert to canonical mouse code, e.g. "Mouse0"
  const code = mouseCodeFromEvent(ev);

  assignBindingForCode(code);
}, { passive: false });

// Reset to defaults using DEFAULT_BINDINGS from bindingsManager module
resetBtn.addEventListener('click', () => {
  currentBindings = { ...DEFAULT_BINDINGS };
  saveBindings(currentBindings);
  window.dispatchEvent(new CustomEvent('bindings-changed', { detail: currentBindings }));
  status('Reset to defaults');
  render();
});

// Export to console (and copy to clipboard)
exportBtn.addEventListener('click', async () => {
  const json = exportBindings();
  console.log('Exported keybinds:', json);
  try {
    await navigator.clipboard.writeText(json);
    status('Exported to clipboard and console');
  } catch {
    status('Exported to console (copy to clipboard failed)');
  }
});

// Import JSON prompt (simple)
importBtn.addEventListener('click', () => {
  const raw = prompt('Paste keybinds JSON to import (action -> code)');
  if (!raw) return;
  try {
    currentBindings = importBindings(raw);
    window.dispatchEvent(new CustomEvent('bindings-changed', { detail: currentBindings }));
    status('Imported bindings');
    render();
  } catch (e) {
    console.error(e);
    status('Import failed: invalid JSON');
  }
});

function status(text, timeout = 3000) {
  statusEl.textContent = text;
  if (timeout > 0) {
    setTimeout(() => { if (statusEl.textContent === text) statusEl.textContent = ''; }, timeout);
  }
}

// Initial render
render();