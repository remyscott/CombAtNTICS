const DEFAULT_BUFFER = 100;
const inputInterval = 1000/60;

export class Client{
  constructor(game) {
    this.game = game;

    this.history = []; //time -> [id -> {state, id}]
    this.currentObjectIds = new Set();
    this.networkBuffer = Number(DEFAULT_BUFFER);
    this.clockOffset = 100
    this.HISTORY_TIME = 1000;
    this.timeSinceInputs = 0;
    this.lastInputsSent = null;

    this.start();

    this.game.events.on('step', (time, delta) => this._onStep(time, delta));
  }

  _onStep(time, delta) {
    this.game.currentMetadata = {objects: this.objectMetadata};
    this.game.currentState = this.getCurrentState();
    this.sendInputsIfItsTimeTo(delta);
  }

  sendInputsIfItsTimeTo(delta) {
    this.timeSinceInputs += delta;
    const inputs = this.game.inputs;
    if (inputs && (this.timeSinceInputs >= inputInterval) && (inputs !== this.lastInputsSent)) {
      this.sendMessage({type: 'input', inputs})
      this.timeSinceInputs -= inputInterval;
      this.lastInputsSent = structuredClone(inputs);
      inputs.buildAFuckingBoxIWantToTest = false;
    }
  }

  start() {
    this.setupWebSocket();
    
    this.ws.addEventListener('open', () => {
      console.log('WebSocket opened');
    });

    this.ws.addEventListener('close', () => {
      console.error('Websocket Closed');
    })


    this.ws.addEventListener('message', (ev) => this.handleMessage(this.parseMessage(ev)));
  }

  setupWebSocket() {
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('game');
    const playerName = urlParams.get('name') || localStorage.getItem('playerName') || 'Unnamed';

    this.ws = new WebSocket(
      `${location.origin.replace(/^http/, "ws")}/?game=${encodeURIComponent(gameId)}&name=${encodeURIComponent(playerName)}`
    );
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
      this.game.console.updateRecord(calibRec, `Calibrated: buffer ${stats.networkBuffer}ms${ext}`, { level: 'info', ttl: 5000 });
    }).catch(err => {
      this.game.console.updateRecord(calibRec, 'Calibration failed — using defaults', { level: 'error', ttl: 5000 });
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
      this.networkBuffer = Math.max(Math.ceil(p90), 1000 / 20);
      this.clockOffset = medianOffset;  
      return { rtts, offsets, validRtts, p90, medianOffset, networkBuffer: this.networkBuffer, clockOffset: this.clockOffset };
    };
  
    return run();
  }

  sendMessage(msg) {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  parseMessage(ev) {
    if (!ev) return null;
    try {
      return (typeof ev.data === 'string') ? JSON.parse(ev.data) : ev.data;
    } catch (e) {
      console.warn('Invalid JSON from websocket, ignoring message:', ev && ev.data, e);
      return null;
    }
  }

  init(msg) {
    this.clientId = msg.clientId;
    this.name = msg.name;
    this.game.playerName = this.name;
    this.game.playerBodyId = msg.bodyId;
    console.log(`Server init recieved at ${Date.now()}`)
    console.log(`clientId: ${this.clientId}`)
    console.info(`Joined game as: ${this.name}`)
    this.startTimeSync();
  }

  handleMessage(msg) {
    if (msg.type === 'init') {
      this.init(msg)
    }

    if (msg.type === 'snapshot') {
      this.handleSnapshot(msg)
    }
  }

  handleSnapshot(msg) {
    this.objectMetadata = msg.metadata;
    this.insertStateIntoHistory({state: msg.state, time: msg.time});
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

  const idx = this.findIdxBinarySearch(this.history, { time: renderServerTime }, this.timeComparator.bind(this));

  let s0 = null, s1 = null;
  if (idx <= 0) {
    s1 = this.history[0];
  } else if (idx >= this.history.length) {
    s0 = this.history[this.history.length - 1];
  } else {
    s1 = this.history[idx];
    s0 = this.history[idx - 1];
  }

  const span = (s1 && s0) ? (s1.time - s0.time) : 0;
  const alpha = span > 0 && s0 ? (renderServerTime - s0.time) / span : 0;

  const interpolatedState = this.lerpStates(s0 ? s0.state : null, s1 ? s1.state : null, alpha) || {};

  for (const [id, state] of Object.entries(interpolatedState)) {
    if (state != null) {                
      result.push(state);               
    }
  }

  return result;
}

  lerp(a, b, alpha) {
    return a + (b - a) * alpha;
  }

  lerpStates(s0, s1, alpha) { //Recursively searches downward through state tree, once it finds numbers with matching key it lerps them
    if (s0 == null) return deepClone(s1);
    if (s1 == null) return deepClone(s0);

    if (typeof s0 === 'number' && typeof s1 === 'number') {
      return this.lerp(s0, s1, alpha);
    }

    if (typeof s0 !== 'object' || typeof s1 !== 'object' || s0 === null || s1 === null) {
      return deepClone(s1);
    }


    const out = Array.isArray(s0) ? [] : {};
    const keys = new Set([...Object.keys(s0), ...Object.keys(s1)]);
    for (const k of keys) {
      const a = s0[k];
      const b = s1[k];
      if (typeof a === 'number' && typeof b === 'number') {
        out[k] = this.lerp(a, b, alpha);
      } else if (typeof a === 'object' && typeof b === 'object' && a != null && b != null) {
        out[k] = this.lerpStates(a, b, alpha); // recurse
      } else {
        // if cannot interpolate, choose the more recent (b), but clone to avoid mutation
        out[k] = deepClone(b !== undefined ? b : a);
      }
    }
    return out;
  }
}

function deepClone(obj) {
  if (obj == null) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const out = {};
  for (const k of Object.keys(obj)) out[k] = deepClone(obj[k]);
  return out;
}
