import { ImageManager } from "./ImageManager.js";
import { InputManager } from "./inputManager.js";

export class IngameWorld extends Phaser.Scene {
  constructor() {
    super({key: 'InWorldObjects', active: true});
    console.log('InWorldObjects initiated')
    this.pixelsPerMeter = 50;
  }

  preload() {
    const names = ['hoversphere', 'redbox','missing','box','circle', 'lockbox', 'boxHat', 'sword', 'blockLauncher', 'blockShotgun', 'blockUltraShotgun', 'blockUltraUltraShotgun'];
    names.forEach(name => this.load.image(name, `../assets/img/${name}.png`));
    this.images = new Map();
  }

  create() {
    this.input.mouse.disableContextMenu(); 
    this.inputManager = new InputManager(this);
    this.imageManager = new ImageManager(this);
  }

  applyState(state) {
    if (state.objects) this.imageManager.applyBodyStates(state.objects);
  }

  update() {
    this.applyState(this.game.currentState);
    this.imageManager.updatePlayerImagePos();
    this.centerCamera();
    this.inputManager.tick();
  }

  centerCamera() {
    this.cameras.main.centerOn(this.imageManager.playerImagePos.x, this.imageManager.playerImagePos.y);
  }
}