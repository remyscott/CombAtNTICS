import { ImageManager } from "./ImageManager.js";
import { InputManager } from "./inputManager.js";

export class IngameWorld extends Phaser.Scene {
  constructor() {
    super({key: 'InWorldObjects', active: true});
    console.log('InWorldObjects initiated')
    this.pixelsPerMeter = 50;
  }

  preload() {
    const names = ['bullet','spark','sheild','dashCore','spider', 'spiderSensor','titaniumCore', 'swordBig','SawedOff', 'UltraMinigun', 'Smg', 'Heavy', 'Shinigun', 'THE_ULTRA_CANNON', 'Minigun','ball', 'hoversphere', 'redbox','missing','box','circle', 'lockbox', 'sword', 'Gun', 'Shotgun', 'UltraShotgun', 'UltraUltraShotgun', 'Cannon', 'Sniper'];
    names.forEach(name => this.load.image(name, `../assets/img/${name}.png`));
    this.images = new Map();
  }

  create() {
    this.input.mouse.disableContextMenu(); 
    this.inputManager = new InputManager(this);
    this.imageManager = new ImageManager(this);
  }

  applyState(state) {
    if (state && state.objects) this.imageManager.applyBodyStates(state.objects);
  }

  update() {
    this.applyState(this.game.currentState);
    this.imageManager.updateImageFocusPos();
    this.centerCamera();
    this.inputManager.tick();
  }

  centerCamera() {
    this.cameras.main.centerOn(this.imageManager.cameraFocusPos.x, this.imageManager.cameraFocusPos.y);
  }

  setCameraFocusId(id) {
    this.imageManager.setImageFocusId(id);
  }
}