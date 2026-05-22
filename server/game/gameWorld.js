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
    this.loadMapObjects(map.objects);
  }

  loadMapObjects(objects) {
    this.createBodyForType = {'box': this.createBoxBody, 'lockbox': this.createLockboxBody, 'circle': this.createCircleBody};

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

  createLockboxBody(config) {
    const body = this.createBody({
      type: 'static',
      position: config.position,
      angle: config.angle || 0,
    });

    body.createFixture({
      shape: new Box(0.5*config.scale, 0.5*config.scale),
      friction: .5,
      restitution: .2,
      userData: {id: this.newFxId(), type: config.objectType, scale: config.scale || 1}
    });
    
    return(body);
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
    super.step(config);
    for (const [id, body] of this.ttlBodies) {
      const ud = body.getUserData();
      if (!ud) continue;
      if (typeof ud.ttl === 'number') {
        ud.ttl -= config.dt || 1/60;
        if (ud.ttl <= 0) {
          this.destroyBody(body);
        }
      }
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

