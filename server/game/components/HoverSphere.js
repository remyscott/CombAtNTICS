// HoverSphere.js
import { Circle, Vec2 } from "planck";
import { length, mulScalar, normalize } from "../../utilities/vec2helpers.js";
import { configurableInputs } from "../../../shared/inputsListing.js";
import { PLAYER_RENDER_DEPTH } from "../../../shared/consts.js";
import { Component } from './Component.js';
import { buildFixtureOptions } from '../objectTypes.js';

const { UP, DOWN, LEFT, RIGHT } = configurableInputs;

export class HoverSphere extends Component {
  constructor(player, opts = {}) {
    super(player, opts);

    const defaults = {
      radius: { value: 0.5, scaleOrder: 1 },
      force: { value: 20, scaleOrder: 2 },
      density: 1,
      friction: 0.5,
      restitution: 0.2,
      health: { value: 100, scaleOrder: 2 },

      // upright controller (PD)
      uprightKp: { value: 160, scaleOrder: 2 },         // proportional gain (torque per radian)
      uprightKd: { value: 1.5, scaleOrder: 2 },         // derivative gain (torque per rad/s)
      uprightMaxTorque: 60.0, // clamp for applied torque
      uprightDeadzone: 0.01,   // radians below which we won't bother

      dampingFactor: 0.98
    };
    this.opts = this.normalizeOpts(defaults, opts);
    this.player = player;
    this.body = player.body;

    this.body.setGravityScale(0);

    const hoverScale = this.opts.radius / 0.5;
    const fixtureOpts = buildFixtureOptions(this.body.getWorld(), 'hoverSphere', {
      scale: hoverScale,
      density: this.opts.density,
      friction: this.opts.friction,
      restitution: this.opts.restitution,
      userData: {
        type: "hoverSphere",
        scale: hoverScale,
        depth: PLAYER_RENDER_DEPTH,
        health: this.opts.health,
        vars: {name: player.name, health: this.opts.health, maxHealth: this.opts.health},
        owner: player
      }
    });

    

    this.fixture = this.body.createFixture(fixtureOpts);
    this.body.getWorld().registerBody(this.body);

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

  update(TIMESTEP) {
    this.checkIfDead();
  }

  onDestroy() {
    if (this.body && this.body.getWorld()) {
      this.body.getWorld().destroyBody(this.body);
    }
  }



  checkIfDead() {
    if (this.fixture.getUserData().health <= 0) {
      this.onDeath();
    }
  }

  onDeath() {
    this.player.die()
  }
}