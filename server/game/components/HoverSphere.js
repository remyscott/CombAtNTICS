import { Circle, Vec2 } from "planck";
import { length, normalize, mulScalar } from "../../utilities/vec2helpers.js";
import { configurableInputs } from "../../../shared/inputsListing.js";

// Efficient import: destructure numeric indices from the canonical mapping.
// This is a plain object lookup at module-evaluate time (cheap) and gives you
// fast numeric variables to use in your hot loop.
const { UP, DOWN, LEFT, RIGHT } = configurableInputs;

export class HoverSphere {
  constructor(player) {
    const defaultOpts = { radius: 0.5, force: 20, density: 1, friction: 0.5, restitution: 0.5 };
    this.opts = defaultOpts;
    this.body = player.body;
    

    this.body.setGravityScale(0);
    this.body.setLinearDamping(0.01);
    
    this.body.createFixture({
      shape: new Circle(new Vec2(0, 0), this.opts.radius),
      density: this.opts.density,
      friction: this.opts.friction,
      restitution: this.opts.restitution,
      userData: { id: this.body.getUserData().id, type: 'hoversphere', scale: this.opts.radius * 2, name: player.name }
    });

    this.body.getWorld().registerBody(this.body);
    player.body = this.body;

    // small reusable temporaries to avoid allocations
    this._tmpDir = Vec2(0, 0);
    this._tmpForce = Vec2(0, 0);
  }

  applyInputs(inputs) {
    // Expect inputs to be a typed array (Uint8Array) indexed by numeric IDs
    if (!inputs || !this.body) return;

    // Reset direction
    this._tmpDir.x = 0;
    this._tmpDir.y = 0;

    // Note: inputs[UP] etc. are 0/1 (Uint8Array)
    if (inputs.actions[UP]) this._tmpDir.y -= 1;
    if (inputs.actions[DOWN]) this._tmpDir.y += 1;
    if (inputs.actions[LEFT]) this._tmpDir.x -= 1;
    if (inputs.actions[RIGHT]) this._tmpDir.x += 1;

    const mag = length(this._tmpDir);
    if (mag > 1e-6) {
      const dirNorm = normalize(this._tmpDir); 
      this._tmpForce.x = dirNorm.x * this.opts.force;
      this._tmpForce.y = dirNorm.y * this.opts.force;

      this.body.applyForce(this._tmpForce, this.body.getWorldPoint(Vec2(0, 0)));
    }
  }

  onDestroy() {
    this.body.getWorld().destroyBody(this.body);
  }
}