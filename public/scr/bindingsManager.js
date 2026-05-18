// bindingsManager.js
// Engine-agnostic bindings manager.
// Import the canonical actions from shared.
import { configurableInputs } from '/shared/inputslisting.js';
import { defaultBindings } from '../../shared/inputsListing.js';
const STORAGE_KEY = 'mygame.keybinds.v1';

// Default bindings (action -> KeyboardEvent.code)
export const DEFAULT_BINDINGS = defaultBindings;

export function loadBindings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const merged = {};
    for (const action of Object.keys(configurableInputs)) {
      merged[action] = parsed[action] ?? DEFAULT_BINDINGS[action] ?? null;
    }
    return merged;
  } catch (e) {
    console.error('Failed to load keybinds, using defaults', e);
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveBindings(bindings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

// Set one binding and persist
export function setBinding(action, code) {
  const current = loadBindings();
  current[action] = code;
  saveBindings(current);
  return current;
}

// Clear a binding and persist
export function clearBinding(action) {
  const current = loadBindings();
  current[action] = null;
  saveBindings(current);
  return current;
}

// Utility to export/import JSON string
export function exportBindings() {
  return JSON.stringify(loadBindings(), null, 2);
}

export function importBindings(json) {
  const parsed = JSON.parse(json);
  // sanitize: keep only known actions
  const sanitized = {};
  for (const action of Object.keys(configurableInputs)) {
    sanitized[action] = parsed[action] ?? DEFAULT_BINDINGS[action] ?? null;
  }
  saveBindings(sanitized);
  return sanitized;
}