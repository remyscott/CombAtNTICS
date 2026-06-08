
import { IDEAL_TICK_RATE } from '../../shared/settings.js';
import wsClient from '../ws-client.js';
import { lerpStatesFast } from './statelerper.js';
import { StateManager } from './stateManager.js';

const DEFAULT_BUFFER = 100;
const inputInterval = 1000/60;

export class Client{
  constructor() {
    this.timeSinceInputs = 0;
    this.lastInputsSent = null;
    this.start();

  }

  setGame(game) {
    this.game = game;
    this.game.events.on('step', (time, delta) => this._onStep(time, delta));
  }

  _onStep(time, delta) {
    if (!this.recievedInit) return;
    this.sendInputsIfItsTimeTo(delta);
  }

  sendInputsIfItsTimeTo(delta) {
    this.timeSinceInputs += delta;
    const inputs = {actions: this.game.inputs, default: {mousePosRel: this.game.mousePosRel}};
    if (inputs && (this.timeSinceInputs >= inputInterval)) {
      this.sendMessage({type: 'input', inputs})
      this.timeSinceInputs -= inputInterval;
    }
  }

  async start() {
    await wsClient.connect();
    this.ws = wsClient.ws;
    this.stateManager = new StateManager(this.ws, this.game);

    // Wait briefly for auth result (auto-auth on connect). If you need to require auth:
    const auth = await wsClient.waitForAuth(500);
    if (!auth.ok) {
      console.warn('Not authenticated (or auth timed out). Redirect to login.');
      window.location.href = '/login.html';
      return;
    } else {
      console.log('Authenticated via session token:', auth.msg?.account?.username);
    }

    // Wire up incoming server messages
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.stateManager.handleBinarySnapshot(event.data);
        return;
      }
      const parsed = this.parseMessage(event.data);
      if (!parsed) return;
      this.handleMessage(parsed);
    };
    this.ws.addEventListener('close', () => {
      window.location.href = 'lobby.html';
    });

    const url = new URL(window.location.href);
    const gameId = url.searchParams.get('game');
    if (gameId) this.joinGame(gameId);
  }

  async joinGame(id) {
    const joinRes = await wsClient.join(id);
    if (!joinRes.ok) {
      console.warn('Join failed', joinRes.reason);
    } else {
      console.log('Joined game', id);
    }
  } 


  startTimeSync({count = 25, interval = 1, timeout = 1000 } = {}) {
    console.log('Calibrating buffer ...');

    const result = this.timeSyncAI({ count, interval, timeout}, (prog) => {
      if (prog && typeof prog.index === 'number') {
        const completed = Math.min(prog.index + 1, prog.count);
        const text = `Calib ${completed}/${prog.count}: ${prog.ok ? prog.rtt + 'ms' : 'timeout'}`;
        this.game.console.updateRecord(calibRec, text, { level: prog.ok ? 'info' : 'warn', ttl: timeout*2 });
      }
    });
    
    const calibRec = this.game.console.log('Calibrating: 0 / 0 pings', { level: 'info', ttl: timeout*2 });
    
    const promise = result && result.promise ? result.promise : result;
    promise.then(stats => {
      this.stateManager.updateNetworkBufferAndClockOffset(stats.networkBuffer, stats.clockOffset);
      let ext = stats.networkBuffer === 50 ? ' (minimum buffer)' : '';
      this.game.console.updateRecord(calibRec, `Calibrated: buffer ${stats.networkBuffer}ms${ext}`, { level: 'info' });
    }).catch(err => {
      this.game.console.updateRecord(calibRec, 'Calibration failed — using defaults', { level: 'error' });
    });
  }

  // this AI function is deadass so fucking long, I'll rewrite it by hand sometime.
  timeSyncAI({ count = 8, interval = 50, timeout = 500 } = {}, onProgress) {
    this._timeSyncPending = this._timeSyncPending || new Map();
  
    const onMessage = (ev) => {
      let msg;
      try {
        msg = (typeof ev.data === 'string') ? JSON.parse(ev.data) : ev.data;
      } catch (e) {
        console.warn('parse error in onMessage', e, ev && ev.data);
        return;
      }
      if (!msg || msg.type !== 'timeSyncResp' || typeof msg.id !== 'number') return;

      const id = msg.id
      const pending = this._timeSyncPending.get(id);
      if (!pending) return;
  
      const t1 = Date.now();
      const t0 = pending.t0;
      clearTimeout(pending.timer);
      this._timeSyncPending.delete(id);
  
      const rtt = t1 - t0;
      const serverTime = (typeof msg.serverTime === 'number') ? msg.serverTime : null;
      const offset = (serverTime != null) ? (serverTime - (t0 + rtt / 2)) : null;
  
      if (typeof onProgress === 'function') {
        try { onProgress({ index: pending.index, count, rtt, offset, ok: true }); } catch (e) { /* ignore UI errors */ }
      }
  
      pending.resolve({ id, rtt, serverTime, offset });
    };
  
    this.ws.addEventListener('message', onMessage);
  
    const rtts = [];
    const offsets = [];
    let nextId = 0;
  
    const pingOnce = (id, index) => {
      return new Promise((resolve, reject) => {
        const t0 = Date.now();
        let settled = false;
  
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          this._timeSyncPending.delete(id);
          if (typeof onProgress === 'function') {
            try { onProgress({ index, count, rtt: timeout, offset: null, ok: false }); } catch (e) {}
          }
          reject(new Error('timeSync timeout'));
        }, timeout);
  
        this._timeSyncPending.set(id, {
          t0,
          timer,
          index,
          resolve: (payload) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(payload);
          },
          reject: (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        });
  
        try {
          const payload = { type: 'timeSync', id };
          this.ws.send(JSON.stringify(payload));
        } catch (e) {
          const pending = this._timeSyncPending.get(id);
          if (pending) {
            clearTimeout(pending.timer);
            this._timeSyncPending.delete(id);
          }
          if (typeof onProgress === 'function') {
            try { onProgress({ index, count, rtt: timeout, offset: null, ok: false }); } catch (e) {}
          }
          reject(e);
        }
      });
    };
  
    // helper: compute quantile (R-7 style). sorts the array internally.
    const quantile = (arr, p) => {
      if (!arr || arr.length === 0) return undefined;
      const a = arr.slice().sort((x, y) => x - y);
      const n = a.length;
      if (p <= 0 || n < 2) return +a[0];
      if (p >= 1) return +a[n - 1];
      const i = (n - 1) * p;
      const i0 = Math.floor(i);
      const v0 = +a[i0];
      const v1 = +a[i0 + 1];
      return v0 + (v1 - v0) * (i - i0);
    };
  
    const run = async () => {
      for (let i = 0; i < count; i++) {
        const id = nextId++;
        try {
          const res = await pingOnce(id, i);
          rtts.push(res.rtt);
          if (typeof res.offset === 'number') offsets.push(res.offset);
        } catch (e) {
          // treat this ping as a timeout sample; push the timeout sentinel
          rtts.push(timeout);
        }
        if (i < count - 1) await new Promise(r => setTimeout(r, interval));
      }
  
      this.ws.removeEventListener('message', onMessage);
  
      // Filter out timeout sentinel values so they don't skew the percentile
      const validRtts = rtts.filter(x => typeof x === 'number' && x < timeout);
  
      // If no valid RTTs, fall back to the timeout value (conservative)
      const p90 = (validRtts.length > 0) ? quantile(validRtts, 0.9) : timeout;
  
      const medianOffset = (offsets.length === 0) ? 0 : (() => {
        const arr = offsets.slice().sort((a, b) => a - b);
        const mid = Math.floor(arr.length / 2);
        return (arr.length % 2 === 1) ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
      })();
  
      // use p90 (scaled) as the network buffer, keep a minimum floor
      this.networkBuffer = Math.max(50,Math.ceil(p90));
      this.clockOffset = medianOffset;  
      return { rtts, offsets, validRtts, p90, medianOffset, networkBuffer: this.networkBuffer, clockOffset: this.clockOffset };
    };
  
    return run();
  }

  sendMessage(obj) {
    wsClient.send(obj);
  };

  parseMessage(data) {
  if (!data) return null;
    try {
      // if it's already an object (maybe someone passed parsed JSON) return it
      if (typeof data === 'object') return data;
      // otherwise try to parse string JSON
      if (typeof data === 'string') return JSON.parse(data);
      // otherwise unknown type — return as-is
      return data;
    } catch (e) {
      console.warn('Invalid JSON from websocket, ignoring message:', data, e);
      return null;
    }
  }

  init(msg) {
    this.recievedInit = true;
    this.clientId = msg.clientId;
    this.name = msg.name;
    this.game.playerName = this.name;
    this.game.playerBodyId = msg.bodyId;
    console.log(`Server init recieved at ${Date.now()}`)
    console.log(`clientId: ${this.clientId}`)
    console.info(`Joined game as: ${this.name}`)
    console.info(`Enter to chat, / for commands`)
    this.startTimeSync();
  }

  handleMessage(msg) {
    if (msg.type === 'events') {
      if (Array.isArray(msg.events)) {
        this.stateManager.pushEvents(...msg.events);
      }
    }

    if (msg.type === 'chatMsg') {
      this.game.scene.getScene('UI').displayMessage(msg.msg, msg.nameOfSender, msg.senderRoles)
    }

    if (msg.type === 'init') {
      this.init(msg)
    }

    if (msg.type === 'newMetadata') {
      this.handleNewMetadata(msg)
    }

    if (msg.type === 'metadataResponse') {
      this.handleMetadataResponse(msg)
    }
  }

  handleNewMetadata(msg) {
    if (msg.newMetadata) {
      this.game.metadata.bodies = {
        ...this.game.metadata.bodies,
        ...msg.newMetadata.bodies
      };

      this.game.metadata.fixtures = {
        ...this.game.metadata.fixtures,
        ...msg.newMetadata.fixtures
      };
    }
  }

  requestMetadata() {
    this.sendMessage({type: 'metadataRequest'});
  }

  handleMetadataResponse(msg) {
    if (!msg || !msg.metadata) return;

    const bodies = msg.metadata.bodies || {};
    const fixtures = msg.metadata.fixtures || {};

    // ensure metadata containers exist
    if (!this.game.metadata) this.game.metadata = { bodies: {}, fixtures: {} };
    if (!this.game.metadata.bodies) this.game.metadata.bodies = {};
    if (!this.game.metadata.fixtures) this.game.metadata.fixtures = {};

    // Add-only merge for bodies
    for (const [id, meta] of Object.entries(bodies)) {
      // only add if key is not already present
      if (!(id in this.game.metadata.bodies)) {
        this.game.metadata.bodies[id] = meta;
      }
    }

    // Add-only merge for fixtures
    for (const [id, meta] of Object.entries(fixtures)) {
      if (!(id in this.game.metadata.fixtures)) {
        this.game.metadata.fixtures[id] = meta;
      }
    }
  }
}