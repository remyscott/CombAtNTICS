const MIN_HISTORY_VALUES = 5;

export class StateManager {
  constructor(ws, game) {
    this.ws = ws;
    this.game = game;

    // authoritative state containers
    this.game.bodies = new Map();     // Map<bodyId, Body>
    this.game.fixtures = new Map();   // Map<fixtureId, Fixture>

    // interpolation history
    this.history = new Map(); // Map<bodyId, Array<{time, state}>>

    // queued server events
    this.events = [];

    // timing
    this.networkBuffer = 100;
    this.clockOffset = 0;
    this.HISTORY_TIME = 300;

    // per-frame change tracking
    this._changedFixtures = new Set();
    this._destroyedBodies = new Set();

    this._metadataRequested = false;

    this.game.events.on('step', (time, delta) => this._onStep(time, delta));
  }

  /* ---------------------------------------------------------
   *  PUBLIC API
   * --------------------------------------------------------- */

  updateNetworkBufferAndClockOffset(networkBuffer, clockOffset) {
    this.networkBuffer = Number.isFinite(networkBuffer) ? networkBuffer : this.networkBuffer;
    this.clockOffset = Number.isFinite(clockOffset) ? clockOffset : this.clockOffset;
  }

  handleBinarySnapshot(buffer) {
    const dv = new DataView(buffer);
    let offset = 0;

    if (dv.byteLength < 1) return;
    const kind = dv.getUint8(offset); offset += 1;

    if (offset + 8 > dv.byteLength) return;
    let serverTimeMs;
    if (dv.getBigUint64) {
      serverTimeMs = Number(dv.getBigUint64(offset, true));
    } else {
      const low = dv.getUint32(offset, true);
      const high = dv.getUint32(offset + 4, true);
      serverTimeMs = high * 0x100000000 + low;
    }
    offset += 8;

    if (offset + 2 > dv.byteLength) return;
    const N = dv.getUint16(offset, true); offset += 2;

    for (let i = 0; i < N; i++) {
      if (offset + 16 > dv.byteLength) break;

      const id = dv.getUint32(offset, true); offset += 4;
      const x = dv.getFloat32(offset, true); offset += 4;
      const y = dv.getFloat32(offset, true); offset += 4;
      const angle = dv.getFloat32(offset, true); offset += 4;

      this._insertSample(id, serverTimeMs, { pos: { x, y }, angle });
    }
  }

  pushEvents(...events) {
    const valid = events.flat().filter(e => Number.isFinite(e.serverTimeMs));
    if (valid.length === 0) return;

    this.events.push(...valid);
    this.events.sort((a, b) => a.serverTimeMs - b.serverTimeMs);
  }

  /* ---------------------------------------------------------
   *  LAZY INITIALIZATION HELPERS
   * --------------------------------------------------------- */

  _ensureBody(id) {
    let body = this.game.bodies.get(id);
    if (body) return body;

    const meta = this.game.metadata?.bodies?.[id];
    if (!meta) {
      this._requestMetadata();
      return null;
    }

    body = {
      id,
      meta,
      fixtureIds: [],
      interpolatedPos: { x: 0, y: 0 },
      interpolatedAngle: 0,
      _lastPos: { x: 0, y: 0 },
      _lastAngle: 0,
      _isNew: true,          // 🔹 mark as new
      render: null
    };

    this.game.bodies.set(id, body);
    for (const f of meta.fixtures || []) {
      this._ensureFixture(f.id, id, f);
    }

    return body;
  }


  _ensureFixture(fixtureId, bodyId, metaFixture = null) {
    let fixture = this.game.fixtures.get(fixtureId);
    if (fixture) {
      if (fixture.bodyId !== bodyId) fixture.bodyId = bodyId;
      const body = this.game.bodies.get(bodyId);
      if (body && !body.fixtureIds.includes(fixtureId)) {
        body.fixtureIds.push(fixtureId);
      }
      return fixture;
    }

    const meta = metaFixture;

    if (!meta) {
      this._requestMetadata();
      return null;
    }

    fixture = {
      id: fixtureId,
      metaId: meta.metaId || metaFixture?.metaId,
      bodyId,
      position: meta.position ? { ...meta.position } : { x: 0, y: 0 },
      angle: meta.angle || 0,
      vars: meta.vars ? { ...meta.vars } : {},
      render: null
    };

    this.game.fixtures.set(fixtureId, fixture);

    const body = this.game.bodies.get(bodyId);
    if (body && !body.fixtureIds.includes(fixtureId)) {
      body.fixtureIds.push(fixtureId);
    }

    return fixture;
  }

  _requestMetadata() {
    if (!this._metadataRequested && this.game.client?.requestMetadata) {
      console.log('metareq');
      this._metadataRequested = true;
      this.game.client.requestMetadata();
    }
  }

