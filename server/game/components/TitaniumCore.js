import { Box } from 'planck'

export class TitaniumCore {
  constructor(player, opts = {}) {
    this.player = player;
    this.opts = Object.assign({
      density: 10
    }, opts);

    this.player.body.createFixture({
      shape: Box(0.25, 0.25),
      density: this.opts.density,
      userData: {depth: 100000, id: this.player.game.world.newFxId(), type: 'titaniumCore', scale: 1 },
    });

    this.player.game.world.registerBody(this.player.body);
  }
}