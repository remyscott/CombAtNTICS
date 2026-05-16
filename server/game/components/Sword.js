import { Box, Vec2, RevoluteJoint } from "planck";
import { length, normalize, mulScalar } from "../../utilities/vec2helpers.js";

export class Sword {
  constructor(player) {
    const defaultOpts = { radius: 0.5, swordLength: 3, density: 1, friction: 0.5, restitution: .95 };
    this.opts = defaultOpts;
    const playerBody = player.body;

    this.body = player.world.createBody({type: "dynamic", position: {x:this.opts.swordLength +.5, y:0}, userData: {owner: this}});

    this.body.createFixture({
      shape: Box(this.opts.swordLength / 2, 0.1),
      density: this.opts.density,
      friction: this.opts.friction,
      restitution: this.opts.restitution,
      userData: {id: this.body.getUserData().id, type: 'sword', scale: this.opts.radius*2}
    }); 


    player.world.createJoint(RevoluteJoint({
      bodyA: playerBody,
      bodyB: this.body,
      localAnchorA: Vec2(0,0),
      localAnchorB: Vec2(-.5-this.opts.swordLength / 2, 0),
      referenceAngle: this.body.getAngle() - playerBody.getAngle()
    }));

    this.body.getWorld().registerBody(this.body);
  }

  applyInputs(inputs) {
  }

  onDestroy() {
    this.body.getWorld().destroyBody(this.body);
  }
}