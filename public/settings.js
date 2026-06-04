const STORAGE_KEY = 'ppmResolution';
const ppmInput = document.getElementById('ppmInput');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

function formatValue(value) {
  return Number.isFinite(value) ? String(value) : '';
}

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff6666' : '#c2c2ff';
}

document.addEventListener('DOMContentLoaded', () => {
  const raw = parseFloat(localStorage.getItem(STORAGE_KEY));
  ppmInput.value = formatValue(Number.isFinite(raw) ? raw : 50);
});

saveBtn?.addEventListener('click', () => {
  const value = parseFloat(ppmInput.value);
  if (!Number.isFinite(value) || value <= 0) {
    setStatus('Enter a positive numeric render resolution.', true);
    return;
  }
  localStorage.setItem(STORAGE_KEY, String(value));
  setStatus(`Saved render resolution: ${value} ppm.`);
});