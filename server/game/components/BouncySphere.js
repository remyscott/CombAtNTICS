import { Circle, Vec2 } from "planck";
import { length, normalize, mulScalar } from "../../utilities/vec2helpers.js";

export class BouncySphere {
  constructor(player) {
    const defaultOpts = { radius: 0.5, force: 20, density: 1, friction: 0.8, restitution: 0.95 };
    this.opts = defaultOpts;

    this.body = player.world.createBody({
      type: "dynamic",
      position: {x:0, y:0},
      userData: {owner: player}
    });

    this.body.createFixture({
      shape: new Circle(new Vec2(0, 0), this.opts.radius),
      density: this.opts.density,
      friction: this.opts.friction,
      restitution: this.opts.restitution,
      userData: {id: this.body.getUserData().id, type: 'hoversphere', scale: this.opts.radius*2}
    }); 

    this.body.getWorld().registerBody(this.body);
    player.body = this.body;
  }

  applyInputs(inputs) {
  }

  onDestroy() {
    this.body.getWorld().destroyBody(this.body);
  }
}