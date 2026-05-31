// src/weapons.js
import { Box, Vec2, Circle, RevoluteJoint } from 'planck';
import { configurableInputs } from "../../../shared/inputsListing.js";

const { FIRE_GUN, GUN_SLOW } = configurableInputs;

// Generic base weapon class
export class ShotgunBase {
  constructor(player, opts = {}) {
    const sf = player.sf || 1;

    const o = opts;
    o.projectileSize *= sf;
    o.launchForce *= sf*sf;
    o.maxMotorTorque *= sf;
    this.opts = o;
    this.player = player;
    this.world = player.world;
    this._lastFire = false;
    this._cooldown = 0;

    // launcher body
    this.body = this.world.createBody({
      type: "dynamic",
      position: { x: (o.barrelLength + 0.5)*sf, y: 0 },
      userData: { owner: this }
    });

    this.body.createFixture({
      shape: Box(o.barrelLength*sf / 2, o.radius*sf),
      density: o.projectileDensity,
      friction: 0.2,
      restitution: 0.1,
      userData: { id: this.body.getUserData().id, type: o.objectType, scale: 1*sf}
    });

    // revolute joint (motor)
    this.joint = this.world.createJoint(RevoluteJoint({
      bodyA: player.body,
      bodyB: this.body,
      localAnchorA: Vec2(0, 0),
      localAnchorB: Vec2((-0.55 - o.barrelLength / 2)*sf, 0),
      enableMotor: true,
      motorSpeed: 0,
      maxMotorTorque: o.motorMaxTorque
    }));

    if (this.world.registerBody) this.world.registerBody(this.body);
  }

