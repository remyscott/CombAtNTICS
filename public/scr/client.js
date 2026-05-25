
import { IDEAL_TICK_RATE, TICKS_PER_SNAPSHOT } from '../../shared/settings.js';
import wsClient from '../ws-client.js';
import { lerpStatesFast } from './statelerper.js';

const DEFAULT_BUFFER = 100;
const inputInterval = 1000/60;

export class Client{
  constructor(game) {
    this.game = game;
    this.game.metadata = {bodies: {}, fixtures: {}};
    this.game.client = this;

    this.history = []; //time -> [id -> {state, id}]
    this.networkBuffer = Number(DEFAULT_BUFFER);
    this.clockOffset = 100
    this.HISTORY_TIME = 2500;
    this.timeSinceInputs = 0;
    this.lastInputsSent = null;

    this.start();

    this.game.events.on('step', (time, delta) => this._onStep(time, delta));
  }

  _onStep(time, delta) {
    if (!this.recievedInit) return;
    this.game.currentState = this.getCurrentState();
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
        this.handleBinarySnapshot(event.data);
        return;
      }
      // text messages
      const parsed = this.parseMessage(event.data);
      if (!parsed) return;
      this.handleMessage(parsed);
    };
    this.ws.addEventListener('close', () => {
      window.location.href = 'lobby.html';
    });

    // Optionally, auto-join based on URL query
    const url = new URL(window.location.href);
    const gameId = url.searchParams.get('game');
    const qName = url.searchParams.get('name');
    if (gameId) {
      // send join via ws-client
      const joinRes = await wsClient.join(gameId, qName);
      if (!joinRes.ok) {
        console.warn('Join failed', joinRes.reason);
      } else {
        console.log('Joined game', gameId);
      }
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
      this.networkBuffer = Math.max(50,Math.ceil(p90), TICKS_PER_SNAPSHOT*1000/IDEAL_TICK_RATE);
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

    if (msg.type === 'cameraFocusId') {
      const id = msg.id === null ? null : msg.id;
      this.game.scene.getScene('InWorldObjects').setCameraFocusId(id);
    }
  }

  handleBinarySnapshot(buffer) {
    const dv = new DataView(buffer);
    let offset = 0;

    // header byte
    if (dv.byteLength < 1) return;
    const kind = dv.getUint8(offset); offset += 1; // 0 = full, 1 = partial

    // read 8-byte serverTimeMs
    if (offset + 8 > dv.byteLength) return;
    let serverTimeMs;
    if (typeof dv.getBigUint64 === 'function') {
      serverTimeMs = Number(dv.getBigUint64(offset, true)); // safe to Number() for ms range
    } else {
      // fallback: read two uint32 low/high
      const low = dv.getUint32(offset, true);
      const high = dv.getUint32(offset + 4, true);
      serverTimeMs = (high * 0x100000000) + low; // Number is okay here
    }
    offset += 8;

    // read count
    if (offset + 2 > dv.byteLength) return;
    const N = dv.getUint16(offset, true); offset += 2;

    const parsed = {};
    for (let i = 0; i < N; i++) {
      if (offset + 16 > dv.byteLength) break;
      const id = dv.getUint32(offset, true); offset += 4;
      const x = dv.getFloat32(offset, true); offset += 4;
      const y = dv.getFloat32(offset, true); offset += 4;
      const angle = dv.getFloat32(offset, true); offset += 4;
      parsed[id] = { id, state: { pos: { x, y }, angle } };
    }

    if (kind === 0) { // full
      this.insertStateIntoHistory({ state: parsed, time: serverTimeMs });
    } else if (kind === 1) { // partial
      const baseline = this.getLatestBaselineState();
      const full = this.mergePartialIntoBaseline(baseline, parsed);
      this.insertStateIntoHistory({ state: full, time: serverTimeMs });
    } else {
      console.warn('Unknown binary snapshot kind:', kind);
    }
  }

  // Returns the most recent full-state from the history, or constructs one from game.metadata if none.
  getLatestBaselineState() {
    // Look from the end of history for the most recent state that appears "full".
    // We treat any history entry as a baseline candidate. The server sends full snapshots every TICKS_PER_SNAPSHOT,
    // but if you prefer, you could tag full snapshots with a flag and search for that.
    if (!this.history || this.history.length === 0) {
      // Build a baseline from metadata: instantiate zeroed states for known metadata entries
      const baseline = {};
      for (const idStr of Object.keys(this.game.metadata.bodies || {})) {
        const id = Number(idStr);
        baseline[id] = {
          id,
          state: {
            pos: { x: 0, y: 0 },
            angle: 0
          }
        };
      }
      return baseline;
    }
    // Use the most recent inserted state as baseline
    return structuredClone(this.history[this.history.length - 1].state);
  }

  // Merge partial (subset) into baseline (both are keyed objects). Returns a NEW object.
  mergePartialIntoBaseline(baseline, partial) {
    if (!baseline || Object.keys(baseline).length === 0) return structuredClone(partial || {});
    if (!partial || Object.keys(partial).length === 0) return structuredClone(baseline);

    // copy baseline shallowly and then overwrite keys from partial (deep clone values)
    const out = {};
    for (const [id, entry] of Object.entries(baseline)) {
      out[id] = structuredClone(entry);
    }

    for (const [id, entry] of Object.entries(partial)) {
      // replace entire entity entry with the partial entity info (server sends full per-entity state)
      out[id] = structuredClone(entry);
    }

    return out;
  }

  // Called when we receive a binary snapshot buffer; decodes, merges with baseline, and inserts into history
  insertMergedStateFromBuffer(buffer, serverTime = Date.now()) {
    const partialState = this.decodeOverallState(buffer); // keyed object id -> {id, state}
    // If this partial looks like a full snapshot (i.e., contains a superset of known IDs), you could detect and skip merge.
    // For now, always merge so partials become full.
    const baseline = this.getLatestBaselineState();
    const fullState = this.mergePartialIntoBaseline(baseline, partialState);
    this.insertStateIntoHistory({ state: fullState, time: serverTime });
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

  decodeOverallState(buffer) {
    const dv = new DataView(buffer);
    let offset = 0;
    const result = {};

    // number of entities (uint16)
    if (dv.byteLength < 2) return result;
    const N = dv.getUint16(offset, true); offset += 2;

    for (let i = 0; i < N; i++) {
      if (offset + 16 > dv.byteLength) break; // safety
      const id = dv.getUint32(offset, true); offset += 4;
      const x = dv.getFloat32(offset, true); offset += 4;
      const y = dv.getFloat32(offset, true); offset += 4;
      const angle = dv.getFloat32(offset, true); offset += 4;

      result[id] = {
        id,
        state: {
          pos: { x, y },
          angle
        }
      };
    }

    return result;
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

  findIdxBinarySearch(sortedArr, val, comparator) {
    let low = 0, high = sortedArr.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const cmp = comparator(sortedArr[mid], val);
      if (cmp < 0) low = mid + 1;
      else if (cmp > 0) high = mid;
      else return mid;
    }
    return low;
  }

  insertStateIntoHistory(timeStatePair) {
    const idx = this.findIdxBinarySearch(this.history, timeStatePair, this.timeComparator.bind(this));
    if (idx < this.history.length && this.history[idx].time === timeStatePair.time) {
      this.history[idx] = timeStatePair;
    } else {
      this.history.splice(idx, 0, timeStatePair);
    }

    const cutoff = timeStatePair.time - this.HISTORY_TIME;
    while (this.history.length && this.history[0].time < cutoff) this.history.shift();
  }

  cutoffHistory() {
    
  }

  timeComparator(a, b) {
    return a.time - b.time;
  }

  getCurrentState() {
    return({objects: this.getCurrentObjectStates()});
  }

  getCurrentObjectStates() {
    const renderServerTime = Date.now() + (this.clockOffset || 0) - this.networkBuffer;
    const result = [];

    if (!this.history || this.history.length === 0) return result;

    // if render time is before first sample, clamp to first sample (no interpolation)
    if (renderServerTime <= this.history[0].time) {
      const interpolatedState = this.history[0].state;
      for (const [, state] of Object.entries(interpolatedState)) {
        if (state != null) result.push(state);
      }
      return result;
    }

    // if render time is after last sample, optionally extrapolate small amount, or clamp to last
    const last = this.history[this.history.length - 1];
    if (renderServerTime >= last.time) {
      // Option A: clamp to last sample (safe)
      const interpolatedState = last.state;
      for (const [, state] of Object.entries(interpolatedState)) {
        if (state != null) result.push(state);
      }
      return result;

      // Option B: small extrapolation could be attempted here if you have velocity data
    }

    // find index of first history entry with time >= renderServerTime
    const idx = this.findIdxBinarySearch(this.history, { time: renderServerTime }, this.timeComparator.bind(this));

    // s1 is the sample at or after render time, s0 is the sample before
    const s1 = this.history[idx];
    const s0 = (idx > 0) ? this.history[idx - 1] : null;
    if (!s1) return result; // defensive

    const span = s0 ? (s1.time - s0.time) : 0;
    const alpha = (span > 1e-6 && s0) ? ((renderServerTime - s0.time) / span) : 0;

    // now lerp s0 and s1 states
    const interpolatedState = lerpStatesFast(s0 ? s0.state : null, s1.state, alpha) || {};

    for (const [, state] of Object.entries(interpolatedState)) {
      if (state != null) result.push(state);
    }

    return result;
  }
}