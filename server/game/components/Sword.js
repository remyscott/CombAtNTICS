// sword.js
import { Polygon, Vec2, RevoluteJoint } from "planck";
import { configurableInputs } from "../../../shared/inputsListing.js";

// destructure numeric indices once (cheap at module init)
const { SWORD_CW, SWORD_CCW, SWORD_SLOW } = configurableInputs;

export class Sword {
  constructor(player) {
    const sf = player.sf || 1;
    const defaultOpts = { density: 0.5, friction: 1, restitution: 0, torque: 50*sf*sf*sf, angularDampingWhenSlow: 300 };
    this.opts = defaultOpts;
    const playerBody = player.body;

    this.body = player.world.createBody({
      type: "dynamic",
      position: { x: 3*sf, y: 0 },
      userData: { owner: this },
      bullet: true
    });

    this.body.createFixture({
      shape: Polygon([
              Vec2(-1.2*sf,0.22*sf),
              Vec2(-1.2*sf,-0.22*sf),
              Vec2(1.39*sf,-0.22*sf),
              Vec2(1.55*sf, 0),
              Vec2(1.39*sf,0.22*sf),
            ]),
      density: this.opts.density,
      friction: this.opts.friction,
      restitution: this.opts.restitution,
      userData: { id: this.body.getUserData().id, type: 'sword', scale: 1*sf, 
        damageMultiplier: 2,
        minDamage: 1,
        health: 0,
      },
      angularDamping: 0
    });

    player.world.createJoint(RevoluteJoint({
      bodyA: playerBody,
      bodyB: this.body,
      localAnchorA: Vec2(0, 0),
      localAnchorB: Vec2(-2*sf, 0),
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