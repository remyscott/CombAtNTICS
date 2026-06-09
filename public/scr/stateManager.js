import { lerpStatesFast } from './statelerper.js'; // unused here for now, kept for future use

const MIN_HISTORY_VALUES = 15;

export class StateManager {
  constructor(ws, game) {
    this.ws = ws;
    this.game = game;

    // history: Map<bodyId, Array<{time: number, state: {pos:{x,y}, angle}}>>
    this.history = new Map();

    // events: sorted array of { type: string, serverTimeMs: number, details: any }
    this.events = [];

    this.networkBuffer = 100;
    this.clockOffset = 0;
    this.HISTORY_TIME = 1000;
    this.game.events.on('step', (time, delta) => this._onStep(time, delta));
  }

  _onStep(time, delta) {
    // Process events up to "now" (server time approximately)
    const serverNow = Date.now() + (this.clockOffset || 0);
    this._processEventsUpTo(serverNow);

    this.game.currentState = this.getCurrentState();
  }

  updateNetworkBufferAndClockOffset(networkBuffer, clockOffset) {
    this.networkBuffer = networkBuffer;
    this.clockOffset = clockOffset;
  }

  // Insert events (keeps this.events sorted by serverTimeMs ascending)
  pushEvents(...events) {
    if (!events || events.length === 0) return;
    // Flatten and filter valid events
    const toInsert = events
      .flat()
      .filter(e => Number.isFinite(e.serverTimeMs));

    if (toInsert.length === 0) return;

    // Merge insertion while keeping sorted order (simple: push and sort; efficient insertion could be used)
    this.events.push(...toInsert);
    this.events.sort((a, b) => a.serverTimeMs - b.serverTimeMs);
  }

  // Process and remove events whose serverTimeMs <= targetServerTimeMs
  _processEventsUpTo(targetServerTimeMs) {
    // events are sorted ascending by serverTimeMs
    let i = 0;
    while (i < this.events.length && this.events[i].serverTimeMs <= targetServerTimeMs) {
      const ev = this.events[i];
      this._handleEvent(ev);
      i++;
    }
    if (i > 0) {
      // remove processed prefix
      this.events.splice(0, i);
    }
  }

  _handleEvent(ev) {
    if (this.game && this.game.events && typeof this.game.events.emit === 'function') {
    }
    switch (ev.type) {
      case 'destroy':
        if (ev.id) {
          this._destroyBody(ev.id);
          this.game.events.emit('destroyBody', ev.id);
        }
        break;
      case 'playerBodyId':
        if (ev.id) {
          this.game.events.emit('playerBodyId', ev.id);
        }
        break;
      case 'damage':
        this.game.events.emit('damage', ev.id, ev.amount);
        break;
      default:
        break;
    }
  }

  _destroyBody(id) {
    this.history.delete(id);
  }

  handleBinarySnapshot(buffer) {
    const dv = new DataView(buffer);
    let offset = 0;

    if (dv.byteLength < 1) return;
    const kind = dv.getUint8(offset); offset += 1; // 0 = full, 1 = partial

    if (offset + 8 > dv.byteLength) return;
    let serverTimeMs;
    if (typeof dv.getBigUint64 === 'function') {
      serverTimeMs = Number(dv.getBigUint64(offset, true));
    } else {
      const low = dv.getUint32(offset, true);
      const high = dv.getUint32(offset + 4, true);
      serverTimeMs = (high * 0x100000000) + low;
    }
    offset += 8;

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

    if (kind === 0) { // full snapshot: insert per-body samples for all parsed ids
      for (const [idStr, entry] of Object.entries(parsed)) {
        const id = Number(idStr);
        this._insertPerBodySample(id, { time: serverTimeMs, state: entry.state });
      }
    } else if (kind === 1) { // partial snapshot: always insert per-body sample (no merging)
      for (const [idStr, entry] of Object.entries(parsed)) {
        const id = Number(idStr);
        this._insertPerBodySample(id, { time: serverTimeMs, state: entry.state });
      }
    } else {
      console.warn('Unknown binary snapshot kind:', kind);
    }
  }

  // Helper: binary search within a per-body sorted array of samples by time.
  _findIdxBinarySearchArr(arr, time) {
    let low = 0, high = arr.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (arr[mid].time < time) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  // Insert per-body sample into that body's history array, keep array sorted by time.
  _insertPerBodySample(id, timeStatePair) {
    let arr = this.history.get(id);
    if (!arr) {
      arr = [];
      this.history.set(id, arr);
    }
    const idx = this._findIdxBinarySearchArr(arr, timeStatePair.time);
    if (idx < arr.length && arr[idx].time === timeStatePair.time) {
      arr[idx] = timeStatePair;
    } else {
      arr.splice(idx, 0, timeStatePair);
    }

    // Trim old samples older than (time - HISTORY_TIME)
    const cutoff = timeStatePair.time - this.HISTORY_TIME;
    // Only trim while there are more than MIN_HISTORY_VALUES and oldest < cutoff
    while (arr.length > MIN_HISTORY_VALUES && arr.length > 0 && arr[0].time < cutoff) {
      arr.shift();
    }
    // Map already holds reference; nothing else needed
  }

  getCurrentState() {
    return ({ objects: this.getCurrentObjectStates() });
  }

  // Interpolate per-body independently using current body ids derived from history keys.
  getCurrentObjectStates() {
    const renderServerTime = Date.now() + (this.clockOffset || 0) - this.networkBuffer;
    const result = [];

    for (const id of this.history.keys()) {
      const arr = this.history.get(id);
      if (!arr || arr.length === 0) continue;

      // If render time is before first sample => clamp to first
      if (renderServerTime <= arr[0].time) {
        result.push({ id, state: structuredClone(arr[0].state) });
        continue;
      }

      // If render time is after last sample => clamp to last
      const last = arr[arr.length - 1];
      if (renderServerTime >= last.time) {
        result.push({ id, state: structuredClone(last.state) });
        continue;
      }

      // find index of first sample with time >= renderServerTime
      const idx = this._findIdxBinarySearchArr(arr, renderServerTime);
      const s1 = arr[idx];
      const s0 = (idx > 0) ? arr[idx - 1] : null;
      if (!s1) continue;

      const span = s0 ? (s1.time - s0.time) : 0;
      const alpha = (span > 1e-6 && s0) ? ((renderServerTime - s0.time) / span) : 0;

      // Linear interpolate pos and angle, produce canonical shape { id, state: { pos, angle } }
      if (!s0) {
        result.push({ id, state: structuredClone(s1.state) });
      } else {
        const interpolatedState = {
          pos: {
            x: s0.state.pos.x + (s1.state.pos.x - s0.state.pos.x) * alpha,
            y: s0.state.pos.y + (s1.state.pos.y - s0.state.pos.y) * alpha,
          },
          angle: s0.state.angle + (s1.state.angle - s0.state.angle) * alpha
        };
        result.push({ id, state: interpolatedState });
      }
    }

    return result;
  }
}