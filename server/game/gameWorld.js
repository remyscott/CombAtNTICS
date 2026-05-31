import { World, Box, Vec2, Circle} from 'planck';

const sum = (...nums) => nums.reduce((a,b) => a + b, 0);

const CATEGORY_STATIC  = 0x0001;
const CATEGORY_DEFAULT = 0x0002;
const ALL = CATEGORY_STATIC | CATEGORY_DEFAULT
const MASK_STATIC = ALL & ~CATEGORY_STATIC; // collide with everything except static

export class GameWorld extends World {
  constructor(map) {
    super({...map.planckConfig, allowSleep: true});
    this._id = 0;
    this._fId = 0;
    this._fmId = 128;
    this.idToBody = new Map();
    this.ttlBodyIds = new Set();
    this.metadata = {bodies: {}, fixtures: {}};
    this._fixtureMetaCache = new Map();
    this._time = 0;
    this.loadMapObjects(map.objects);
    this.setUpDamageListeners();
    this.setUpBulletDecayListener();
    this.pendingSparks = [];
    this._pendingDestroys = []
  }

  setUpDamageListeners() {
    this.on('post-solve', function(contact, impulse) {
      // get the two fixtures/bodies involved
      const fA = contact.getFixtureA();
      const fB = contact.getFixtureB();

      // your app stores custom data on the body
      const dataA = fA.getUserData();
      const dataB = fB.getUserData();

      // defensive checks
      if (!impulse || !impulse.normalImpulses) return;

      const totalImpulse = sum(...impulse.normalImpulses);

      

      this.createSparks(contact, this.tryApplyDamage(dataA, dataB, totalImpulse))
      this.createSparks(contact, this.tryApplyDamage(dataB, dataA, totalImpulse))
    });
  }

  setUpBulletDecayListener() {
    // threshold in meters per second under which bullets stop being bullets
    const BULLET_SPEED_THRESHOLD_2 = 20*20;

    const checkBullet = (body) => {
        const v = body.getLinearVelocity();
        const speedSq = v.x * v.x + v.y * v.y;

        if (speedSq <= (BULLET_SPEED_THRESHOLD_2)) {
          this._pendingDestroys.push(body)
        }
      };

    this.on('post-solve', (contact, impulse) => {
      // defensive: we only care about resolved impulses / collisions
      if (!impulse || !impulse.normalImpulses) return;

      const fA = contact.getFixtureA();
      const fB = contact.getFixtureB();
      if (!fA || !fB) return;
      const bA = fA.getBody();
      const bB = fB.getBody();
  
      if (fA.getUserData().type === 'bullet') checkBullet(bA);
      if (fB.getUserData().type === 'bullet') checkBullet(bB);
    });
  }

  createSparks(contact, damage) {
    const wm = contact.getWorldManifold();
    for (let i = 0; i < wm.pointCount; i++) {
      const p = wm.points[i];
      const pCopy = { x: p.x, y: p.y }; // clone
      let damageLeft = Math.round(damage);
      while (damageLeft > 0) {
        const scale = Math.max(1, Math.round(Math.random()*damageLeft));
        this.pendingSparks.push({ p: pCopy, scale });
        damageLeft -= scale;
      }
    }
  }

  createSparkAt(p, scale) {
    const body = this.createBody({type: 'dynamic', position: {x:p.x, y:p.y}, angle: Math.random(), userData: {ttl: 0.5/scale}})
    body.createFixture({
      shape: new Circle(Vec2(0,0), 0.01),
      density: 1,
      friction: .5,
      restitution: .9,
      userData: {id: this.newId(), type: 'spark', scale}
    });
    const random = Math.random();
    body.setLinearVelocity(Vec2(Math.sin(random)*25*scale, Math.cos(random)*25*scale))
    this.registerBody(body);
  }

  processPendingSparks() {
    while (this.pendingSparks.length) {
      const { p, scale } = this.pendingSparks.shift();
      this.createSparkAt(p, scale);
    }
  }

  tryApplyDamage(targetData, sourceData, impulse) {
    if (impulse <= 0.2) return
    if (!targetData || typeof targetData.health !== 'number') return;
    if (!sourceData || typeof sourceData.damageMultiplier !== 'number') return;
    const damage = impulse * sourceData.damageMultiplier - sourceData.minDamage;
    if (damage <= 0) return;
    targetData.health -= damage;
    if (damage >= 0) return damage;
  }

