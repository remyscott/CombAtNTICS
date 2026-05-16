import { InputGetter } from "./inputGetter.js";
import { ImageManager } from "./ImageManager.js";

export class IngameWorld extends Phaser.Scene {
  constructor() {
    super({key: 'InWorldObjects', active: true});
    console.log('InWorldObjects initiated')
    this.metersToPixel = 50;
  }

  preload() {
    const names = ['hoversphere','missing','box','circle', 'lockbox', 'boxHat', 'sword'];
    names.forEach(name => this.load.image(name, `../assets/img/${name}.png`));
    this.images = new Map();
  }

  create() {
    this.inputGettter = new InputGetter(this);
    this.imageManager = new ImageManager(this);
    this.lastCameraCenteredTime = 0;
  }

  applyState(state) {
    if (state.objects) this.imageManager.applyObjectStates(state.objects);
  }

  update() {
    this.applyState(this.game.currentState);
    if (Date.now() - this.lastCameraCenteredTime > 100000) {
      this.lastCameraCenteredTime = Date.now();
      this.centerCamera();
    }
    this.inputGettter.tick();
  }

  centerCamera() {
    this.cameras.main.centerOn(this.imageManager.getImage(this.game.playerBodyId)?.x|| 0, this.imageManager.getImage(this.game.playerBodyId)?.y || 0);
  }
}