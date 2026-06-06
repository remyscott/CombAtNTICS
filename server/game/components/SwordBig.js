// sword.js
import { Box, Vec2, RevoluteJoint, Polygon } from "planck";
import { configurableInputs } from "../../../shared/inputsListing.js";
import { PLAYER_RENDER_DEPTH } from "../../../shared/consts.js";
import { Component } from './Component.js';

// destructure numeric indices once (cheap at module init)
const { SWORD_CW, SWORD_CCW, SWORD_SLOW } = configurableInputs;

export class SwordBig extends Component {
  constructor(player, opts = {}) {
    super(player, opts);
    const defaults = {
      density: 0.5,
      friction: 1,
      restitution: 0,
      torque: { value: 40, scaleOrder: 3 },
      angularDampingWhenSlow: 300
    };
    this.opts = this.normalizeOpts(defaults, opts);
    const playerBody = player.body;
    const s = this.opts.scaleFactor;

    this.body = player.world.createBody({
      type: "dynamic",
      position: { x: 0.5 * s, y: 0 },
      userData: { owner: this },
      bullet: true
    });

    player.world.createFixtureFromType(this.body, 'swordBig', {
      scale: s,
      density: this.opts.density,
      friction: this.opts.friction,
      restitution: this.opts.restitution,
      userData: {
        owner: this,
        depth: PLAYER_RENDER_DEPTH - 1,
        damageMultiplier: 2.5,
        minDamage: 2,
        health: 0,
      }
    });

    player.world.createJoint(RevoluteJoint({
      bodyA: playerBody,
      bodyB: this.body,
      localAnchorA: Vec2(0, 0),
      localAnchorB: Vec2(-1.6 * s, 0),
      referenceAngle: this.body.getAngle() - playerBody.getAngle()
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