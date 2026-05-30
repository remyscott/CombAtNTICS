import { TICKS_PER_SNAPSHOT } from '../../shared/settings.js';
import { lerpStatesFast } from './statelerper.js';

export class StateManager{
  constructor(ws, game) {
    this.ws = ws;
    this.game = game;
    this.history = []; 
    this.networkBuffer = 100;
    this.clockOffset = 0;
    this.HISTORY_TIME = 1000;
    this.game.events.on('step', (time, delta) => this._onStep(time, delta));
  }

  _onStep(time, delta) {
    this.game.currentState = this.getCurrentState();
  }

  updateNetworkBufferAndClockOffset(networkBuffer, clockOffset) {
    this.networkBuffer = networkBuffer;
    this.clockOffset = clockOffset;
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
      const nearest = this.findNearestIndexByTime(serverTimeMs);

      // Threshold: how far away (ms) a partial can be and still be applied to an existing sample.
      // Adjust this to your network/clock jitter and snapshot spacing. Example: 200ms
      const MAX_MERGE_DELTA_MS = 200;

      if (nearest.idx >= 0 && nearest.diff <= MAX_MERGE_DELTA_MS) {
        // Merge partial into that history entry (create new object to avoid mutation of other refs)
        const existing = structuredClone(this.history[nearest.idx]);
        existing.state = this.mergePartialIntoBaseline(existing.state, parsed);
        // keep existing.time (we don't change the sample timestamp)
        this.history[nearest.idx] = existing;
      } else {
        const baseline = this.getLatestBaselineState();
        const full = this.mergePartialIntoBaseline(baseline, parsed);
        this.insertStateIntoHistory({ state: full, time: serverTimeMs });
      }
    } else {
      console.warn('Unknown binary snapshot kind:', kind);
    }
  }

  findNearestIndexByTime(time) {
    if (!this.history || this.history.length === 0) return { idx: -1, diff: Infinity };

    // binary search for insertion point
    let low = 0, high = this.history.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.history[mid].time < time) low = mid + 1;
      else high = mid;
    }

    // low is first index with time >= time (could be 0..length)
    let bestIdx = -1;
    let bestDiff = Infinity;

    // check low and low-1 as closest candidates
    const candidates = [];
    if (low < this.history.length) candidates.push(low);
    if (low - 1 >= 0) candidates.push(low - 1);

    for (const c of candidates) {
      const d = Math.abs(this.history[c].time - time);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = c;
      }
    }

    return { idx: bestIdx, diff: bestDiff };
  }

  getLatestBaselineState() {
    if (!this.history || this.history.length === 0) {
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

    const out = {};
    for (const [id, entry] of Object.entries(baseline)) {
      out[id] = structuredClone(entry);
    }

    for (const [id, entry] of Object.entries(partial)) {
      out[id] = structuredClone(entry);
    }

    return out;
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