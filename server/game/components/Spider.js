// server/game/components/SpiderMovement.js
import { Circle, Vec2 } from "planck";
import { configurableInputs } from "../../../shared/inputsListing.js";

const { UP, DOWN, LEFT, RIGHT } = configurableInputs;

export class Spider {
  /**
   * player: object with .body (Planck body) and .name
   * opts: optional tuning
   */
  constructor(player, opts = {}) {
    const defaults = {
      // player visible/collision fixture (mimic HoverSphere)
      playerFixtureRadius: 0.4,
      playerDensity: 1,
      playerFriction: 0.5,
      playerRestitution: 0.2,

      // sensor (attached to the same body) used to detect ground
      sensorRadius: 1.5,
      sensorOffset: Vec2(0, 0),

      // movement tuning when grounded
      moveForce: 60,          // force magnitude applied while grounded
      maxGroundSpeed: 15,    // max linear speed while grounded
      groundedDampingFactor: 0.1, // damping when no input on ground

      // whether kinematic bodies count as ground
      allowKinematicAsGround: true,

      // pull-to-walls behavior when idle (no inputs)
      pullStrength: 20,
      pullMax: 40,
      pullDistanceThreshold: 2.0,

      // upright PD controller (copies HoverSphere style)
      uprightKp: 80.0,         // proportional gain (torque per radian)
      uprightKd: 1.5,          // derivative gain (torque per rad/s)
      uprightMaxTorque: 60.0,  // clamp for applied torque
      uprightDeadzone: 0.01,   // radians below which we won't bother

      // derivative smoothing
      angVelLPF: 0.25,

      // small linear damping applied each tick when no input and grounded
      holdDampingFactor: 0.9
    };

    this.opts = Object.assign({}, defaults, opts);

    if (!player || !player.body) throw new Error("SpiderMovement requires a player with .body");

    this.player = player;
    this.body = player.body;
    this.world = this.body.getWorld ? this.body.getWorld() : null;

    // Add a player fixture (same style as HoverSphere)
    try {
      this.body.createFixture({
        shape: new Circle(new Vec2(0, 0), this.opts.playerFixtureRadius),
        density: this.opts.playerDensity,
        friction: this.opts.playerFriction,
        restitution: this.opts.playerRestitution,
        userData: {
          id: this.body.getUserData && this.body.getUserData().id,
          type: "spider",
          scale: this.opts.playerFixtureRadius * 2,
        }
      });
    } catch (e) {
      // ignore duplicate fixture creation or other errors
    }

    // Register body if world supports it (follow HoverSphere)
    if (this.body.getWorld && this.body.getWorld().registerBody) {
      try { this.body.getWorld().registerBody(this.body); } catch (e) { /* ignore */ }
    }

    // Create sensor fixture attached to same body. Keep its reference so we can identify it.
    const fxId = (this.world && typeof this.world.newFxId === 'function') ? this.world.newFxId() : undefined;
    const sensorShape = new Circle(this.opts.sensorOffset || Vec2(0,0), this.opts.sensorRadius);

    try {
      this._sensorFixture = this.body.createFixture({
        shape: sensorShape,
        isSensor: true,
        userData: { id: fxId, type: "spiderSensor", scale: this.opts.sensorRadius*2 }
      });
    } catch (e) {
      this._sensorFixture = null;
    }

    // internal state
    this._grounded = false;
    this._tmpForce = Vec2(0, 0);
    this._contactPoints = []; // contact world points
    this._prevAngVel = 0;
    this._angVelLPF = Math.max(0, Math.min(1, this.opts.angVelLPF));
  }