  // wrap to (-PI, PI]
  _wrap(a) {
    while (a <= -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
  }

  // current relative = launcherAngle - playerAngle (normalized)
  _currentRel() {
    return this._wrap(this.body.getAngle() - this.player.body.getAngle());
  }

  applyInputs(inputs) {
    if (!inputs || !this.body || !this.joint) return;

    // Aim: mousePosRel is player-local vector (player center -> mouse)
    const m = inputs.default && inputs.default.mousePosRel;
    if (m && typeof m.x === "number" && typeof m.y === "number") {
      const desiredRel = this._wrap(Math.atan2(m.y, m.x)); // player-local desired angle
      const curRel = this._currentRel();
      const error = this._wrap(desiredRel - curRel);

      // relative angular speed (joint gives relative speed); fallback 0
      const jSpeed = (typeof this.joint.getJointSpeed === "function") ? this.joint.getJointSpeed() : 0;

      // PD -> motor speed
      const desiredSpeed = this.opts.kp * error - this.opts.kd * jSpeed;
      const clamped = Math.max(-this.opts.motorMaxSpeed, Math.min(this.opts.motorMaxSpeed, desiredSpeed));

      this.joint.setMaxMotorTorque(this.opts.motorMaxTorque);
      this.joint.setMotorSpeed(clamped);
      this.joint.enableMotor(true);
    }

    // Fire on rising edge
    const fire = inputs.actions && !!inputs.actions[FIRE_GUN];
    if (fire && !this._lastFire && this._cooldown <= 0) {
      this.fireProjectileMulti();
      this._cooldown = this.opts.cooldown;
    }
    this._lastFire = false; // note: original had this set false; keep same rising-edge behavior
    if (this._cooldown > 0) this._cooldown--;

    if (inputs.actions[GUN_SLOW]) {
      this.body.setAngularDamping(this.opts.angularDampingWhenSlow);
    } else {
      this.body.setAngularDamping(0);
    }
  }

  fireProjectileMulti() {
    const angle = this.body.getAngle();
    const tipOffset = this.opts.barrelLength / 2.2;
    const muzzleX = this.body.getPosition().x + Math.cos(angle) * tipOffset;
    const muzzleY = this.body.getPosition().y + Math.sin(angle) * tipOffset;

    const count = Math.max(1, Math.floor(this.opts.multiShotCount || 1));
    const spread = Math.max(0, this.opts.multiShotSpread || 0);
    const randomness = Math.max(0, Math.min(1, this.opts.multiShotRandomness || 0));
    const baseForce = this.opts.launchForce || 0;
    const ttl = this.opts.projectileTTL || 5.0;

    // Accumulate the total impulse applied to projectiles so we can apply equal-and-opposite recoil.
    let totalProjImpulse = Vec2(0, 0);

    // Helper to spawn a projectile at muzzle with given angle, apply impulse, and return impulse Vec2
    const spawnProjectileAtAngle = (projAngle) => {
      // place projectile at muzzle (could apply a small forward offset to avoid overlap)
      const px = muzzleX + Math.cos(projAngle) * (this.opts.projectileSize * 0.6);
      const py = muzzleY + Math.sin(projAngle) * (this.opts.projectileSize * 0.6);

      const proj = this.world.createBody({
        type: "dynamic",
        position: { x: px, y: py },
        bullet: true,
        userData: { owner: this, ttl: ttl },
        angle: projAngle
      });

      const s = this.opts.projectileSize;
      proj.createFixture({
        shape: Box(s / 2, s / 4),
        density: this.opts.projectileDensity,
        friction: 0.2,
        restitution: 0.0,
        userData: { type: "bullet", scale: s, damageMultiplier: this.opts.projDmgMult|| 16, minDamage: this.opts.projMinDmg || 1 },
      });

      // impulse vector for this projectile
      const ix = Math.cos(projAngle) * baseForce;
      const iy = Math.sin(projAngle) * baseForce;
      const impulse = Vec2(ix, iy);

      // apply impulse to projectile
      if (typeof proj.applyLinearImpulse === "function") {
        proj.applyLinearImpulse(impulse, proj.getWorldCenter());
      } else if (typeof proj.applyImpulse === "function") {
        proj.applyImpulse(impulse, proj.getWorldCenter());
      } else {
        const mass = proj.getMass ? proj.getMass() : 1;
        const dvx = impulse.x / mass, dvy = impulse.y / mass;
        const pv = proj.getLinearVelocity();
        proj.setLinearVelocity(Vec2(pv.x + dvx, pv.y + dvy));
      }

      if (this.world.registerBody) this.world.registerBody(proj);

      return impulse;
    };

    // Compute angles across the spread. If count==1, fire straight. Otherwise distribute evenly between -spread/2..+spread/2
    for (let i = 0; i < count; i++) {
      let offsetAngle;
      if (count === 1) {
        offsetAngle = 0;
      } else {
        const t = (count === 1) ? 0.5 : (i / (count - 1)); // 0..1
        offsetAngle = (t - 0.5) * spread;
      }

      // optional jitter proportional to spread
      if (randomness > 0) {
        const jitter = (Math.random() * 2 - 1) * spread * randomness;
        offsetAngle += jitter;
      }

      const projAngle = angle + offsetAngle;
      const impulse = spawnProjectileAtAngle(projAngle);

      // vector sum
      totalProjImpulse = Vec2(totalProjImpulse.x + impulse.x, totalProjImpulse.y + impulse.y);
    }

    // Apply equal-and-opposite recoil to launcher at muzzle point.
    const recoil = Vec2(-totalProjImpulse.x, -totalProjImpulse.y);
    if (typeof this.body.applyLinearImpulse === "function") {
      this.body.applyLinearImpulse(recoil, Vec2(muzzleX, muzzleY));
    } else if (typeof this.body.applyImpulse === "function") {
      this.body.applyImpulse(recoil, Vec2(muzzleX, muzzleY));
    } else {
      const massL = this.body.getMass ? this.body.getMass() : 1;
      const dvxL = recoil.x / massL, dvyL = recoil.y / massL;
      const lv = this.body.getLinearVelocity();
      this.body.setLinearVelocity(Vec2(lv.x + dvxL, lv.y + dvyL));
    }

    // Return total impulse vector applied to projectiles (useful for tests/feedback)
    return totalProjImpulse;
  }

  onDestroy() {
    if (this.joint) try { this.world.destroyJoint(this.joint); } catch (e) { /* ignore */ }
    if (this.body && this.body.getWorld()) try { this.body.getWorld().destroyBody(this.body); } catch (e) { /* ignore */ }
    this.joint = null;
    this.body = null;
  }
}

// Thin wrappers with different defaults
export class GunBasic extends ShotgunBase {
  constructor(player, opts = {}) {
    super(player, Object.assign({
      barrelLength: 1,
      launchForce: 0.5,
      cooldown: 20,
      motorMaxTorque: 20000000,
      motorMaxSpeed: 500,
      kp: 18,
      kd: 0.4,
      projectileSize: 0.25,
      projectileDensity: 0.125,
      radius: 0.2,
      multiShotCount: 1,
      multiShotSpread: 0,
      multiShotRandomness: 0,
      projectileTTL: 5.0,
      angularDampingWhenSlow: 20,
      objectType: 'Gun',
    }, opts));
  }
}

export class Shotgun extends ShotgunBase {
  constructor(player, opts = {}) {
    super(player, Object.assign({
      barrelLength: 1,
      launchForce: 0.5,
      cooldown: 60,
      motorMaxTorque: 20000000,
      motorMaxSpeed: 500,
      kp: 18,
      kd: 0.4,
      projectileSize: 0.25,
      projectileDensity: 0.125,
      radius: 0.2,
      multiShotCount: 8,
      multiShotSpread: Math.PI / 8,
      multiShotRandomness: 0.0,
      projectileTTL: 5.0,
      angularDampingWhenSlow: 20,
objectType: 'Shotgun'
    }, opts));
  }
}

export class SawedOff extends ShotgunBase {
  constructor(player, opts = {}) {
    super(player, Object.assign({
      barrelLength: 1,
      launchForce: 0.5,
      cooldown: 60,
      motorMaxTorque: 20000000,
      motorMaxSpeed: 500,
      kp: 18,
      kd: 0.4,
      projectileSize: 0.125,
      projectileDensity: 0.125,
      radius: 0.2,
      multiShotCount: 32,
      multiShotSpread: Math.PI / 2,
      multiShotRandomness: 0,
      projectileTTL: 5,
      angularDampingWhenSlow: 20,
objectType: 'SawedOff'
    }, opts));
  }
}

export class UltraShotgun extends ShotgunBase {
  constructor(player, opts = {}) {
    super(player, Object.assign({
      barrelLength: 2,
      launchForce: 1,
      cooldown: 60,
      motorMaxTorque: 20000000,
      motorMaxSpeed: 500,
      kp: 18,
      kd: 0.4,
      projectileSize: 0.25,
      projectileDensity: 0.125,
      radius: 0.2,
      multiShotCount: 32,
      multiShotSpread: Math.PI / 8,
      multiShotRandomness: 0,
      projectileTTL: 10,
      angularDampingWhenSlow: 20,
objectType: 'UltraShotgun'
    }, opts));
  }
}

export class UltraUltraShotgun extends ShotgunBase {
  constructor(player, opts = {}) {
    super(player, Object.assign({
      barrelLength: 3,
      launchForce: 3,           // impulse magnitude applied to each projectile
      cooldown: 60,             // frames between shots
      motorMaxTorque: 20000000,
      motorMaxSpeed: 500,       // rad/s
      kp: 18,                   // P gain for aiming motor
      kd: 0.4,                  // D gain (damping)
      projectileSize: 0.5,
      projectileDensity: 0.125,
      radius: 0.3,

      // Multi-shot-specific
      multiShotCount: 32,            // number of projectiles per shot
      multiShotSpread: Math.PI / 4, // total spread angle (radians)
      multiShotRandomness: 0,    // fraction of spread for jitter (0..1)
      projectileTTL: 10     ,
      angularDampingWhenSlow: 20,
objectType: 'UltraUltraShotgun'
    }, opts));
  }
}


export class Minigun extends ShotgunBase {
  constructor(player, opts = {}) {
    super(player, Object.assign({
      barrelLength: 2,
      launchForce: 0.5,      // impulse magnitude applied to projectile (impulse = force * dt or direct impulse)
      cooldown: 4,          // frames between shots
      motorMaxTorque: 20000000,
      motorMaxSpeed: 500,    // rad/s
      kp: 18,               // P gain
      kd: 0.4,              // D gain (damping)
      projectileSize: 0.25,
      projectileDensity: 0.125,
      radius: 0.25,

      multiShotCount: 1,            // number of projectiles per shot
      multiShotSpread: Math.PI / 16, // total spread angle (radians)
      multiShotRandomness: 1,    // fraction of spread for jitter (0..1)
      projectileTTL: 1,
      angularDampingWhenSlow: 20,
objectType: 'Minigun'
    }, opts));
  }
}

export class UltraMinigun extends ShotgunBase {
  constructor(player, opts = {}) {
    super(player, Object.assign({
      barrelLength: 3,
      launchForce: 0.5,      // impulse magnitude applied to projectile (impulse = force * dt or direct impulse)
      cooldown: 1,          // frames between shots
      motorMaxTorque: 20000000,
      motorMaxSpeed: 500,    // rad/s
      kp: 18,               // P gain
      kd: 0.4,              // D gain (damping)
      projectileSize: 0.25,
      projectileDensity: 0.125,
      radius: 0.25,

      multiShotCount: 2,            // number of projectiles per shot
      multiShotSpread: Math.PI / 16, // total spread angle (radians)
      multiShotRandomness: 1,    // fraction of spread for jitter (0..1)
      projectileTTL: 1,
      angularDampingWhenSlow: 20,
objectType: 'UltraMinigun'
    }, opts));
  }
}


export class Smg extends ShotgunBase {
  constructor(player, opts = {}) {
    super(player, Object.assign({
      barrelLength: 1,
      launchForce: 0.3,      // impulse magnitude applied to projectile (impulse = force * dt or direct impulse)
      cooldown: 5,          // frames between shots
      motorMaxTorque: 200000,
      motorMaxSpeed: 500,    // rad/s
      kp: 18,               // P gain
      kd: 0.4,              // D gain (damping)
      projectileSize: .176,
      projectileDensity: 0.125,
      radius: .3,

      multiShotCount: 1,            // number of projectiles per shot
      multiShotSpread: 3.14/16, // total spread angle (radians)
      multiShotRandomness: 1,    // fraction of spread for jitter (0..1)
      projectileTTL: 1,
      angularDampingWhenSlow: 20,
objectType: 'Smg'
    }, opts));
  }
}


export class Heavy extends ShotgunBase {
  constructor(player, opts = {}) {
    super(player, Object.assign({
      barrelLength: 2,
      launchForce: 1.25,      // impulse magnitude applied to projectile (impulse = force * dt or direct impulse)
      cooldown: 30,          // frames between shots
      motorMaxTorque: 20000000,
      motorMaxSpeed: 500,    // rad/s
      kp: 18,               // P gain
      kd: 0.4,              // D gain (damping)
      projectileSize: .5,
      projectileDensity: 0.125,
      radius: .3,

      multiShotCount: 1,            // number of projectiles per shot
      multiShotSpread: 0, // total spread angle (radians)
      multiShotRandomness: 0,    // fraction of spread for jitter (0..1)
      projectileTTL: 10,
      angularDampingWhenSlow: 20,
objectType: 'Heavy'
    }, opts));
  }
}

export class Cannon extends ShotgunBase {
  constructor(player, opts = {}) {
    super(player, Object.assign({
      barrelLength: 5,
      launchForce: 25,      // impulse magnitude applied to projectile (impulse = force * dt or direct impulse)
      cooldown: 120,          // frames between shots
      motorMaxTorque: 20000000,
      motorMaxSpeed: 500,    // rad/s
      kp: 18,               // P gain
      kd: 0.4,              // D gain (damping)
      projectileSize: 1,
      projectileDensity: 0.125,
      radius: .75,

      multiShotCount: 1,            // number of projectiles per shot
      multiShotSpread: 0, // total spread angle (radians)
      multiShotRandomness: 0,    // fraction of spread for jitter (0..1)
      projectileTTL: 10,
      angularDampingWhenSlow: 100,
objectType: 'Cannon'
    }, opts));
  }
}

export class THE_ULTRA_CANNON extends ShotgunBase {
  constructor(player, opts = {}) {
    super(player, Object.assign({
      barrelLength: 10,
      launchForce: 250,      // impulse magnitude applied to projectile (impulse = force * dt or direct impulse)
      cooldown: 600,          // frames between shots
      motorMaxTorque: 20000000000,
      motorMaxSpeed: 5000,    // rad/s
      kp: 18,               // P gain
      kd: 0.4,              // D gain (damping)
      projectileSize: 2.5,
      projectileDensity: 1,
      radius: 1.5,

      multiShotCount: 2,            // number of projectiles per shot
      multiShotSpread: 3.14/6, // total spread angle (radians)
      multiShotRandomness: 0.15,    // fraction of spread for jitter (0..1)
      projectileTTL: 25,
      angularDampingWhenSlow: 100,
      objectType: 'THE_ULTRA_CANNON'
    }, opts));
  }
}

export class Sniper extends ShotgunBase {
  constructor(player, opts = {}) {
    super(player, Object.assign({
      barrelLength: 3,
      launchForce: 25,      // impulse magnitude applied to projectile (impulse = force * dt or direct impulse)
      cooldown: 60,          // frames between shots
      motorMaxTorque: 20000000,
      motorMaxSpeed: 5000,    // rad/s
      kp: 16,               // P gain
      kd: 0.4,              // D gain (damping)
      projectileSize: 0.25,
      projectileDensity: 0.125,
      radius: .2,
      projDmgMult: 128,
      multiShotCount: 1,            // number of projectiles per shot
      multiShotSpread: 0, // total spread angle (radians)
      multiShotRandomness: 0,    // fraction of spread for jitter (0..1)
      projectileTTL: 10,
      angularDampingWhenSlow: 100,
objectType: 'Sniper'
    }, opts));
  }
}

function chance(chance) {
  return (Math.random()<chance)
}
export function addRandomGunToComponentList(components) {
    if (chance(1/4)) {
      if (chance(1/2)) {
        components.push(Shotgun);
      } else {
        if (chance(1/2)) {
          components.push(SawedOff);
        } else {
          if (chance(.9)) {
              components.push(UltraShotgun)
            }
           else {
            components.push(UltraUltraShotgun)
          }
        }
      }
      
    } else {
      if (chance(1/5)) {
        if (chance(2/3)) {
          components.push(Heavy);
        } else {
          if (chance(0.97)) {
            components.push(Cannon);
          } else {
            components.push(THE_ULTRA_CANNON);
          }
        }
        
      } else {
        if (chance(1/4)) {
          if (chance(1/2)) {
            components.push(Smg);
          } else {
            if (chance(4/5)) {
              components.push(Minigun);
            } else {
              components.push(UltraMinigun);
            }
          }
        } else {
          if (chance(1/3)) {
            components.push(Sniper);
          } else {
            components.push(GunBasic);
          }
        }
      }
    }
    if (chance(0.005)) {
      addRandomGunToComponentList(components);
    }
  }