import {SpriteManager} from './spriteManager.js'

export class SceneAPI {
  constructor(scene) {
    this.scene = scene;
    this.spriteManager = new SpriteManager(scene);
    console.log('SceneAPI initiated')
  }

  applyState(state) {
    if (state.players) this.spriteManager.applyPlayerStates(state.players);
  }
}


