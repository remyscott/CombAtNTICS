// HoverSphere.js
import { Circle, Vec2 } from "planck";
import { length, mulScalar, normalize } from "../../utilities/vec2helpers.js";
import { configurableInputs } from "../../../shared/inputsListing.js";

const { UP, DOWN, LEFT, RIGHT } = configurableInputs;

export class HoverSphere {
  constructor(player, opts = {}) {
    const defaults = {
      radius: 0.5,
      force: 20,
      density: 1,
      friction: 0.5,
      restitution: 0.5,

      // upright controller (PD)
      uprightKp: 8.0,         // proportional gain (torque per radian)
      uprightKd: 1.5,         // derivative gain (torque per rad/s)
      uprightMaxTorque: 60.0, // clamp for applied torque
      uprightDeadzone: 0.01,   // radians below which we won't bother

      dampingFactor: 0.98
    };
    this.opts = Object.assign({}, defaults, opts);

    this.body = player.body;

    this.body.setGravityScale(0);


    this.body.createFixture({
      shape: new Circle(new Vec2(0, 0), this.opts.radius),
      density: this.opts.density,
      friction: this.opts.friction,
      restitution: this.opts.restitution,
      userData: {
        id: this.body.getUserData().id,
        type: "hoversphere",
        scale: this.opts.radius * 2,
        name: player.name
      }
    });

    if (this.body.getWorld() && this.body.getWorld().registerBody) {
      this.body.getWorld().registerBody(this.body);
    }
    player.body = this.body;

    // small reusable temporaries to avoid allocations
    this._tmpDir = Vec2(0, 0);
    this._tmpForce = Vec2(0, 0);
  }

  // normalize into (-PI, PI]
  _normalizeAngle(a) {
    while (a <= -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
  }

  applyInputs(inputs) {
    if (!inputs || !this.body) return;

    // ----- translation/hover thrust (unchanged) -----
    // Reset direction
    this._tmpDir.x = 0;
    this._tmpDir.y = 0;

    if (inputs.actions[UP]) this._tmpDir.y -= 1;
    if (inputs.actions[DOWN]) this._tmpDir.y += 1;
    if (inputs.actions[LEFT]) this._tmpDir.x -= 1;
    if (inputs.actions[RIGHT]) this._tmpDir.x += 1;

    const mag = length(this._tmpDir);
    if (mag > 1e-6) {
      const dirNorm = normalize(this._tmpDir);
      this._tmpForce.x = dirNorm.x * this.opts.force;
      this._tmpForce.y = dirNorm.y * this.opts.force;

      // applyForce(force, point) — apply at body center (world point)
      this.body.applyForce(this._tmpForce, this.body.getWorldPoint(Vec2(0, 0)));
    }

    const currentAngle = this.body.getAngle(); // radians
    let angleError = this._normalizeAngle(0 - currentAngle);

    if (Math.abs(angleError) > this.opts.uprightDeadzone) {
      const angularVel = this.body.getAngularVelocity ? this.body.getAngularVelocity() : 0;

      const torqueP = this.opts.uprightKp * angleError;
      const torqueD = -this.opts.uprightKd * angularVel; 
      let torque = torqueP + torqueD;

      const maxT = this.opts.uprightMaxTorque;
      if (torque > maxT) torque = maxT;
      if (torque < -maxT) torque = -maxT;

      this.body.applyTorque(torque);
    }

    this.body.setLinearVelocity(mulScalar(this.body.getLinearVelocity(), this.opts.dampingFactor))
  }

  onDestroy() {
    if (this.body && this.body.getWorld()) {
      this.body.getWorld().destroyBody(this.body);
    }
  }
}