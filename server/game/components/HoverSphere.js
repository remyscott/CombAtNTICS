import { Circle, Vec2 } from "planck";
import { length, normalize, mulScalar } from "../../utilities/vec2helpers.js";

export class HoverSphere {
  constructor(player) {
    const defaultOpts = { radius: 0.5, force: 20, density: 1, friction: 0.5, restitution: 0.5 };
    this.opts = defaultOpts;

    this.body = player.world.createBody({
      type: "dynamic",
      position: {x:1, y:1},
      userData: {id: player.world.newBodyId(), owner: player, type: 'hoversphere', scale: this.opts.radius*2}
    });

    this.body.createFixture({
      shape: new Circle(new Vec2(0, 0), this.opts.radius),
      density: this.opts.density,
      friction: this.opts.friction,
      restitution: this.opts.restitution,
    });


    player.body = this.body;
  }

  applyInputs(inputs) {
    if (!inputs.mousePos || !this.body) return;
    const mousePos = inputs.mousePos;
    const pos = this.body.getPosition();
    let d = Vec2(mousePos.x - pos.x, mousePos.y - pos.y);
    
    let multiplier = 0.1/length(d);
    
    this.body.applyForce(mulScalar(normalize(d), this.opts.force), this.body.getWorldPoint(Vec2(0,0)));
    
    this.body.setLinearVelocity(mulScalar(this.body.getLinearVelocity(),Math.max(0,1-multiplier)));
  }

  onDestroy() {
    this.body.getWorld().destroyBody(this.body);
  }
}