import { ImageManager } from "./ImageManager.js";
import { InputManager } from "./inputManager.js";
import objectTypes from '/shared/objectTypes.js';

export class IngameWorld extends Phaser.Scene {
  constructor() {
    super({key: 'InWorldObjects', active: true});
    console.log('InWorldObjects initiated')
    const ppmResolution = parseFloat(localStorage.getItem('ppmResolution'));
    this.pixelsPerMeter = Number.isFinite(ppmResolution) ? ppmResolution : objectTypes.pixelsPerMeter || 50;
  
    this.environmentCompositeTexture = null;
    this.environmentCompositeImage = null;
    this.environmentSky = null;
    this.environmentTrees = null;
    this.environmentObjects = []; // extra objects to render in composite (e.g., particles)
    this.environmentCompositeSize = { w: 1280, h: 720 };
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
    this.cameras.main.filters.external.addVignette(0.5, 0.5, 0.7);

    this.game.events.on('event', (ev) => 
      {
        switch (ev.type) {
          case 'damage':
            if (ev.id === this.game.playerBodyId) {
              this._playerDamageCameraEffect(ev.amount);
            }
            this.imageManager.handleDamageEvent(ev);
            break;
          case 'playerBodyId':
            this.game.playerBodyId = ev.id;
            break;
          default:
            break;
        }
      }
    );
  }
  

  applyState(state) {
    if (state && state.objects) this.imageManager.applyBodyStates(state.objects);
  }

  update() {
    this.applyState(this.game.currentState);
    
    this.centerCamera();
    this.inputManager.tick();
  }

  centerCamera() {
    const playerBodyId = this.game.playerBodyId;
    const bodyMeta = playerBodyId && this.game.metadata?.bodies?.[playerBodyId];
    const playerImageId = bodyMeta?.fixtures?.[0]?.image?.id;

    const playerImage = this.images.get(playerImageId);
    if (playerImage) {
      this.cameras.main.centerOn(playerImage.x, playerImage.y);
    }
  }

  setCameraFocusId(id) {
    this.imageManager.setImageFocusId(id);
  }

  _playerDamageCameraEffect(amount) {
    const cam = this.cameras?.main;
    if (!cam) return;

    const maxDamageForFullEffect = 100;         // damage that gives full intensity
    const normalized = Phaser.Math.Clamp(amount / maxDamageForFullEffect, 0, 1);

    
    const intensity = normalized * 0.05; // final intensity
    const maxDuration = 600;
    const duration = Math.round(maxDuration * normalized);
    cam.shake(duration, intensity);

    const flashAlpha = normalized;  // not a direct API param, but choose color + duration
    cam.flash(Math.round(normalized * 300), 255, 200, 200); // short colored flash
  }
}