  // normalize into (-PI, PI]
  _normalizeAngle(a) {
    while (a <= -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
  }

  // inspect contacts involving this body and the sensor fixture to determine grounded state + contact points
  _recomputeGroundedAndContacts() {
    this._grounded = false;
    this._contactPoints.length = 0;
    if (!this._sensorFixture || !this.body) return;

    try {
      for (let cl = this.body.getContactList(); cl; cl = cl.next) {
        const contact = cl.contact;
        if (!contact) continue;
        if (!contact.isTouching()) continue;

        const fa = contact.getFixtureA();
        const fb = contact.getFixtureB();
        let otherFixture = null;

        if (fa === this._sensorFixture) otherFixture = fb;
        else if (fb === this._sensorFixture) otherFixture = fa;
        else continue;

        const otherBody = otherFixture.getBody ? otherFixture.getBody() : null;
        if (!otherBody) continue;

        // detect ground-like body: static (or kinematic if allowed)
        let otherType = null;
        try { otherType = otherBody.getType ? otherBody.getType() : null; } catch (e) { otherType = null; }

        let isGroundLike = false;
        if (otherType === 'static') isGroundLike = true;
        else if (otherType === 'kinematic' && this.opts.allowKinematicAsGround) isGroundLike = true;
        else if (typeof otherType === 'number') {
          if (otherType === 0) isGroundLike = true;
          else if (otherType === 1 && this.opts.allowKinematicAsGround) isGroundLike = true;
        } else {
          try { if (typeof otherBody.isStatic === 'function' && otherBody.isStatic()) isGroundLike = true; } catch (e) {}
        }

        if (!isGroundLike) continue;

        // try to get contact world points via contact manifold (if available)
        let pts = [];
        try {
          if (typeof contact.getWorldManifold === 'function') {
            const wm = contact.getWorldManifold(null);
            if (wm && wm.points && wm.points.length) {
              for (let i = 0; i < wm.points.length; i++) {
                const p = wm.points[i];
                if (p) pts.push(Vec2(p.x, p.y));
              }
            }
          } else if (typeof contact.getManifold === 'function') {
            pts.push(otherBody.getPosition ? otherBody.getPosition() : Vec2(0,0));
          } else {
            pts.push(otherBody.getPosition ? otherBody.getPosition() : Vec2(0,0));
          }
        } catch (e) {
          try { pts.push(otherBody.getPosition ? otherBody.getPosition() : Vec2(0,0)); } catch(e){}
        }

        // filter and store contact points within threshold distance
        for (const p of pts) {
          try {
            const bx = this.body.getPosition().x;
            const by = this.body.getPosition().y;
            const dx = p.x - bx;
            const dy = p.y - by;
            const dist = Math.hypot(dx, dy);
            if (dist <= this.opts.pullDistanceThreshold) {
              this._contactPoints.push(p);
            }
          } catch (e) {}
        }

        // mark grounded if at least one ground-like contact exists
        if (this._contactPoints.length > 0) this._grounded = true;
        else this._grounded = true; // still grounded if ground-like body but no close points (conservative)
      }
    } catch (e) {
      this._grounded = false;
      this._contactPoints.length = 0;
    }
  }

  // Called each physics tick. Same convention as HoverSphere.applyInputs (no dt).
  applyInputs(inputs) {
  if (!inputs || !this.body) return;

  // First: recompute grounded state and contact points so upright controller knows whether to run
  this._recomputeGroundedAndContacts();

  // 1) Upright PD controller (only when grounded)
  try {
    if (this._grounded) {
      const currentAngle = this.body.getAngle ? this.body.getAngle() : 0;
      let angleError = this._normalizeAngle(0 - currentAngle);

      if (Math.abs(angleError) > this.opts.uprightDeadzone) {
        const rawAngVel = (typeof this.body.getAngularVelocity === "function") ? this.body.getAngularVelocity() : 0;
        const angVel = (1 - this._angVelLPF) * this._prevAngVel + this._angVelLPF * rawAngVel;
        this._prevAngVel = angVel;

        const torqueP = this.opts.uprightKp * angleError;
        const torqueD = -this.opts.uprightKd * angVel;
        let torque = torqueP + torqueD;

        const maxT = this.opts.uprightMaxTorque;
        if (torque > maxT) torque = maxT;
        if (torque < -maxT) torque = -maxT;

        // apply torque and wake body if possible
        if (typeof this.body.applyTorque === 'function') {
          try { this.body.applyTorque(torque, true); } catch (e) { this.body.applyTorque(torque); }
        } else if (typeof this.body.applyAngularImpulse === 'function') {
          try { this.body.applyAngularImpulse(torque, true); } catch (e) { this.body.applyAngularImpulse(torque); }
        }
      }
    }
  } catch (e) {
    // ignore upright controller errors
  }

  // 2) Movement + stick-to-walls behavior
  const actions = inputs.actions || {};
  const up = !!actions[UP];
  const down = !!actions[DOWN];
  const left = !!actions[LEFT];
  const right = !!actions[RIGHT];

  // if not grounded, do nothing (let gravity/physics handle)
  if (!this._grounded) return;

  // If player is giving input, act normally (move toward direction)
  let fx = 0, fy = 0;
  if (left && !right) fx = -1;
  else if (right && !left) fx = 1;

  if (up && !down) fy = -1;
  else if (down && !up) fy = 1;

  if (fx !== 0 || fy !== 0) {
    // regular movement
    const len = Math.hypot(fx, fy);
    if (len > 1e-6) {
      fx = (fx / len) * this.opts.moveForce;
      fy = (fy / len) * this.opts.moveForce;
    }
    this._tmpForce.x = fx;
    this._tmpForce.y = fy;

    try {
      if (typeof this.body.applyForce === 'function') {
        this.body.applyForce(this._tmpForce, this.body.getWorldPoint(Vec2(0, 0)));
      } else if (typeof this.body.applyLinearImpulse === 'function') {
        const dt = 1/60;
        const impulse = Vec2(this._tmpForce.x * dt, this._tmpForce.y * dt);
        this.body.applyLinearImpulse(impulse, this.body.getWorldCenter());
      } else {
        const v = this.body.getLinearVelocity();
        this.body.setLinearVelocity(Vec2(v.x + fx * 0.01, v.y + fy * 0.01));
      }
    } catch (e) {}
  } else {
    // NO INPUT: hold still and slightly pull toward walls if contacts exist
    if (this._contactPoints.length > 0) {
      // compute centroid of contact points
      let cx = 0, cy = 0;
      for (const p of this._contactPoints) { cx += p.x; cy += p.y; }
      cx /= this._contactPoints.length;
      cy /= this._contactPoints.length;

      // vector from body to centroid
      const bx = this.body.getPosition().x;
      const by = this.body.getPosition().y;
      let dx = cx - bx;
      let dy = cy - by;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-4) {
        // desired pull magnitude scaled by pullStrength, weaker at close range
        const pull = Math.min(this.opts.pullMax, this.opts.pullStrength);
        const factor = Math.max(0.1, Math.min(1, dist / (this.opts.pullDistanceThreshold || 1.0)));
        const px = (dx / dist) * pull * factor;
        const py = (dy / dist) * pull * factor;

        // apply small force toward contact centroid to hold to wall
        try {
          if (typeof this.body.applyForce === 'function') {
            this.body.applyForce(Vec2(px, py), this.body.getWorldPoint(Vec2(0, 0)));
          } else if (typeof this.body.applyLinearImpulse === 'function') {
            const dt = 1/60;
            this.body.applyLinearImpulse(Vec2(px * dt, py * dt), this.body.getWorldCenter());
          } else {
            const v = this.body.getLinearVelocity();
            this.body.setLinearVelocity(Vec2(v.x + px * 0.01, v.y + py * 0.01));
          }
        } catch (e) {}
      } else {
        // extremely close: damp velocity
        try {
          const v = this.body.getLinearVelocity();
          this.body.setLinearVelocity(Vec2(v.x * this.opts.groundedDampingFactor, v.y * this.opts.groundedDampingFactor));
        } catch (e) {}
      }
    } else {
      // no contacts: simple damping to hold still
      try {
        const v = this.body.getLinearVelocity();
        this.body.setLinearVelocity(Vec2(v.x * this.opts.groundedDampingFactor, v.y * this.opts.groundedDampingFactor));
      } catch (e) {}
    }
  }

  // clamp speed while grounded
  try {
    const vel = this.body.getLinearVelocity();
    const spd = Math.hypot(vel.x, vel.y);
    if (spd > this.opts.maxGroundSpeed) {
      const factor = this.opts.maxGroundSpeed / spd;
      this.body.setLinearVelocity(Vec2(vel.x * factor, vel.y * factor));
    }
  } catch (e) {}
}

  isGrounded() {
    return !!this._grounded;
  }

  onDestroy() {
    // destroy sensor fixture only; do not destroy player's body here
    try {
      if (this._sensorFixture && this.body && this.body.getWorld) {
        try {
          if (typeof this.body.destroyFixture === 'function') this.body.destroyFixture(this._sensorFixture);
          else if (this.body.getWorld && typeof this.body.getWorld().destroyFixture === 'function') {
            this.body.getWorld().destroyFixture(this._sensorFixture);
          }
        } catch (e) {}
      }
    } catch (e) {}
    this._sensorFixture = null;
  }
}