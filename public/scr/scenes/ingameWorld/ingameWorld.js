import { ImageManager } from "./ImageManager.js";
import { InputManager } from "./inputManager.js";
import objectTypes from '/shared/objectTypes.js';

export class IngameWorld extends Phaser.Scene {
  constructor() {
    super({key: 'InWorldObjects', active: true});
    console.log('InWorldObjects initiated')
    const ppmResolution = parseFloat(localStorage.getItem('ppmResolution'));
    this.pixelsPerMeter = Number.isFinite(ppmResolution) ? ppmResolution : objectTypes.pixelsPerMeter || 50;
  }

  preload() {
    const names = Object.keys(objectTypes.objects || {});
    names.forEach(name => {
      const imageFile = objectTypes.objects[name]?.imageFile || `${name}.png`;
      this.load.image(name, `/shared/assets/img/${imageFile}`);
    });
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