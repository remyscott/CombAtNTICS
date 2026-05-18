// sword.js
import { Box, Vec2, RevoluteJoint } from "planck";
import { configurableInputs } from "../../../shared/inputsListing.js";

// destructure numeric indices once (cheap at module init)
const { SWORD_CW, SWORD_CCW } = configurableInputs;

export class Sword {
  constructor(player) {
    const defaultOpts = { radius: 0.5, swordLength: 3, density: 1, friction: 0.5, restitution: .3, torque: 24, angularDamping: 0.4 };
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
      userData: { id: this.body.getUserData().id, type: 'sword', scale: this.opts.radius * 2 }
    });

    player.world.createJoint(RevoluteJoint({
      bodyA: playerBody,
      bodyB: this.body,
      localAnchorA: Vec2(0, 0),
      localAnchorB: Vec2(-0.5 - this.opts.swordLength / 2, 0),
      referenceAngle: this.body.getAngle() - playerBody.getAngle()
    }));

    // Use Planck's built-in angular damping (if available) or apply manual damping each tick.
    // Planck's Body#setAngularDamping exists on some builds; if not, we'll do manual damping in applyInputs.
    if (typeof this.body.setAngularDamping === 'function') {
      this.body.setAngularDamping(this.opts.angularDamping);
    }

    this.body.getWorld().registerBody(this.body);
  }

  // inputs: typed array (Uint8Array) indexed by numeric IDs from configurableInputs
  applyInputs(inputs) {
    if (!inputs || !this.body) return;

    // Determine torque direction: CW = negative or positive depending on coordinate system.
    // We'll treat SWORD_CW as clockwise rotation (negative torque in Planck/Box2D convention where positive is ccw).
    let torque = 0;
    if (inputs[SWORD_CW]) torque -= this.opts.torque;
    if (inputs[SWORD_CCW]) torque += this.opts.torque;

    if (torque !== 0) {
      // apply torque directly to the body
      this.body.applyTorque(torque);
    }

    // If Planck provides setAngularDamping we used it; otherwise apply manual damping.
    if (typeof this.body.setAngularDamping !== 'function') {
      const angVel = this.body.getAngularVelocity();
      const dampFactor = Math.max(0, 1 - this.opts.angularDamping * 0.016); // ~60fps scaling
      this.body.setAngularVelocity(angVel * dampFactor);
    }
  }

  onDestroy() {
    this.body.getWorld().destroyBody(this.body);
  }
}