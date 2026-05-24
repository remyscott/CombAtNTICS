import {IDEAL_TICK_RATE, TICKS_PER_SNAPSHOT, TIMESTEP} from '../../shared/settings.js';
import { World, Circle, Vec2, Edge, Box } from 'planck';
import { Player } from './player.js';
import { GameWorld } from './gameWorld.js';
import { Filter } from 'bad-words';

export class Game {
  constructor(map) {
    this.map = map;
    this.world = new GameWorld(map);
    this.chatFilter = new Filter();
    this._id = 0;
    this.idToBody = new Map();
    this._lastFrameMeta = {bodies: {}, fixtures: {}};

    this.players = new Map();
    this._tickTimeout = null;
    this._ticksSinceSnapshot = 0;

    this.startTickLoop();
    this.startTickRateTracker();
  }

  onClientChat(payload, clientId) {
    if (!payload || payload.type !== 'chatMsg') return;

    const raw = String(payload.msg || '');
    const containsSwear = this.chatFilter.isProfane(raw);
    
    if (containsSwear) {
      this.players.get(clientId).chatBanned = true;
      this.broadcast({type: 'chatMsg', msg: `Player ${payload.nameOfSender} has been banned from chat for swearing`, nameOfSender: 'SERVER'});
      return;
    }



    this.broadcast(payload);
  }

  addPlayer(ws) {
    const newPlayer = new Player(ws, this);

    this.players.set(ws.clientId, newPlayer);
    newPlayer.sendInit();
  }

  removePlayer(clientId) {
    this.players.get(clientId).destroy();
    this.players.delete(clientId);
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of this.players.values()) {
      client.ws.send(data);
    }
  }

  tick() {
    for (const player of this.players.values()) {
      player.applyInputs();
    }

    this.world.step(TIMESTEP, 8, 8);
    this._ticksSinceSnapshot += 1;
    this.broadcastSnapshotDecision();
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

  makePartialState(overallState, newMeta) {
    if (!newMeta || !newMeta.bodies) return {};
    const partial = {};
    for (const idStr of Object.keys(newMeta.bodies)) {
      // metadata keys may be strings; ensure consistent lookup
      const id = Number(idStr);
      if (overallState[id] !== undefined) {
        partial[id] = overallState[id];
      }
    }
    return partial;
  }

  broadcastSnapshotDecision() {
    // Collect tick state and the new metadata (bodies that have appeared since last frame)
    const { overallState, newMeta } = this.collectTickState();

    // Always send partial state for newly spawned items so they appear immediately
    const partialState = this.makePartialState(overallState, newMeta);

    // If an entity was added, we should still send its metadata as JSON
    if (Object.keys(newMeta.bodies).length > 0 || Object.keys(newMeta.fixtures).length > 0) {
      // send the metadata JSON first (so client knows how to construct entities)
      this.broadcast({ type: 'newMetadata', newMetadata: newMeta });
    }

    // If it's the snapshot tick, send the full encoded snapshot; otherwise send only partial
    if (this._ticksSinceSnapshot >= TICKS_PER_SNAPSHOT) {
      // full snapshot
      this._ticksSinceSnapshot = 0;
      const buf = this.encodeState(overallState);
      for (const client of this.players.values()) {
        client.ws.send(buf);
      }

      // update lastFrameMeta after full snapshot so next partials use correct baseline
      this._lastFrameMeta = structuredClone(this.world.metadata);
    } else {
      // partial snapshot optimization: only send if there is anything to send
      if (Object.keys(partialState).length > 0) {
        const buf = this.encodeState(partialState, true);
        for (const client of this.players.values()) {
          client.ws.send(buf);
        }
      }
    }
  }

  encodeState(stateObj, isPartial = false, serverTimeMs = Date.now()) {
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
      // fallback for environments without BigInt support in DataView:
      // split into low/high uint32
      const low = Number(tsBig & 0xFFFFFFFFn);
      const high = Number((tsBig >> 32n) & 0xFFFFFFFFn);
      dv.setUint32(offset, low, true); offset += 4;
      dv.setUint32(offset, high, true); offset -= 4; // offset corrected below
      // we will advance offset by 8 below in unified way
      // (this branch is only for very old runtimes; prefer modern runtime)
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
        pos: {x: pos.x, y: pos.y}, // invert y for client
        angle
      } 
    };
  }

  stop() {
    if (this._tickTimeout) {
        clearTimeout(this._tickTimeout);
        this._tickTimeout = null;
    }

    if (this._tickRateInterval) {
        clearInterval(this._tickRateInterval);
        this._tickRateInterval = null;
    }
    this.players = null;
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
    const IDEAL_DT = 1000 / IDEAL_TICK_RATE;
    let lastTickTime = performance.now();
    let accumulator = 0;
  
    // cancel any existing loop
    if (this._tickTimeout) {
      clearTimeout(this._tickTimeout);
      this._tickTimeout = null;
    }
  
    const loop = () => {
      const now = performance.now();
      let frameTime = now - lastTickTime;
      lastTickTime = now;

      if (frameTime > 250) frameTime = 250;

      accumulator += frameTime;
  
      while (accumulator >= IDEAL_DT) {
        try {
          this.tick();
        } catch (err) {
          console.error('tick() threw:', err);
        }
        accumulator -= IDEAL_DT;
      }
  
      const nextDelay = Math.max(0, IDEAL_DT - ( performance.now() + lastTickTime ));
      const safeDelay = Number.isFinite(nextDelay) && nextDelay <= 1000 ? Math.round(nextDelay) : Math.round(IDEAL_DT);
  
      this._tickTimeout = setTimeout(loop, safeDelay);
    };
  
    // kick off
    this._tickTimeout = setTimeout(loop, Math.round(IDEAL_DT));
  }
}