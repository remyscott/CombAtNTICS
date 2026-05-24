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

function createAdminPanel(container) {
  // Build DOM elements
  const panel = document.createElement('div');
  panel.style.border = '1px dashed #ccc';
  panel.style.padding = '8px';
  panel.style.marginTop = '12px';
  panel.style.borderRadius = '6px';
  panel.innerHTML = `
    <strong>Admin Console</strong>
    <div style="margin-top:8px;">
      <label>Command
        <select id="adminCmdSelect">
          <option value="listGames">listGames</option>
          <option value="list-sessions">list-sessions</option>
          <option value="kick">kick</option>
          <option value="broadcast">broadcast</option>
        </select>
      </label>
    </div>
    <div style="margin-top:8px;">
      <label>Args (JSON)
        <textarea id="adminArgs" rows="4" style="width:100%;box-sizing:border-box;">{}</textarea>
      </label>
    </div>
    <div style="margin-top:8px;" class="row">
      <button id="adminSendBtn">Send</button>
      <button id="adminClearBtn">Clear</button>
      <span id="adminStatus" style="margin-left:12px;color:#666"></span>
    </div>
    <pre id="adminResult" style="margin-top:8px;background:#0b1220;color:#d7e1f1;padding:8px;height:120px;overflow:auto;border-radius:6px;"></pre>
  `;
  container.appendChild(panel);

  const cmdSelect = panel.querySelector('#adminCmdSelect');
  const argsEl = panel.querySelector('#adminArgs');
  const sendBtn = panel.querySelector('#adminSendBtn');
  const clearBtn = panel.querySelector('#adminClearBtn');
  const status = panel.querySelector('#adminStatus');
  const result = panel.querySelector('#adminResult');

  // Send admin command
  sendBtn.addEventListener('click', async () => {
    let args = {};
    try {
      args = argsEl.value ? JSON.parse(argsEl.value) : {};
    } catch (e) {
      status.textContent = 'Invalid JSON in args';
      status.style.color = 'red';
      return;
    }
    const cmd = cmdSelect.value;
    status.textContent = 'Sending...';
    status.style.color = '#666';
    // ensure connected
    await wsClient.connect();
    // send admin command
    wsClient.send({ type: 'admin', cmd, args });
    // wait for admin.res matching cmd (one-off listener)
    const onRes = (msg) => {
      if (msg && msg.cmd === cmd) {
        result.textContent = JSON.stringify(msg, null, 2);
        status.textContent = msg.ok ? 'OK' : 'ERROR';
        status.style.color = msg.ok ? 'green' : 'red';
        wsClient.off('admin.res', onRes);
      }
    };
    wsClient.on('admin.res', onRes);
    // also set a timeout
    setTimeout(() => {
      wsClient.off('admin.res', onRes);
      if (!result.textContent) {
        result.textContent = 'No response (timeout)';
        status.textContent = 'timeout';
        status.style.color = 'red';
      }
    }, 5000);
  });

  clearBtn.addEventListener('click', () => {
    argsEl.value = '{}';
    result.textContent = '';
    status.textContent = '';
  });
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
      // show admin panel if account has admin role or email in ADMIN_EMAILS
      const acct = msg.account || {};
      const isAdmin = (Array.isArray(acct.roles) && acct.roles.includes('admin'))
        || (process && process.env && process.env.ADMIN_EMAILS && process.env.ADMIN_EMAILS.split(',').map(s=>s.trim().toLowerCase()).includes((acct.email||'').toLowerCase()));
      if (isAdmin) {
        // Ensure admin panel shown only once
        if (!document.getElementById('adminResult')) {
          createAdminPanel(document.getElementById('lobby-panel'));
        }
      }
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
  setInterval(refreshGames, 5000);

  joinBtn?.addEventListener('click', async () => {
    const gameId = 'game' + Math.floor(Math.random()*1000);
    setStatus('Creating and joining ' + gameId + '...', 'muted');
    log('Creating game', gameId);
    try {
      await wsClient.connect();
      const res = await wsClient.join(gameId);
      if (res.ok) {
        log('Created & joined', res);
        window.location.href = `game.html?game=${encodeURIComponent(gameId)}`;
      } else {
        setStatus('Failed to create/join: ' + (res.reason || 'timeout'), 'bad');
        log('Create/join failed', res);
      }
    } catch (e) {
      setStatus('Create/join error', 'bad');
      log('Create/join error', e);
    }
  });
});