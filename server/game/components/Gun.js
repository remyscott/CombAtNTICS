// sword.js
import { Box, Vec2, RevoluteJoint } from "planck";
import { configurableInputs } from "../../../shared/inputsListing.js";

// destructure numeric indices once (cheap at module init)
const { SWORD_CW, SWORD_CCW, SWORD_SLOW } = configurableInputs;

export class Sword {
  constructor(player) {
    const defaultOpts = { radius: 0.5, swordLength: 3, density: 1, friction: 0.5, restitution: .3, torque: 48, angularDampingWhenSlow: 300 };
    this.opts = defaultOpts;
    const playerBody = player.body;

    this.body = player.world.createBody({
      type: "dynamic",
      position: { x: this.opts.swordLength + 0.5, y: 0 },
      userData: { owner: this }
    });

    this.body.createFixture({
      shape: Box(this.opts.swordLength / 2, 0.1),
      density: this.opts.density,
      friction: this.opts.friction,
      restitution: this.opts.restitution,
      userData: { id: this.body.getUserData().id, type: 'sword', scale: this.opts.radius * 2 },
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
    if (inputs[SWORD_CW]) torque -= this.opts.torque;
    if (inputs[SWORD_CCW]) torque += this.opts.torque;

    if (torque !== 0) {
      this.body.applyTorque(torque);
    }

    if (inputs[SWORD_SLOW]) {
      this.body.setAngularDamping(this.opts.angularDampingWhenSlow);
    } else {
      this.body.setAngularDamping(0);
    }
  }

  onDestroy() {
    this.body.getWorld().destroyBody(this.body);
  }
}


Can you make a gun module that works like the sword module exept it orients itself using the MOUSE_POS_REL input, and fires a bullet when with bullet: true when the CLICK input happens. CLICK and MOUSE_POS_REL aren't configureable inputs, 