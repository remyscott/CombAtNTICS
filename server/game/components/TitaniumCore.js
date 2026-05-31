import { Box } from 'planck'

export class TitaniumCore {
  constructor(player, opts = {}) {
    const sf = player.sf || 1;
    this.player = player;
    this.opts = Object.assign({
      density: 80,
    }, opts);

    this.player.body.createFixture({
      shape: Box(0.1*sf, 0.1*sf),
      density: this.opts.density,
      userData: {depth: 100000, id: this.player.game.world.newId(), type: 'titaniumCore', scale: sf },
    });

    this.player.game.world.registerBody(this.player.body);
  }
}