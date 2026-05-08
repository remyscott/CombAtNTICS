export class Client{
  constructor(scene) {

    this.scene = scene;
    this.playerStatesByServerTime = new Map(); //name -> [{time, state}]
    this.currentPlayerNames = new Set();
    this.DEFAULT_BUFFER = 100
    this.networkBuffer = this.DEFAULT_BUFFER;
    this.clockOffset = 100
    this.HISTORY_TIME = 1000;
    this.setupWebSocket();
  }

  setupWebSocket() {
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('game');
    const playerName = urlParams.get('name') || localStorage.getItem('playerName') || 'Unnamed';

    this.ws = new WebSocket(
      `${location.origin.replace(/^http/, "ws")}/?game=${encodeURIComponent(gameId)}&name=${encodeURIComponent(playerName)}`
    );

    this.ws.addEventListener('close', () => {
      console.error('Websocket Closed');
    })

    this.ws.addEventListener('open', () => {
      console.log('WebSocket opened');
      
      this.startTimeSync();
    });

    this.ws.addEventListener('message', (ev) => this.handleMessage(this.parseMessage(ev)));
  }

  startTimeSync() {
    console.log('Calibrating buffer ...');

    const result = this.timeSyncAI({ count: 25, interval: 1, timeout: 500 }, (prog) => {
      if (prog && typeof prog.index === 'number') {
        const completed = Math.min(prog.index + 1, prog.count);
        const text = `Calib ${completed}/${prog.count}: ${prog.ok ? prog.rtt + 'ms' : 'timeout'}`;
        this.scene.gameConsole.updateRecord(calibRec, text, { level: prog.ok ? 'info' : 'warn' });
      }
    });
    
    const calibRec =this.scene.gameConsole.log('Calibrating: 0 / 0 pings', { level: 'info', ttl: 0 });
    
    const promise = result && result.promise ? result.promise : result;
    promise.then(stats => {
      let ext = stats.networkBuffer === 50 ? ' (minimum buffer)' : '';
      this.scene.gameConsole.updateRecord(calibRec, `Calibrated: buffer ${stats.networkBuffer}ms${ext}`, { level: 'info', ttl: 5000 });
    }).catch(err => {
      this.scene.gameConsole.updateRecord(calibRec, 'Calibration failed — using defaults', { level: 'error', ttl: 5000 });
    });
  }

  // this AI function is deadass so fucking long, I'll rewrite it by hand sometime.
  timeSyncAI({ count = 8, interval = 50, timeout = 500 } = {}, onProgress) {
  
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not open'));
    }
  
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
  
      const id = msg.id;
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


  handleMessage(msg) {
    if (msg.type === 'init') {
      if (!this.recievedInit) {
        this.clientId = msg.clientId;
        this.name = msg.name;
        this.scene.playerName = this.name;
        this.recievedInit = true;
        console.log(`Server init recieved at ${Date.now()}`)
        console.info(`Joined game as: ${this.name} with clientID ${this.clientId}`)
      }
    }

    if (msg.type === 'playerSnapshot') {
      this.currentPlayerNames = new Set(msg.players.map(e => e.name).filter(Boolean));

      for (const {name, state, time} of msg.players) {
        const history = this.playerStatesByServerTime.get(name) || [];
        const stateTimePair = {state, time};
        this.insertStateIntoHistory(history, stateTimePair);

        this.playerStatesByServerTime.set(name, history);
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

  insertStateIntoHistory(history, timeStatePair) {
    const idx = this.findIdxBinarySearch(history, timeStatePair, this.timeComparator.bind(this));
    // If identical timestamp exists, replace with new one
    if (idx < history.length && history[idx].time === timeStatePair.time) {
      history[idx] = timeStatePair;
    } else {
      history.splice(idx, 0, timeStatePair);
    }


    // delete old states
    const cutoff = timeStatePair.time - this.HISTORY_TIME;
    while (history.length && history[0].time < cutoff) history.shift();
  }

  timeComparator(a, b) {
    return a.time - b.time;
  }

  getCurrentState() {
    return({players: this.getCurrentPlayerStates()});
  }

  getCurrentPlayerStates() {
    const renderServerTime = Date.now() + (this.clockOffset || 0) - this.networkBuffer;
    const result = [];

    for (const name of this.currentPlayerNames) {
      const history = this.playerStatesByServerTime.get(name);
      if (!history || history.length === 0) continue;

      if (renderServerTime <= history[0].time) {
        result.push([name, deepClone(history[0].state)]);
        continue;
      }

      const lastIdx = history.length - 1;
      if (renderServerTime >= history[lastIdx].time) {
        result.push([name, deepClone(history[lastIdx].state)]);
        continue;
      }

      const idx = this.findIdxBinarySearch(history, {time: renderServerTime}, this.timeComparator.bind(this));

      const s1 = history[idx];
      const s0 = history[idx - 1];

      const span = s1.time - s0.time;
      const alpha = span > 0 ? (renderServerTime - s0.time) / span : 0;

      result.push([name, this.lerpStates(s0.state, s1.state, alpha)]);
    }

    return result;
  }

  lerp(a, b, alpha) {
    return a + (b - a) * alpha;
  }

  lerpStates(s0, s1, alpha) { //Recursively searches downward through state tree, once it finds numbers with matching key it lerps them
    // If either is missing, return clone of the one that exists
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