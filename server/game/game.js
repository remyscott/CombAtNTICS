import {IDEAL_TICK_RATE, TICKS_PER_FULL_SNAPSHOT, TIMESTEP} from '../../shared/settings.js';
import { World, Circle, Vec2, Edge, Box } from 'planck';
import { Player } from './player.js';
import { GameWorld } from './gameWorld.js';
import { Filter } from 'bad-words';

export class Game {
  constructor(map, id, onClose) {
    this.map = map;
    this.id = id;
    this.onClose = onClose;
    this.world = new GameWorld(map, this);
    this.chatFilter = new Filter();
    this._lastFrameMeta = {bodies: {}, fixtures: {}};
    this._stopped = false;
    this.players = new Map();
    this._tickTimeout = null;
    this._ticksSinceFullSnapshot = 0;
    this.events = [];

    this.startTickLoop();
    this.startTickRateTracker();
  }

  pushEvent(event) {
    this.events.push({...event, serverTimeMs: Date.now()});
  }
 
  onClientChat(payload, username) {
    if (!payload || payload.type !== 'chatMsg') return;

    const raw = String(payload.msg || '');
    const containsSwear = this.chatFilter.isProfane(raw);
    
    if (containsSwear) {
      this.players.get(username).chatBanned = true;
      this.broadcast({type: 'chatMsg', msg: `Player ${payload.nameOfSender} has been banned from chat for swearing`, nameOfSender: 'SERVER'});
      return;
    }

    this.broadcast(payload);
  }

  addPlayer(ws) {
    if (!this.firstPlayerJoined) this.firstPlayerJoined = true;
    const existingPlayer = this.players.get(ws.account.username);
    if (existingPlayer) {
      existingPlayer.attachWS(ws);
      existingPlayer.sendInit(ws);
    } else {
      const newPlayer = new Player(ws, this);
      this.players.set(ws.account.username, newPlayer);
      newPlayer.sendInit();
      this.broadcast({ type: 'chatMsg', msg: `${newPlayer.name || ws.account.username} has joined the game.`, nameOfSender: 'SERVER' });
    }
  }

  disconnectPlayer(username) {
    const player = this.players.get(username);
    if (!player) return;
    player.detachWS();
  }