  loadMapObjects(objects) {
    this.createBodyForType = {'ball': this.createBallBody, 'box': this.createBoxBody, 'lockbox': this.createLockboxBody, 'circle': this.createCircleBody};
    const staticObjects = this.createBody({type: 'static'})
    let restitution = 0.2;
    let damageMultiplier = 1;

    for (const object of objects) {
      if (object.objectType === 'lockbox' || object.objectType === 'softbox') {
        if (Math.random()>0.85) object.objectType = 'softbox';
        if (object.objectType === 'lockbox') {restitution = 0.2; damageMultiplier = 1;}
        else {restitution = 1.1; damageMultiplier = 0.1};
        staticObjects.createFixture({
          shape: new Box(0.5 * object.scale, 0.5 * object.scale, object.position, object.angle || 0),
          friction: .5,
          filter: {categorybits: CATEGORY_STATIC, maskBits: MASK_STATIC},
          restitution: (restitution),
          userData: { id: this.newId(), type: object.objectType, scale: object.scale || 1,  damageMultiplier: Number(damageMultiplier), position: object.position, angle: object.angle, minDamage: 50,}
        });
      } else {
        this.addNewObject(object);
      }
    }
    this.registerBody(staticObjects);
  }

  newId() {
    return this._id++;
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
      userData: {id: this.newId(), type: config.objectType, scale: config.scale || 1, damageMultiplier: 1,
      minDamage: 5,}
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
      userData: {id: this.newId(), type: config.objectType, scale: config.scale || 1}
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
      userData: {id: this.newId(), type: config.objectType, scale: config.scale || 1}
    });

    return(body);
  }

  createLockboxBody(config) {
    // If object wants to move, create a kinematic body so we can drive transform
    const isMoving = !!config.moving
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
      userData: { id: this.newId(), type: config.objectType, scale: config.scale || 1,  damageMultiplier: 1,
      minDamage: 50,}
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
    if (!def.filter) def.filter = {categorybits: CATEGORY_DEFAULT, maskBits: ALL}
    const body = super.createBody({...def, userData: {...def.userData, id: this.newId(), fixtures: []}});
    return body;
  }

  registerBody(body) {
    const bodyMetadata = body.getUserData();

    // Produce the stored metadata (remove owner if necessary)
    const storedMeta = bodyMetadata.owner
      ? (() => { const { owner, ...withoutOwner } = bodyMetadata; return withoutOwner; })()
      : bodyMetadata;

    // Ensure fixtures array exists so pushes won't fail
    storedMeta.fixtures = [];

    // Save to canonical store
    this.metadata.bodies[bodyMetadata.id] = storedMeta;

    // Iterate fixtures on the body and create/reuse fixture meta ids
    let fixture = body.getFixtureList();
    while (fixture) {
      const fixtureMetadata = fixture.getUserData() || {}; 
      const metaId = this._findOrCreateFixtureMeta(fixtureMetadata);

      // Keep instance-level fixture info within body metadata (if needed)
      this.metadata.bodies[bodyMetadata.id].fixtures.push({ metaId, id: fixtureMetadata.id, angle: fixtureMetadata.angle || 0, position: fixtureMetadata.position || null });

      fixture = fixture.getNext();
    }

    this.idToBody.set(bodyMetadata.id, body);
    if (bodyMetadata.ttl) {
      this.ttlBodyIds.add(bodyMetadata.id);
    }
  }

  getBody(id) {
    return this.idToBody.get(id) || null;
  }

  destroyBody(body) {
    const id = body.getUserData().id;
    delete this.metadata.bodies[id];
    // if you keep fixture metadata keyed by fixture id, remove those entries too
    // then call super.destroyBody
    super.destroyBody(body);
    this.idToBody.delete(id);
    this.ttlBodyIds.delete(id);
  }

  step(config) {
    this.processPendingSparks();
    const t1 = performance.now();
    super.step(config); 
    const dtMs2 = performance.now() - t1;
    if (dtMs2 > 1000/60) console.log('long physics step:', dtMs2);

    for (const id of Array.from(this.ttlBodyIds)) {
      const body = this.idToBody.get(id);
      if (!body) {
        // already destroyed or never registered correctly
        this.ttlBodyIds.delete(id);
        continue;
      }
      const ud = body.getUserData();
      if (!ud) continue;
      if (typeof ud.ttl === 'number') {
        ud.ttl -= 1/60;
        if (ud.ttl <= 0) {
          // do not destroy inside physics callbacks; queue for after step
          this._pendingDestroys.push(body);
        }
      }
    }

    if (this._pendingDestroys && this._pendingDestroys.length) {
      for (const b of this._pendingDestroys) {
        if (b && typeof b.getUserData === 'function') {
          const id = b.getUserData().id;
          super.destroyBody(b);  // call world destroy
          this.idToBody.delete(id);
          this.ttlBodyIds.delete(id);
          delete this.metadata.bodies[id];
          // also remove any fixture meta cache entries referring to this body
        }
      }
      this._pendingDestroys.length = 0;
    }
  }

  

  _buildFixtureIdentity(fixtureMetadata) {
    if (!fixtureMetadata || typeof fixtureMetadata !== 'object') return {};

    // Example: only these keys form identity. Add/remove as needed.
    const identity = {
      type: fixtureMetadata.type,
      scale: fixtureMetadata.scale,
      name: fixtureMetadata.name,
      depth: fixtureMetadata.depth || false,
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

