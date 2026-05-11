import {IDEAL_TICK_RATE, TEST_DROP_CHANCE, TEST_JITTER, TEST_LAG, TIMESTEP} from './settings.js'
import { World, Circle, Vec2, Edge } from 'planck';
import { Player } from './player.js';

export class Game {
  constructor() {
    this.world = new World({
      gravity: {x: 0, y: 10}
    });

    let platform = this.world.createBody({
      type: "static",
      position: {x: 0, y: 15},
      angle: 0
    });
    
    platform.createFixture({
      shape: new Edge({x: -50, y: 0}, {x: +50, y: 0}),
      friction: .3,
      restitution: 0.2
    });
    platform.createFixture({
      shape: new Edge({x: 0, y: -50}, {x: 0, y: +50}),
      friction: .3,
      restitution: 0.2
    });
    platform.createFixture({
      shape: new Edge({x: +25, y: -50}, {x:+25, y: +50}),
      friction: .3,
      restitution: 0.2
    });
    
    this._id = 0;
    this.idToBody = new Map();

    this.players = new Map();
    this._tickTimeout = null;

    this.startTickLoop();
    this.startTickRateTracker();

    
  }

  addPlayer(clientId, name, socket) {
    const existingNames = new Set([...this.players.values()].map(p => p.name));
    while (existingNames.has(name)) {
        name = name + '.' + String(Math.floor(Math.random()*1000));
    }
    
    const newPlayer = new Player(socket, name, clientId);
    newPlayer.body = this.world.createBody({
      type: "dynamic",
      position: {x:Math.random()*10, y:1},
      userData: {id: this.newBodyId(), owner: newPlayer, type: 'player'}
    })

    newPlayer.body.createFixture({
      shape: new Circle(new Vec2(0, 0), 0.5),
      density: 1.0,
      friction: .5,
      angularDamping: 0.3,
      restitution: 0.5,
    })
    
    this.players.set(clientId, newPlayer);
  
    newPlayer.sendInit();
  }

  newBodyId() {
    return this._id++;
  }

  removePlayer(clientId) {
    this.players.delete(clientId);
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of this.players.values()) {
      client.ws.send(data);
    }
  }

  miserableBroadcast(msg) {
    const data = JSON.stringify(msg);
  
    for (const client of this.players.values()) {
      if (Math.random() < TEST_DROP_CHANCE) continue;
  
      const jitter = (Math.random() * 2 - 1) * TEST_JITTER;
      const delay = Math.max(0, Math.round(TEST_LAG + jitter));
  
      setTimeout(() => {
        if (client.socket && client.socket.readyState === client.socket.OPEN) {
          try {
            client.socket.send(data);
          } catch (err) {
            // ignore send errors for testing
          }
        }
      }, delay);
    }
  }

  

  tick() {
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      const meta = b.getUserData() || {};      
      if (meta.owner) { 
        meta.owner.applyForceTowardsMouse();
      }
    }

    this.world.step(TIMESTEP, 8, 4);
    this.broadcastSnapshot();
  }

  broadcastSnapshot() {

    const overallState = [];
    const metadatas = [];

    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      const meta = b.getUserData() || {};      
      const id = meta.id;
      if (id == null) continue; 
      if (meta.owner) {
        const {state, metadata} = meta.owner.getSnapshot();
        overallState[id] = state;
        metadatas[id] = metadata;
      }
    }
  
    this.broadcast({ type: 'snapshot', state: overallState, metadata: metadatas, time: Date.now() });
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