  removePlayer(username) {
    const player = this.players.get(username);
    if (!player) return;
    const playerName = player.name || player.account?.username || username;
    try {
      player.destroy();
    } catch (err) {
      console.warn('Failed to destroy player during removePlayer', err);
    }
    this.players.delete(username);
    this.broadcast({ type: 'chatMsg', msg: `${playerName} has left the game.`, nameOfSender: 'SERVER' });
    if (this.players.size <= 0) {
      this.stop();
    }
  }



  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of this.players.values()) {
      if (!client?.ws || typeof client.ws.send !== 'function') continue;
      const OPEN = client.ws.OPEN ?? 1;
      if (client.ws.readyState !== OPEN) continue;
      try {
        client.ws.send(data);
      } catch (err) {
        console.warn('Failed to broadcast to client', err);
      }
    }
  }

  tick() {
    if (this._stopped) return;
    if (!this.world) return;

    for (const player of this.players.values()) {
      player.applyInputs();
      player.update(TIMESTEP);
    }
    
    const t0 = performance.now();
    this.world.step(TIMESTEP, 1, 1);
    const dtMs = performance.now() - t0;
    if (dtMs > TIMESTEP*1000) console.log('long step:', dtMs);

    
    const t1 = performance.now();
    this.broadcastSnapshot();
    const dtMs2 = performance.now() - t1;
    if (dtMs2 > TIMESTEP*1000) console.log('long broadcast:', dtMs2);
  }

  collectTickState() {
    const overallState = {};
    const newMeta = { bodies: {}, fixtures: {} };

    for (const id of this.world.idToBody.keys()) {
      const b = this.world.getBody(id);
      if (!b) {
        console.warn('⚠️ Body not found for ID:', id);
        continue;
      }
      const state = this.getSnapshotOf(b);
      overallState[id] = state;

      // If this body wasn't present in lastFrameMeta, include its metadata for clients
      if (!(id in this._lastFrameMeta.bodies)) {
        newMeta.bodies[id] = this.world.metadata.bodies[id];
      }
    }

    return { overallState, newMeta };
  }

  getChangedState(state, prevState = this.lastFrameState) {
    const changed = {};
    for (const [id, entity] of Object.entries(state)) {
      const prevEntity = prevState?.[id];
      if (!prevEntity || !this._isStateEqual(entity, prevEntity)) {
        changed[id] = entity;
      }
    }
    return changed;
  }

  _isStateEqual(state1, state2) {
    return (
      state1.state.pos.x === state2.state.pos.x &&
      state1.state.pos.y === state2.state.pos.y &&
      state1.state.angle === state2.state.angle
    );
  }

  broadcastSnapshot() {
    const { overallState, newMeta } = this.collectTickState();
    
    if (Object.keys(newMeta.bodies).length > 0 || Object.keys(newMeta.fixtures).length > 0) {
      this.broadcast({ type: 'newMetadata', newMetadata: newMeta });
      this._lastFrameMeta = structuredClone(this.world.metadata);
    }

    if (this.events.length > 0) {
      this.broadcast({ type: 'events', events: this.events });
      this.events = [];
    }
    
    let buf;
    if (this._ticksSinceFullSnapshot >= TICKS_PER_FULL_SNAPSHOT) {
      buf = this.encodeState(overallState);
      this._ticksSinceFullSnapshot = 0;
    } else {
      const changedState = this.getChangedState(overallState);
      buf = this.encodeState(changedState);
    }
    for (const client of this.players.values()) {
      if (client.ws) {
        client.ws.send(buf);
      }
    }

    this.lastFrameState = overallState;
    this._ticksSinceFullSnapshot++;
  }

  encodeState(stateObj, isPartial = true, serverTimeMs = Date.now()) {
    const entries = Object.values(stateObj);
    const N = entries.length;
    const BYTES_PER_ENTITY = 4 + 4 + 4 + 4; // id + x + y + angle
    const headerBytes = 1;       // uint8 kind
    const timeBytes = 8;         // uint64 timestamp
    const countBytes = 2;        // uint16 count
    const totalBytes = headerBytes + timeBytes + countBytes + (N * BYTES_PER_ENTITY);

    const buffer = new ArrayBuffer(totalBytes);
    const dv = new DataView(buffer);
    let offset = 0;

    // 1-byte header: 0 = full, 1 = partial
    dv.setUint8(offset, isPartial ? 1 : 0); offset += 1;

    // 8-byte server timestamp (ms since epoch) as BigUint64 little-endian
    // ensure BigInt
    const tsBig = typeof serverTimeMs === 'bigint' ? serverTimeMs : BigInt(Math.floor(Number(serverTimeMs)));
    if (typeof dv.setBigUint64 === 'function') {
      dv.setBigUint64(offset, tsBig, true); // little-endian
    } else {
      const low = Number(tsBig & 0xFFFFFFFFn);
      const high = Number((tsBig >> 32n) & 0xFFFFFFFFn);
      dv.setUint32(offset, low, true); offset += 4;
      dv.setUint32(offset, high, true); offset -= 4;
    }
    offset += 8;

    // number of entities (uint16)
    dv.setUint16(offset, N, true); offset += 2;

    for (let i = 0; i < N; i++) {
      const e = entries[i];
      const id = Number(e.id || 0) >>> 0;
      const x = Number(e.state?.pos?.x || 0);
      const y = Number(e.state?.pos?.y || 0);
      const angle = Number(e.state?.angle || 0);

      dv.setUint32(offset, id, true); offset += 4;
      dv.setFloat32(offset, x, true); offset += 4;
      dv.setFloat32(offset, y, true); offset += 4;
      dv.setFloat32(offset, angle, true); offset += 4;
    }

    return buffer;
  }


  getSnapshotOf(b) {
    const meta = b.getUserData();
    const pos = b.getPosition();
    const angle = b.getAngle();
    return {
      id: meta.id,
      state: {
        pos: {x: pos.x, y: pos.y},
        angle
      } 
    };
  }

  stop() {
    if (this._stopped) return;
    this._stopped = true;

    if (this._tickTimeout) {
      clearTimeout(this._tickTimeout);
      this._tickTimeout = null;
    }

    if (this._tickRateInterval) {
      clearInterval(this._tickRateInterval);
      this._tickRateInterval = null;
    }

    if (typeof this.onClose === 'function') {
      try { this.onClose(this.id); } catch (err) { console.error('onClose threw:', err); }
    }

    for (const p of this.players?.values() || []) {
      try { p.detachWS?.(); } catch (_) {}
    }
    this.players.clear();
    this.world = null;
  }

  startTickRateTracker() {
    this._tickCounter = 0;
    this.actualTPS = 0; // ticks per second

    const originalTick = this.tick.bind(this);
    this.tick = () => {
        this._tickCounter++;
        originalTick();
    };

    this._tickRateInterval = setInterval(() => {
        this.actualTPS = this._tickCounter;
        this._tickCounter = 0;
        if (this.actualTPS < IDEAL_TICK_RATE) console.log(`Actual TPS: ${this.actualTPS}`);
    }, 1000);
  } 

  startTickLoop() {
    const IDEAL_DT = 1000 / IDEAL_TICK_RATE; // ms per tick
    let nextTickTime = performance.now() + IDEAL_DT;

    // cancel existing loop if any
    if (this._tickTimeout) {
      clearTimeout(this._tickTimeout);
      this._tickTimeout = null;
    }

    const loop = () => {
      // bail if stopped
      if (this._stopped) {
        this._tickTimeout = null;
        return;
      }

      try {
        const t0 = performance.now();
        this.tick();
        const dtMs = performance.now() - t0;
        if (dtMs > IDEAL_DT) console.log('long tick:', dtMs);
      } catch (err) {
        console.error('tick() threw:', err);
      }

      const now = performance.now();
      if (nextTickTime < now - IDEAL_DT * 4) { // too far behind
        nextTickTime = now + IDEAL_DT;
      }
      let delay = Math.max(0, Math.round(nextTickTime - now));
      this._tickTimeout = setTimeout(loop, delay);
      nextTickTime += IDEAL_DT;
    };

    // kick off the loop after one ideal dt
    this._tickTimeout = setTimeout(loop, Math.round(IDEAL_DT));
  }
}