// blockLauncher.js
import { Box, Vec2, RevoluteJoint } from "planck";
import { configurableInputs } from "../../../shared/inputsListing.js";

const { FIRE_GUN } = configurableInputs;

export class BlockLauncher {
  constructor(player, opts = {}) {
    const o = Object.assign({
      barrelLength: 1,
      launchForce: 2,      // impulse magnitude applied to projectile (impulse = force * dt or direct impulse)
      cooldown: 10,          // frames between shots
      motorMaxTorque: 20000000,
      motorMaxSpeed: 500,    // rad/s
      kp: 18,               // P gain
      kd: 0.4,              // D gain (damping)
      projectileSize: 0.25,
      projectileDensity: 1,
      radius: 0.5
    }, opts);

    this.opts = o;
    this.player = player;
    this.world = player.world;
    this._lastFire = false;
    this._cooldown = 0;

    // launcher body
    this.body = this.world.createBody({
      type: "dynamic",
      position: { x: o.barrelLength + 0.5, y: 0 },
      userData: { owner: this }
    });

    this.body.createFixture({
      shape: Box(o.barrelLength / 2, 0.12),
      density: o.projectileDensity,
      friction: 0.5,
      restitution: 0.1,
      userData: { id: this.body.getUserData().id, type: "blockLauncher", scale: o.radius * 2 }
    });

    // revolute joint (motor)
    this.joint = this.world.createJoint(RevoluteJoint({
      bodyA: player.body,
      bodyB: this.body,
      localAnchorA: Vec2(0, 0),
      localAnchorB: Vec2(-0.55 - o.barrelLength / 2, 0),
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
      this.fireProjectile();
      this._cooldown = this.opts.cooldown;
    }
    this._lastFire = false; //fire;
    if (this._cooldown > 0) this._cooldown--;
  }

  fireProjectile() {
    const angle = this.body.getAngle();
    const tipOffset = this.opts.barrelLength / 2;
    const muzzleX = this.body.getPosition().x + Math.cos(angle) * tipOffset;
    const muzzleY = this.body.getPosition().y + Math.sin(angle) * tipOffset;

    // create projectile
    const proj = this.world.createBody({
      type: "dynamic",
      position: { x: muzzleX, y: muzzleY },
      bullet: true,
      userData: { owner: this, type: "block_projectile", ttl: 5.0 }
    });

    const s = this.opts.projectileSize;
    proj.createFixture({
      shape: Box(s / 2, s / 2),
      density: this.opts.projectileDensity,
      friction: 0.2,
      restitution: 0.0,
      userData: { type: "redbox", scale: s }
    });

    // impulse vector (exact): direction * launchForce
    const dirX = Math.cos(angle), dirY = Math.sin(angle);
    const impulse = Vec2(dirX * this.opts.launchForce, dirY * this.opts.launchForce);

    // apply impulse to projectile at center
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

    // apply equal-and-opposite impulse to launcher at muzzle point (creates linear + angular recoil)
    const neg = Vec2(-impulse.x, -impulse.y);
    if (typeof this.body.applyLinearImpulse === "function") {
      this.body.applyLinearImpulse(neg, Vec2(muzzleX, muzzleY));
    } else if (typeof this.body.applyImpulse === "function") {
      this.body.applyImpulse(neg, Vec2(muzzleX, muzzleY));
    } else {
      const massL = this.body.getMass ? this.body.getMass() : 1;
      const dvxL = neg.x / massL, dvyL = neg.y / massL;
      const lv = this.body.getLinearVelocity();
      this.body.setLinearVelocity(Vec2(lv.x + dvxL, lv.y + dvyL));
    }

    return proj;
  }

  onDestroy() {
    if (this.joint) try { this.world.destroyJoint(this.joint); } catch (e) { /* ignore */ }
    if (this.body && this.body.getWorld()) try { this.body.getWorld().destroyBody(this.body); } catch (e) { /* ignore */ }
    this.joint = null;
    this.body = null;
  }
}