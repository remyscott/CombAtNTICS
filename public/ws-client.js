// public/ws-client.js
const WS_URL = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/';

class WSClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.sessionToken = localStorage.getItem('sessionToken') || null;
    this.account = null;
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
  getAccount() { return this.account; }

  // --- high-level operations ---

  // Sign in over WS: resolves {ok:true, account, sessionToken} or {ok:false, reason}
  async signin(email, password) {
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
      this.send({ type: 'signin', email, password });
    });
  }

  // Sign up over WS: resolves {ok:true, account, sessionToken} or {ok:false, reason}
  async signup(email, password, displayName) {
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
      this.send({ type: 'signup', email, password, displayName });
    });
  }

  // Join a game by id. Optionally pass a name override (server may prefer account displayName).
  // Resolves {ok:true, gameId, clientId} or {ok:false, reason}
  async join(gameId, name) {
    await this.connect();
    return new Promise((resolve) => {
      const onAck = (msg) => {
        if (msg && msg.gameId === gameId) {
          cleanup();
          resolve({ ok: true, gameId: msg.gameId, clientId: msg.clientId });
        }
      };
      const cleanup = () => { this.off('joinAck', onAck); clearTimeout(timer); };
      this.on('joinAck', onAck);
      const timer = setTimeout(() => {
        this.off('joinAck', onAck);
        resolve({ ok: false, reason: 'timeout' });
      }, 5000);
      const payload = { type: 'join', gameId };
      if (name) payload.name = name;
      this.send(payload);
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
    }
  }

  // internal: store account & token when auth.ok arrives
  _autoStoreAuth(msg) {
    if (!msg) return;
    if (msg.account) this.account = msg.account;
    if (msg.sessionToken) {
      this.sessionToken = msg.sessionToken;
      localStorage.setItem('sessionToken', msg.sessionToken);
    }
  }

  // Optional: when server sends auth.ok, capture account & token locally
  _initAutoAccountTracking() {
    // keep internal state in sync if server sends auth.ok at any time
    this.on('auth.ok', (msg) => this._autoStoreAuth(msg));
    this.on('auth.fail', (msg) => {
      if (msg && msg.reason === 'invalid_or_expired') {
        this.sessionToken = null;
        localStorage.removeItem('sessionToken');
      }
    });
  }
}

const client = new WSClient();
client._initAutoAccountTracking();
export default client;