// sword.js
import { Box, Vec2, RevoluteJoint, Polygon } from "planck";
import { configurableInputs } from "../../../shared/inputsListing.js";
import { PLAYER_RENDER_DEPTH } from "../../../shared/consts.js";

// destructure numeric indices once (cheap at module init)
const { SWORD_CW, SWORD_CCW, SWORD_SLOW } = configurableInputs;

export class SwordBig {
  constructor(player) {
    const defaultOpts = { radius: 0.5, swordLength: 3, density: 1, friction: 0.5, restitution: .1, torque: 96, angularDampingWhenSlow: 300 };
    this.opts = defaultOpts;
    const playerBody = player.body;

    this.body = player.world.createBody({
      type: "dynamic",
      position: { x: 0.5, y: 0 },
      userData: { owner: this },
      bullet: true
    });

    this.body.createFixture({
      shape: Polygon([
        Vec2(-1.2,0.5),
        Vec2(-1.2,-0.5),
        Vec2(1.45,-0.5),
        Vec2(1.7, 0),
        Vec2(1.45,0.5),
      ]),
      density: this.opts.density,
      friction: this.opts.friction,
      restitution: this.opts.restitution,
      userData: { 
        id: this.body.getUserData().id, 
        type: 'swordBig', scale: 1, depth: PLAYER_RENDER_DEPTH-1,
        damageMultiplier: 1
      },
      angularDamping: this.opts.angularDamping
    });

    player.world.createJoint(RevoluteJoint({
      bodyA: playerBody,
      bodyB: this.body,
      localAnchorA: Vec2(0, 0),
      localAnchorB: Vec2(-0.5 - this.opts.swordLength / 2, 0),
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