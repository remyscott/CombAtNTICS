import { World, Box, Vec2, Circle} from 'planck';

export class GameWorld extends World {
  constructor(map) {
    super(map.planckConfig);
    this._id = 0;
    this._fId = 0;
    this._fmId = 128;
    this.idToBody = new Map();
    this.ttlBodies = new Map();
    this.metadata = {bodies: {}, fixtures: {}};
    this._fixtureMetaCache = new Map();
    this._time = 0;
    this.loadMapObjects(map.objects);
  }

  loadMapObjects(objects) {
    this.createBodyForType = {'ball': this.createBallBody, 'box': this.createBoxBody, 'lockbox': this.createLockboxBody, 'circle': this.createCircleBody};

    for (const object of objects) {
      this.addNewObject(object);
    } 
  }

  newBodyId() {
    return this._id++;
  }

  newFxId() {
    return this._fId++;
  }

  newFxMetaId() {
    while (this._fmId in this.metadata.fixtures) {
      this._fmId++;
    }
    return this._fmId++;
  }


  addNewObject(config) {
    const body = this.createBodyForType[config.objectType].call(this, config);
    this.registerBody(body);
  }

  createBoxBody(config) {
    const body = this.createBody({
      type: 'dynamic',
      position: config.position,
      angle: config.angle || 0,
    });

    body.createFixture({
      shape: new Box(0.5*config.scale, 0.5*config.scale),
      density: 0.25,
      friction: .5,
      restitution: .2,
      userData: {id: this.newFxId(), type: config.objectType, scale: config.scale || 1}
    });

    return(body);
  }

  createCircleBody(config) {
    const body = this.createBody({
      type: 'dynamic',
      position: config.position,
      angle: config.angle || 0,
    });

    body.createFixture({
      shape: new Circle(0.5*config.scale),
      density: 1,
      friction: .5,
      restitution: .9,
      userData: {id: this.newFxId(), type: config.objectType, scale: config.scale || 1}
    });

    return(body);
  }

  createBallBody(config) {
    const body = this.createBody({
      type: 'dynamic',
      position: config.position,
      angle: config.angle || 0,
    });

    body.createFixture({
      shape: new Circle(0.5*config.scale),
      density: 0.05,
      friction: .5,
      restitution: .5,
      userData: {id: this.newFxId(), type: config.objectType, scale: config.scale || 1}
    });

    return(body);
  }

  createLockboxBody(config) {
    // If object wants to move, create a kinematic body so we can drive transform
    const isMoving = !!config.moving;
    const body = this.createBody({
      type: isMoving ? 'kinematic' : 'static',
      position: config.position,
      angle: config.angle || 0,
    });

    // create fixture as usual
    body.createFixture({
      shape: new Box(0.5 * config.scale, 0.5 * config.scale),
      friction: .5,
      restitution: .2,
      userData: { id: this.newFxId(), type: config.objectType, scale: config.scale || 1 }
    });

    // If moving, attach motion metadata to the body userData so step() can find it.
    if (isMoving) {
      const ud = body.getUserData();
      // motion config: frequency (hz), phase (radians), magnitude (use scale)
      // allow optional overrides on config: freq, phase, axisMask
      const freq = typeof config.freq === 'number' ? config.freq : 1.0;       // 1 Hz default
      const phase = typeof config.phase === 'number' ? config.phase : 0.0;    // 0 rad default
      const mag = typeof config.mag === 'number' ? config.mag * config.scale : config.scale;      // magnitude == scale
      // axisMask optionally controls which axes move: 'xy', 'x', 'y'
      const axis = (typeof config.axis === 'string') ? config.axis.toLowerCase() : 'xy';

      // store original base position so movement is relative to spawn point
      ud.motion = {
        moving: true,
        baseX: ud.position ? ud.position.x : (config.position && config.position.x) || 0,
        baseY: ud.position ? ud.position.y : (config.position && config.position.y) || 0,
        freq,
        phase,
        mag,
        axis
      };

    }

    return body;
  }

  createBody(def) {
    const body = super.createBody({...def, userData: {...def.userData, id: this.newBodyId(), fixtures: []}});
    this.registerBody(body);
    return body;
  }

