export class Client{
  constructor() {
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('game');
    const playerName = urlParams.get('name') || localStorage.getItem('playerName') || 'Unnamed';
    this.ws = new WebSocket(
      `${location.origin.replace(/^http/, "ws")}/?game=${encodeURIComponent(gameId)}&name=${encodeURIComponent(playerName)}`
    );
  
    this.ws.addEventListener('message', (ev) => this.handleMessage(this.parseMessage(ev)));
    this.playerStatesByServerTime = new Map(); //name -> [{time, state}]
    this.currentPlayerNames = new Set();
    this.DEFAULT_BUFFER_MS = 100
    this.networkBufferMs = this.DEFAULT_BUFFER_MS;
    this.clockoffsetMS = 100
    this.HISTORY_MS = 1000;
  }

  startTimeSyncAI({ count = 6, intervalMs = 80, timeoutMs = 1000 } = {}, onProgress) {
    console.log('startTimeSyncAI called', { count, intervalMs, timeoutMs, wsReady: this.ws && this.ws.readyState });

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not open'));
    }

    // ensure the pending map
    this._timeSyncPending = this._timeSyncPending || new Map();

    // listener for server replies
    const onMessage = (ev) => {
      let msg;
      try {
        msg = (typeof ev.data === 'string') ? JSON.parse(ev.data) : ev.data;
      } catch (e) {
        console.warn('parse error in onMessage', e, ev && ev.data);
        return;
      }
      // expect numeric id (keep same contract as your renderer)
      if (!msg || msg.type !== 'timeSyncResp' || typeof msg.id !== 'number') return;

      const id = msg.id;
      const pending = this._timeSyncPending.get(id);
      if (!pending) {
        // late/dangling reply — ignore
        return;
      }

      // compute RTT with the t0 stored in pending
      const t1 = Date.now();
      const t0 = pending.t0;
      // cleanup before resolving to avoid re-entrancy issues
      clearTimeout(pending.timer);
      this._timeSyncPending.delete(id);

      const rtt = t1 - t0;
      const serverTime = (typeof msg.serverTime === 'number') ? msg.serverTime : null;
      const offset = (serverTime != null) ? (serverTime - (t0 + rtt / 2)) : null;

      // inform renderer/UI
      if (typeof onProgress === 'function') {
        try { onProgress({ index: pending.index, count, rtt, offset, ok: true }); } catch (e) { /* ignore UI errors */ }
      }

      // resolve the Promise associated with this ping
      pending.resolve({ id, rtt, serverTime, offset });
    };

    this.ws.addEventListener('message', onMessage);

    const rtts = [];
    const offsets = [];

    // local numeric id generator (starts from 0 each run like your original)
    let nextId = 0;

    const pingOnce = (id, index) => {
      return new Promise((resolve, reject) => {
        const t0 = Date.now();
        let settled = false;

        // timeout handler — stored so we can clear it if reply arrives
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          // remove pending entry
          this._timeSyncPending.delete(id);
          // report UI timeout
          if (typeof onProgress === 'function') {
            try { onProgress({ index, count, rtt: timeoutMs, offset: null, ok: false }); } catch (e) {}
          }
          reject(new Error('timeSync timeout'));
        }, timeoutMs);

        // create pending entry *before* sending
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
            try { onProgress({ index, count, rtt: timeoutMs, offset: null, ok: false }); } catch (e) {}
          }
          reject(e);
        }
      });
    };

    // run pings sequentially with the requested interval
    const run = async () => {
      for (let i = 0; i < count; i++) {
        const id = nextId++;
        try {
          const res = await pingOnce(id, i);
          rtts.push(res.rtt);
          if (typeof res.offset === 'number') offsets.push(res.offset);
        } catch (e) {
          rtts.push(timeoutMs);
        }
        if (i < count - 1) await new Promise(r => setTimeout(r, intervalMs));
      }

      this.ws.removeEventListener('message', onMessage);

      // stats
      const avgRtt = rtts.length ? (rtts.reduce((a, b) => a + b, 0) / rtts.length) : 0;
      const medianOffset = (offsets.length === 0) ? 0 : (() => {
        const arr = offsets.slice().sort((a, b) => a - b);
        const mid = Math.floor(arr.length / 2);
        return (arr.length % 2 === 1) ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
      })();

      this.networkBufferMs = Math.max(Math.ceil(avgRtt), 1000 / 20);
      this.clockOffsetMs = medianOffset;

      console.log('timeSync done', { rtts, offsets, avgRtt, medianOffset, networkBufferMs: this.networkBufferMs, clockOffsetMs: this.clockOffsetMs });

      return { rtts, offsets, avgRtt, medianOffset, networkBufferMs: this.networkBufferMs, clockOffsetMs: this.clockOffsetMs };
    };

    return run();
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

  findBinaryInsertPoint(sortedArr, val, comparator) {
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
    const idx = this.findBinaryInsertPoint(history, timeStatePair, this.timeComparator.bind(this));
    // If identical timestamp exists, replace with new one
    if (idx < history.length && history[idx].time === timeStatePair.time) {
      history[idx] = timeStatePair;
    } else {
      history.splice(idx, 0, timeStatePair);
    }


    // delete old states
    const cutoff = timeStatePair.time - this.HISTORY_MS;
    while (history.length && history[0].time < cutoff) history.shift();
  }

  timeComparator(a, b) {
    return a.time - b.time;
  }

  getCurrentPlayerStates(renderServerTimeMs) {
    const result = [];

    for (const name of this.currentPlayerNames) {
      const history = this.playerStatesByServerTime.get(name);
      if (!history || history.length === 0) continue;

      // If requested time is before the earliest sample -> clamp to earliest
      if (renderServerTimeMs <= history[0].time) {
        result.push([name, deepClone(history[0].state)]);
        continue;
      }

      // If requested time is after the latest sample -> clamp to latest (preferred)
      const lastIdx = history.length - 1;
      if (renderServerTimeMs >= history[lastIdx].time) {
        result.push([name, deepClone(history[lastIdx].state)]);
        continue;
      }

      // find first index with time >= renderServerTimeMs
      let idxLo = 0, idxHi = history.length - 1, idx = -1;
      // simple binary search to find lower/upper samples efficiently
      while (idxLo <= idxHi) {
        const mid = (idxLo + idxHi) >>> 1;
        if (history[mid].time < renderServerTimeMs) idxLo = mid + 1;
        else {
          idx = mid;
          idxHi = mid - 1;
        }
      }
      // idx is index of s1 (first with time >= renderServerTimeMs)
      const s1 = history[idx];
      const s0 = history[idx - 1];

      // compute alpha between s0.time and s1.time
      const span = s1.time - s0.time;
      const alpha = span > 0 ? (renderServerTimeMs - s0.time) / span : 0;

      const interpState = this.lerpStates(s0.state, s1.state, alpha);
      result.push([name, interpState]);
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