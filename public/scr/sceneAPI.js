import {SpriteManager} from './spriteManager.js'
import {GameConsole} from './gameConsole.js'

export class SceneAPI {
  constructor(scene) {
    this.scene = scene;
    this.spriteManager = new SpriteManager(scene);
    this.gameConsole = new GameConsole(scene);
  }

  applyState(state) {
    if (state.players) this.spriteManager.applyPlayerStates(state.players);
  }
}


