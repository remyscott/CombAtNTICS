// sword.js
import { Polygon, Vec2, RevoluteJoint } from "planck";
import { configurableInputs } from "../../../shared/inputsListing.js";
import { Component } from './Component.js';

// destructure numeric indices once (cheap at module init)
const { SWORD_CW, SWORD_CCW, SWORD_SLOW } = configurableInputs;

export class Sword extends Component {
  constructor(player, opts = {}) {
    super(player, opts);
    const defaults = {
      density: 0.5,
      friction: 1,
      restitution: 0,
      torque: { value: 30, scaleOrder: 3 },
      angularDampingWhenSlow: 300
    };
    this.opts = this.normalizeOpts(defaults, opts);
    const playerBody = player.body;
    const s = this.opts.scaleFactor;

    this.body = player.world.createBody({
      type: "dynamic",
      position: { x: 3 * s, y: 0 },
      userData: { owner: this },
      bullet: true
    });

    player.world.createFixtureFromType(this.body, 'sword', {
      scale: s,
      density: this.opts.density,
      friction: this.opts.friction,
      restitution: this.opts.restitution,
      userData: {
        owner: this,
        damageMultiplier: 2.5,
        minDamage: 1,
      }
    });

    player.world.createJoint(RevoluteJoint({
      bodyA: playerBody,
      bodyB: this.body,
      localAnchorA: Vec2(0, 0),
      localAnchorB: Vec2(-1.6 * s, 0),
    }));

    this.body.getWorld().registerBody(this.body);
  }

  applyInputs(inputs) {
    if (!inputs || !this.body) return;
    let torque = 0;
    if (inputs.actions[SWORD_CW]) torque -= this.opts.torque;
    if (inputs.actions[SWORD_CCW]) torque += this.opts.torque;

    if (torque !== 0) {
      this.body.applyTorque(torque);
    }

    if (inputs.actions[SWORD_SLOW]) {
      this.body.setAngularDamping(this.opts.angularDampingWhenSlow);
    } else {
      this.body.setAngularDamping(0);
    }
  }

  onDestroy() {
    this.body.getWorld().destroyBody(this.body);
  }
}