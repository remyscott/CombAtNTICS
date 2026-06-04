import { Box } from 'planck'
import { Component } from './Component.js';

export class TitaniumCore extends Component {
  constructor(player, opts = {}) {
    super(player, opts);
    const defaults = {
      halfSize: { value: 0.1, scaleOrder: 1 },
      density: 80,
    };
    this.opts = this.normalizeOpts(defaults, opts);

    this.player.body.createFixture({
      shape: Box(this.opts.halfSize, this.opts.halfSize),
      density: this.opts.density,
      userData: { depth: 100000, id: this.player.game.world.newId(), type: 'titaniumCore', scale: this.opts.scaleFactor },
    });

    this.player.game.world.registerBody(this.player.body);
  }
}