  registerBody(body) {
    const bodyMetadata = body.getUserData();

    // Produce the stored metadata (remove owner if necessary)
    const storedMeta = bodyMetadata.owner
      ? (() => { const { owner, ...withoutOwner } = bodyMetadata; return withoutOwner; })()
      : bodyMetadata;

    // Ensure fixtures array exists so pushes won't fail
    if (!Array.isArray(storedMeta.fixtures)) storedMeta.fixtures = [];

    // Save to canonical store
    this.metadata.bodies[bodyMetadata.id] = storedMeta;

    // Iterate fixtures on the body and create/reuse fixture meta ids
    let fixture = body.getFixtureList();
    while (fixture) {
      const fixtureMetadata = fixture.getUserData() || {};
      const metaId = this._findOrCreateFixtureMeta(fixtureMetadata);

      // Keep instance-level fixture info within body metadata (if needed)
      this.metadata.bodies[bodyMetadata.id].fixtures.push({ metaId, ...fixtureMetadata });

      fixture = fixture.getNext();
    }

    this.idToBody.set(bodyMetadata.id, body);
    if (bodyMetadata.ttl) {
      this.ttlBodies.set(bodyMetadata.id, body);
    }
  }

  getBody(id) {
    const body = this.idToBody.get(id);
    if (!body) {
      this.idToBody.delete(id);
    }
    return body;
  }

  destroyBody(body) {
    const id = body.getUserData().id;
    super.destroyBody(body);
    this.idToBody.delete(id);
    this.ttlBodies.delete(id);
  }

  step(config) {
    // run physics step first (keeps consistent)
    super.step(config); 


    const dt = 1/60;
    this._time += dt;
    // handle TTL as before
    for (const [id, body] of this.ttlBodies) {
      const ud = body.getUserData();
      if (!ud) continue;
      if (typeof ud.ttl === 'number') {
        ud.ttl -= dt;
        if (ud.ttl <= 0) {
          this.destroyBody(body);
        }
      }
    }

    // Update kinematic moving lockboxes
    // Iterate idToBody (all bodies) and apply motion where present
    for (const [id, body] of this.idToBody) {
      const ud = body.getUserData();
      if (!ud || !ud.motion) continue;
      const m = ud.motion; 
      if (!m.moving) return;

      // compute phase/time-driven offsets
      // position offset magnitude equals m.mag (== scale) as requested
      const omega = 2 * Math.PI * (m.freq || 1.0); // radians/sec
      const t = this._time;
      const sinv = Math.sin(omega * t + (m.phase || 0));

      // Oscillate both axes; you can alter formula to use distinct sin waves if needed
      const offX = (m.axis === 'y') ? 0 : sinv * m.mag;
      const offY = (m.axis === 'x') ? 0 : Math.sin(omega * t + (m.phase || 0) + Math.PI / 2) * m.mag;
      // above uses a 90deg-shifted sin on Y so motion isn't purely colinear; remove +PI/2 if want identical phase

      const targetX = (m.baseX || 0) + offX;
      const targetY = (m.baseY || 0) + offY;

      // preserve angle
      const angle = body.getAngle();

      // Set transform directly for kinematic body (Planckjs)
      // Use Vec2 from planck import
      body.setTransform(new Vec2(targetX, targetY), angle);

      // Optionally set zero velocity so collisions behave (kinematic bodies only use transform)
      body.setLinearVelocity(new Vec2(0, 0));
      body.setAngularVelocity(0);
    }
  }

  _buildFixtureIdentity(fixtureMetadata) {
    if (!fixtureMetadata || typeof fixtureMetadata !== 'object') return {};

    // Example: only these keys form identity. Add/remove as needed.
    const identity = {
      type: fixtureMetadata.type,
      scale: fixtureMetadata.scale,
      name: fixtureMetadata.name,
    };

    // Remove undefined keys for a cleaner canonical representation
    for (const k of Object.keys(identity)) {
      if (identity[k] === undefined) delete identity[k];
    }

    return identity;
  }

  // Deterministic canonicalizer for plain serializable objects
  _canonicalizeObject(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
      return '[' + obj.map(v => this._canonicalizeObject(v)).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    const parts = keys.map(k => JSON.stringify(k) + ':' + this._canonicalizeObject(obj[k]));
    return '{' + parts.join(',') + '}';
  }

  // Use a cache map to avoid scanning whole fixtures object repeatedly
  // Create this in constructor: this._fixtureMetaCache = new Map();
  _findOrCreateFixtureMeta(fixtureMetadata) {
    // Build the identity (memento) from supplied fixture metadata
    const identity = this._buildFixtureIdentity(fixtureMetadata);

    // Create canonical key
    const key = this._canonicalizeObject(identity);

    // Fast-path: cached lookup
    if (!this._fixtureMetaCache) this._fixtureMetaCache = new Map();
    const cached = this._fixtureMetaCache.get(key);
    if (cached != null) return cached;

    // Create new meta id
    const newMetaId = this.newFxMetaId();

    const storedMeta = Object.assign({}, identity, {
    });

    this.metadata.fixtures[newMetaId] = storedMeta;

    this._fixtureMetaCache.set(key, newMetaId);

    return newMetaId;
  }

}

