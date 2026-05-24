import {IDEAL_TICK_RATE, TICKS_PER_SNAPSHOT, TIMESTEP} from '../config/settings.js';
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
    if (this._ticksSinceSnapshot > TICKS_PER_SNAPSHOT) this.broadcastSnapshot();
  }

  broadcastSnapshot() {
    this._ticksSinceSnapshot = 0;

    const overallState = {};
    const newMeta = {bodies: {}, fixtures: {}}
    for (const id of this.world.idToBody.keys()) {
      const b = this.world.getBody(id);
      
      if (!b) {
        console.warn('⚠️ Body not found for ID:', id);
        continue;
      }
      else {
        const state = this.getSnapshotOf(b);
        overallState[id] = state;
        if (!(id in this._lastFrameMeta.bodies)) {
          newMeta.bodies[id] = this.world.metadata.bodies[id];
        }
      }
    }

    const buf = this.encodeOverallState(overallState);
    for (const client of this.players.values()) {
      // keep chat/metadata as JSON, send binary snapshot as ArrayBuffer
      client.ws.send(buf);
    }
    // Optionally still broadcast newMetadata/time as a separate small JSON message
    this.broadcast({ type: 'newMetadata', newMetadata: newMeta});    
    this._lastFrameMeta = structuredClone(this.world.metadata);
  }

  encodeOverallState(overallState) {
    const entries = Object.values(overallState); // order arbitrary
    const N = entries.length;
    // header (uint16) + per-entity (4 + 4 + 4 + 4) bytes = 16 bytes per entity
    const BYTES_PER_ENTITY = 4 + 4 + 4 + 4;
    const headerBytes = 2;
    const totalBytes = headerBytes + (N * BYTES_PER_ENTITY);
    const buffer = new ArrayBuffer(totalBytes);
    const dv = new DataView(buffer);
    let offset = 0;

    // number of entities (uint16)
    dv.setUint16(offset, N, true); offset += 2;

    for (let i = 0; i < N; i++) {
      const e = entries[i];
      // ensure numeric id and state shape
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