  /* ---------------------------------------------------------
   *  EVENT PROCESSING
   * --------------------------------------------------------- */

  _processEventsUpTo(targetTime) {
    let i = 0;
    while (i < this.events.length && this.events[i].serverTimeMs <= targetTime) {
      this._handleEvent(this.events[i]);
      i++;
    }
    if (i > 0) this.events.splice(0, i);
  }

  _handleEvent(ev) {
    switch (ev.type) {
      case 'destroy':
        this._destroyBody(ev.id);
        this._destroyedBodies.add(ev.id);
        break;

      case 'playerBodyId':
        this.game.events.emit('playerBodyId', ev.id);
        break;

      case 'damage':
        this.game.events.emit('damage', ev.id, ev.amount);
        if (ev.id != null && ev.health != null) {
          this._applyFixtureVars(ev.id, { health: ev.health });
        }
        break;

      case 'fixtureVarsUpdate':
        if (ev.id != null && ev.vars) {
          this._applyFixtureVars(ev.id, ev.vars);
        }
        break;
    }
  }

  _applyFixtureVars(fixtureId, vars) {
    const fixture = this.game.fixtures.get(fixtureId);
    if (!fixture) return;

    fixture.vars = { ...fixture.vars, ...vars };
    this._changedFixtures.add(fixtureId);
  }

  _destroyBody(bodyId) {
    const body = this.game.bodies.get(bodyId);
    if (!body) {
      this.history.delete(bodyId);
      return;
    }

    for (const fixtureId of body.fixtureIds) {
      this.game.fixtures.delete(fixtureId);
      this._changedFixtures.delete(fixtureId);
    }

    this.game.bodies.delete(bodyId);
    this.history.delete(bodyId);
  }

  /* ---------------------------------------------------------
   *  SNAPSHOT HISTORY
   * --------------------------------------------------------- */

  _insertSample(id, time, state) {
    let arr = this.history.get(id);
    if (!arr) {
      arr = [];
      this.history.set(id, arr);
    }

    const idx = this._binarySearch(arr, time);
    if (idx < arr.length && arr[idx].time === time) {
      arr[idx] = { time, state };
    } else {
      arr.splice(idx, 0, { time, state });
    }

    const cutoff = time - this.HISTORY_TIME;
    while (arr.length > MIN_HISTORY_VALUES && arr[0].time < cutoff) {
      arr.shift();
    }
  }

  _binarySearch(arr, time) {
    let low = 0, high = arr.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (arr[mid].time < time) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  /* ---------------------------------------------------------
   *  FRAME UPDATE
   * --------------------------------------------------------- */

  _onStep() {
    const serverNow = Date.now() + this.clockOffset;
    this._processEventsUpTo(serverNow);

    const interpolated = this._interpolateCurrentState();
    const movedBodies = this._applyInterpolatedState(interpolated);

    this.game.events.emit('stateUpdated', {
      movedBodies,
      changedFixtures: Array.from(this._changedFixtures),
      destroyedBodies: Array.from(this._destroyedBodies)
    });

    this._changedFixtures.clear();
    this._destroyedBodies.clear();
  }

  _interpolateCurrentState() {
    const renderTime = Date.now() + this.clockOffset - this.networkBuffer;
    const result = [];

    for (const [id, arr] of this.history.entries()) {
      if (!arr.length) continue;

      if (renderTime <= arr[0].time) {
        result.push({ id, state: arr[0].state });
        continue;
      }

      const last = arr[arr.length - 1];
      if (renderTime >= last.time) {
        result.push({ id, state: last.state });
        continue;
      }

      const idx = this._binarySearch(arr, renderTime);
      const s1 = arr[idx];
      const s0 = arr[idx - 1];

      const span = s1.time - s0.time;
      const alpha = span > 1e-6 ? (renderTime - s0.time) / span : 0;

      result.push({
        id,
        state: {
          pos: {
            x: s0.state.pos.x + (s1.state.pos.x - s0.state.pos.x) * alpha,
            y: s0.state.pos.y + (s1.state.pos.y - s0.state.pos.y) * alpha
          },
          angle: s0.state.angle + (s1.state.angle - s0.state.angle) * alpha
        }
      });
    }
    return result;
  }

  _applyInterpolatedState(objects) {
    const moved = [];

    for (const { id, state } of objects) {
      const body = this._ensureBody(id);
      if (!body) continue;
      const { x, y } = state.pos;
      const angle = state.angle;

      const changed =
        x !== body._lastPos.x ||
        y !== body._lastPos.y ||
        angle !== body._lastAngle;

      body.interpolatedPos = { x, y };
      body.interpolatedAngle = angle;

      if (changed || body._isNew) {   // 🔹 include new bodies
        moved.push(id);
        body._lastPos = { x, y };
        body._lastAngle = angle;
        body._isNew = false;
      }
    }

    return moved;
  }
}
