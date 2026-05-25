// public/ws-client.js
const WS_URL = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/';

class WSClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.sessionToken = localStorage.getItem('sessionToken') || null;
    this.account = null;
    // If an account JSON is stored, keep in-memory in sync on startup
    try {
      const saved = localStorage.getItem('account');
      if (saved) this.account = JSON.parse(saved);
    } catch (e) {
      // ignore parse errors
      localStorage.removeItem('account');
      this.account = null;
    }
    this._connectPromise = null;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);

      this.ws.addEventListener('open', () => {
        // Auto-auth on open if we have a stored token
        if (this.sessionToken) {
          this.send({ type: 'auth', token: this.sessionToken });
        }
        resolve();
        this._connectPromise = null;
      });

      this.ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        this._emit(msg.type, msg);
        this._emit('__any', msg);
      });

      this.ws.addEventListener('close', () => this._emit('__close'));
      this.ws.addEventListener('error', (err) => this._emit('__error', err));
    });

    return this._connectPromise;
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WS not open, cannot send', obj);
      return false;
    }
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  on(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(cb);
    return () => this.off(type, cb);
  }

  off(type, cb) {
    if (!this.listeners.has(type)) return;
    this.listeners.get(type).delete(cb);
  }

  _emit(type, payload) {
    const set = this.listeners.get(type);
    if (set) for (const cb of set) try { cb(payload); } catch (e) { console.error(e); }
  }

  waitForAuth(timeout = 3000) {
    return new Promise((resolve) => {
      let done = false;
      const onOk = (msg) => { if (done) return; done = true; cleanup(); resolve({ ok: true, msg }); };
      const onFail = (msg) => { if (done) return; done = true; cleanup(); resolve({ ok: false, msg }); };
      const cleanup = () => { this.off('auth.ok', onOk); this.off('auth.fail', onFail); };
      this.on('auth.ok', onOk);
      this.on('auth.fail', onFail);
      setTimeout(() => { if (done) return; done = true; cleanup(); resolve({ ok: false, reason: 'timeout' }); }, timeout);
    });
  }

  getToken() { return this.sessionToken; }
  getAccount() {
    if (this.account) return this.account;
    try {
      const saved = localStorage.getItem('account');
      if (saved) {
        this.account = JSON.parse(saved);
        return this.account;
      }
    } catch (e) {
      localStorage.removeItem('account');
    }
    return null;
  }

  // --- high-level operations ---

  async signin(username, password) {
    await this.connect();
    return new Promise((resolve) => {
      const onOk = (msg) => {
        this._autoStoreAuth(msg);
        this.off('auth.ok', onOk);
        this.off('signin.fail', onFail);
        resolve({ ok: true, account: msg.account, sessionToken: msg.sessionToken });
      };
      const onFail = (msg) => {
        this.off('auth.ok', onOk);
        this.off('signin.fail', onFail);
        resolve({ ok: false, reason: msg.reason });
      };
      this.on('auth.ok', onOk);
      this.on('signin.fail', onFail);
      this.send({ type: 'signin', username, password });
    });
  }

  async signup(username, password, displayName) {
    await this.connect();
    return new Promise((resolve) => {
      const onOk = (msg) => {
        this._autoStoreAuth(msg);
        this.off('auth.ok', onOk);
        this.off('signup.fail', onFail);
        resolve({ ok: true, account: msg.account, sessionToken: msg.sessionToken });
      };
      const onFail = (msg) => {
        this.off('auth.ok', onOk);
        this.off('signup.fail', onFail);
        resolve({ ok: false, reason: msg.reason });
      };
      this.on('auth.ok', onOk);
      this.on('signup.fail', onFail);
      this.send({ type: 'signup', username, password, displayName });
    });
  }

  async join(gameId) {
    await this.connect();
    return new Promise((resolve) => {
      const onAck = (msg) => {
        if (!msg || msg.type !== 'joinAck') return;
        // if server explicitly failed the join, resolve immediately
        if (msg.ok === false) {
          cleanup();
          resolve({ ok: false, reason: msg.reason, gameId: msg.gameId || null });
          return;
        }
        // success matching our requested game
        if (msg.ok === true && msg.gameId === gameId) {
          cleanup();
          resolve({ ok: true, gameId: msg.gameId, clientId: msg.clientId });
        }
      };
      const cleanup = () => { this.off('joinAck', onAck); clearTimeout(timer); };
      this.on('joinAck', onAck);
      const timer = setTimeout(() => { cleanup(); resolve({ ok: false, reason: 'timeout' }); }, 5000);
      this.send({ type: 'join', gameId });
    });
  }

  leave() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.send({ type: 'leave' });
    return true;
  }

  logout() {
    if (this.sessionToken) {
      this.send({ type: 'logout', token: this.sessionToken });
      this.sessionToken = null;
      localStorage.removeItem('sessionToken');
      this.account = null;
      localStorage.removeItem('account');
    }
  }

  // internal: store account & token when auth.ok arrives
  _autoStoreAuth(msg) {
    if (!msg) return;
    if (msg.account) {
      this.account = msg.account;
      try { localStorage.setItem('account', JSON.stringify(msg.account)); } catch (e) { /* ignore */ }
    }
    if (msg.sessionToken) {
      this.sessionToken = msg.sessionToken;
      localStorage.setItem('sessionToken', msg.sessionToken);
    }
  }

  _initAutoAccountTracking() {
    this.on('auth.ok', (msg) => this._autoStoreAuth(msg));
    this.on('auth.fail', (msg) => {
      if (msg && msg.reason === 'invalid_or_expired') {
        this.sessionToken = null;
        localStorage.removeItem('sessionToken');
        this.account = null;
        localStorage.removeItem('account');
        window.location.href = 'login.html';
      }
    });
  }
}

const client = new WSClient();
client._initAutoAccountTracking();
export default client;