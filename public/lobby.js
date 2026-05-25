// public/lobby.js
import wsClient from './ws-client.js';

const nameInput = document.getElementById('nameInput');
const saveNameBtn = document.getElementById('saveNameBtn');
const joinBtn = document.getElementById('joinBtn');
const gameList = document.getElementById('gameList');
const statusEl = document.getElementById('lobbyStatus');
const logEl = document.getElementById('lobbyLog');

function log(...args) {
  const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `[${new Date().toLocaleTimeString()}] ${s}\n`;
  if (logEl) logEl.textContent = line + logEl.textContent;
}
function setStatus(msg, kind = 'muted') {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = kind === true || kind === 'good' ? 'good' : kind === false || kind === 'bad' ? 'bad' : 'muted';
}

function sanitizeName(n){ n = String(n||'').trim(); return n.length>25 ? n.slice(0,25) : n; }

async function refreshGames(){
  try {
    setStatus('Loading games...', 'muted');
    const res = await fetch('/games');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const list = await res.json();
    gameList.innerHTML = '';
    list.forEach(g => {
      const li = document.createElement('li');
      li.className = 'game-entry';
      li.innerHTML = `<span class="game-id">${g.id}</span> <span class="game-meta">${g.players} players</span>`;
      li.addEventListener('click', async () => {
        const gameId = g.id;
        setStatus('Joining game ' + gameId + '...', null);
        log('Attempting join', gameId);
        try {
          await wsClient.connect();
          const res = await wsClient.join(gameId);
          if (res.ok) {
            log('Join ack received', res);
            setStatus('Joined ' + gameId, 'good');
            window.location.href = `game.html?game=${encodeURIComponent(gameId)}`;
          } else {
            log('Join failed', res);
            setStatus('Join failed: ' + (res.reason || 'timeout'), 'bad');
          }
        } catch (e) {
          log('Join error', e);
          setStatus('Join error', 'bad');
        }
      });
      gameList.appendChild(li);
    });
    setStatus('Games loaded', 'good');
  } catch (e) {
    console.error('fetch games', e);
    log('Failed to fetch games: ' + (e && e.message ? e.message : e));
    setStatus('Failed to load games', 'bad');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const saved = localStorage.getItem('playerName');
  if (saved) nameInput.value = saved;

  // connect WS and auto-auth
  try {
    setStatus('Connecting...', 'muted');
    await wsClient.connect();
    setStatus('Connected', 'good');
    log('WS connected');

    wsClient.on('auth.ok', (msg) => {
      setStatus('Signed in as ' + (msg.account?.displayName || msg.account?.email), 'good');
      log('auth.ok', msg.account);
      const acct = msg.account || {};
    });

    wsClient.on('auth.fail', (msg) => {
      setStatus('Not signed in', 'bad');
      log('auth.fail', msg);
      if (msg && msg.reason === 'invalid_or_expired') {
        localStorage.removeItem('sessionToken');
      }
    });
  } catch (e) {
    setStatus('Connection failed', 'bad');
    log('WS connect error', e);
  }

  // Save name to server (explicit button).
  saveNameBtn?.addEventListener('click', async () => {
    const name = sanitizeName(nameInput.value || '');
    if (!name) { alert('Enter a name'); return; }
    localStorage.setItem('playerName', name);
    try {
      await wsClient.connect();
      wsClient.send({ type: 'updateDisplayName', displayName: name });
      setStatus('Saved name (sent to server)', 'good');
      log('Sent updateDisplayName', name);
    } catch (e) {
      setStatus('Failed to save name', 'bad');
      log('updateDisplayName error', e);
    }
  });

  refreshGames();
  setInterval(refreshGames, 500);

  joinBtn?.addEventListener('click', async () => {
    const gameId = 'game' + Math.floor(Math.random() * 1000);
    setStatus('Creating and joining ' + gameId + '...', 'muted');
    log('Creating game', gameId);

    try {
      const res = await wsClient.join(gameId);
      if (res.ok) {
        // update URL without reloading the page
        const newUrl = `game.html?game=${encodeURIComponent(gameId)}`;

        setStatus(`Joined ${gameId}`, 'success');
        log('Joined game', res);
        window.location.href = newUrl;
      } else {
        setStatus(`Failed to join: ${res.reason}`, 'error');
        if (res.reason === 'not_logged_in') {
          window.location.href = 'login.html';
        }
        console.warn('join failed', res);
      }
    } catch (err) {
      setStatus('Join error', 'error');
      console.error('join() threw', err);
    }
  });
});