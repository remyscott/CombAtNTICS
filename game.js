import {IDEAL_TICK_RATE, TEST_DROP_CHANCE, TEST_JITTER, TEST_LAG} from './settings.js'
export class Game {
  constructor() {
    this.players = new Map();

    this._tickTimeout = null;
    this.age = 0
    this.doneFirstTick = false;
    this.startTickLoop();
    this.startTickRateTracker();
  }

  addPlayer(clientId, name, socket) {
    const existingNames = new Set([...this.players.values()].map(n => n.name));
    while (existingNames.has(name)) {
        name = "_" + name;
    }
  
    this.players.set(clientId, { socket, name, state: {pos: {x: 500, y:250}, vel: {x:0, y: 0}}});
  
    // ⬅ Full colors sent to this client only
    this.sendInit(clientId);
  }

  removePlayer(clientId) {
    this.players.delete(clientId);
  }

  broadcastPlayerStates() {
    const currentServerTime = Date.now();

    const playerStatesForClient = Array.from(this.players.values()).map(({ socket, ...rest }) => {
      return {
        ...rest,
        time: currentServerTime
      };
    });
    
    this.miserableBroadcastAI({type: 'playerSnapshot', serverTime: currentServerTime, players: playerStatesForClient});
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of this.players.values()) {
      client.socket.send(data);
    }
  }

  miserableBroadcastAI(msg) {
    const data = JSON.stringify(msg);
  
    for (const client of this.players.values()) {
      // decide whether to drop this frame
      if (Math.random() < TEST_DROP_CHANCE) continue;
  
      // compute randomized delay
      const jitter = (Math.random() * 2 - 1) * TEST_JITTER; // between -jitterMs and +jitterMs
      const delay = Math.max(0, Math.round(TEST_LAG + jitter));
  
      setTimeout(() => {
        if (client.socket && client.socket.readyState === client.socket.OPEN) {
          try {
            client.socket.send(data);
          } catch (err) {
            // ignore send errors for testing; optionally log them
            // console.warn('send failed', err);
          }
        }
      }, delay);
    }
  }

  sendInit(clientId) {
    const player = this.players.get(clientId);
    if (!player) return;
  
    const payload = {
      type: "init",
      clientId,
      name: player.name,
    };
    
    this.players.get(clientId).socket.send(JSON.stringify(payload));
  }

  tick() {
    if (!this.doneFirstTick) {
      this.doneFirstTick = true;
      this.age = 0;
    }

    const now = Date.now();

    if (!this._lastTickTime) this._lastTickTime = now;
    this.dt = now - this._lastTickTime;
    this.age += this.dt;
    this._lastTickTime = now;
    this.applyVelocities(this.dt);
    this.broadcastPlayerStates();
    
    

  }

  applyVelocities(dtMs) {
    if (!dtMs || dtMs <= 0) return;
    const dtSec = dtMs / 1000; // convert ms -> seconds
  
    for (const [clientId, player] of this.players.entries()) {
      const state = player && player.state;
      if (!state) continue;
  
      const pos = state.pos;
      const vel = state.vel;
      if (!pos || !vel) continue;
  
      // ensure numeric values exist (fallback to 0)
      const vx = Number(vel.x) || 0;
      const vy = Number(vel.y) || 0;
  
      pos.x += vx * dtSec;
      pos.y += vy * dtSec;
  
      // Optionally clamp or keep inside world bounds:
      // pos.x = Math.max(0, Math.min(pos.x, WORLD_WIDTH));
      // pos.y = Math.max(0, Math.min(pos.y, WORLD_HEIGHT));
    }
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

    console.log(`🛑 Game ${this.MAP_IMAGE} stopped.`);

    //clear internal references to help GC
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
    let nextTick = performance.now();

    const tickLoop = () => {
        const now = performance.now();

        this.tick();

        const smoothTPS = this.world?.actualTPS || IDEAL_TICK_RATE;
        const currentDt = 1000 / smoothTPS;

        nextTick += IDEAL_DT;
        const delay = Math.max(0, nextTick - performance.now() - (IDEAL_DT - currentDt));

        this._tickTimeout = setTimeout(tickLoop, delay);
    };

    this._tickTimeout = setTimeout(tickLoop, IDEAL_DT);
  }
}