// components/Dash.js
import { Box, Vec2, RevoluteJoint } from 'planck';
import { configurableInputs } from '../../../shared/inputsListing.js';
import { Component } from './Component.js';
import { PLAYER_RENDER_DEPTH } from '../../../shared/consts.js';
const { DASH, UP, DOWN, LEFT, RIGHT } = configurableInputs;

export class Dash extends Component {
  /**
   * player: the Player instance (must have .body, .game)
   * opts:
   *   impulse: magnitude of impulse applied (default 12)
   *   cooldown: ms between uses (default 1000)
   *   rotationSpeed: multiplier for how fast the dash rotates toward input
   *   rotationTorque: max joint torque used to rotate the dash
   *   onDash: optional callback (player, info)
   */
  constructor(player, opts = {}) {
    super(player, opts);
    const defaults = {
      dashSize: { value: 0.5, scaleOrder: 1 },
      impulse: { value: 24, scaleOrder: 2 },
      cooldown: 1000,
      rotationSpeed: { value: 8, scaleOrder: 1 },
      rotationTorque: { value: 100, scaleOrder: 1 },
      onDash: null
    };
    this.opts = this.normalizeOpts(defaults, opts);

    this._lastDash = 0;
    this._tmp = Vec2(0, 0);
    this._facing = { x: 1, y: 0 };
    this._targetAngle = 0;
    this._joint = null;

    const world = this.player?.game?.world;
    if (world && this.player && this.player.body) {
      this.body = world.createBody({
        type: 'dynamic',
        position: this.player.body.getPosition(),
        angle: 0,
        userData: { owner: this, type: 'dashCore', scale: this.opts.scaleFactor, depth: PLAYER_RENDER_DEPTH + 2 }
      });

      this.fixture = this.body.createFixture({
        shape: Box(this.opts.dashSize, this.opts.dashSize),
        density: 0.01,
        isSensor: true,
        filter: { categoryBits: 0, maskBits: 0 },
        userData: { id: world.newId(), type: 'dashCore', scale: this.opts.scaleFactor, depth: PLAYER_RENDER_DEPTH + 2 }
      });

      this.body.setGravityScale(0);
      this.body.setAngularDamping(4);

      this._joint = world.createJoint(RevoluteJoint({
        bodyA: this.player.body,
        bodyB: this.body,
        localAnchorA: Vec2(0, 0),
        localAnchorB: Vec2(0, 0),
        enableMotor: true,
        maxMotorTorque: this.opts.rotationTorque,
        motorSpeed: 0,
      }));

      this.registerBody(this.body);
    }
  }

  _normalizeAngle(angle) {
    while (angle <= -Math.PI) angle += Math.PI * 2;
    while (angle > Math.PI) angle -= Math.PI * 2;
    return angle;
  }

  canDash() {
    const now = Date.now();
    return (now - this._lastDash) >= this.opts.cooldown;
  }

  applyInputs(inputs) {
    if (!inputs || !this.player || !this.player.body) return;

    const ip = inputs.actions || {};
    let dir = { x: 0, y: 0 };

    if (ip[UP]) dir.y -= 1;
    if (ip[DOWN]) dir.y += 1;
    if (ip[LEFT]) dir.x -= 1;
    if (ip[RIGHT]) dir.x += 1;

    const magnitude = Math.hypot(dir.x, dir.y);
    if (magnitude > 1e-6) {
      dir.x /= magnitude;
      dir.y /= magnitude;
      this._facing.x = dir.x;
      this._facing.y = dir.y;
      this._targetAngle = Math.atan2(dir.y, dir.x);
    }

    const pressed = !!ip[DASH];
    if (!pressed) return;
    if (!this.canDash()) return;

    if (Math.abs(this._facing.x) < 1e-6 && Math.abs(this._facing.y) < 1e-6) return;

    const impulseMag = this.opts.impulse;
    this._tmp.x = this._facing.x * impulseMag;
    this._tmp.y = this._facing.y * impulseMag;

    try {
      if (typeof this.player.body.applyLinearImpulse === 'function') {
        this.player.body.applyLinearImpulse(this._tmp, this.player.body.getWorldCenter(), true);
      } else if (typeof this.player.body.applyForce === 'function') {
        this.player.body.applyForce(this._tmp, this.player.body.getWorldPoint(Vec2(0, 0)));
      }
    } catch (e) {
      console.warn('Dash: failed to apply impulse', e);
    }

    this._lastDash = Date.now();

    if (typeof this.opts.onDash === 'function') {
      try { this.opts.onDash(this.player, { dir: { ...this._facing }, impulse: impulseMag }); } catch (e) {}
    }
  }

  update() {
    if (!this._joint || !this.body) return;

    const currentAngle = this._normalizeAngle(this.body.getAngle());
    const targetAngle = this._normalizeAngle(this._targetAngle);
    const error = this._normalizeAngle(targetAngle - currentAngle);
    const speed = error * this.opts.rotationSpeed;
    this._joint.setMotorSpeed(speed);
  }

  getCooldownRemaining() {
    const elapsed = Date.now() - this._lastDash;
    return Math.max(0, this.opts.cooldown - elapsed);
  }

  onDestroy() {
    if (this._joint) {
      this.safeDestroyJoint(this._joint);
      this._joint = null;
    }
    if (this.body) {
      this.safeDestroyBody(this.body);
      this.body = null;
    }
  }
}