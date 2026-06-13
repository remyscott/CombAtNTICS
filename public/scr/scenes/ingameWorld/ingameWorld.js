import { ImageManager } from "./ImageManager.js";
import { InputManager } from "./inputManager.js";
import objectTypes from '/shared/objectTypes.js';

export class IngameWorld extends Phaser.Scene {
  constructor() {
    super({key: 'InWorldObjects', active: true});
    console.log('InWorldObjects initiated')
    const ppmResolution = parseFloat(localStorage.getItem('ppmResolution'));
    this.pixelsPerMeter = Number.isFinite(ppmResolution) ? ppmResolution : objectTypes.pixelsPerMeter || 50;

    // NEW: running damage accumulator
    this.recentDamage = 0;
    this.recentDamageDecay = 0.995; 
  }

  preload() {
    const names = Object.keys(objectTypes.objects || {});
    names.forEach(name => {
      const imageFile = objectTypes.objects[name]?.imageFile || `${name}.png`;
      this.load.image(name, `/shared/assets/img/${imageFile}`);
    });
    this.images = new Map();
    this.load.image('arrowIcon', `/assets/img/arrowIcon.png`);

  }

  create() {
    this.input.mouse.disableContextMenu(); 
    this.inputManager = new InputManager(this);
    this.imageManager = new ImageManager(this);

    // Store vignette reference
    this.vignette = this.cameras.main.filters.external.addVignette(0.5, 0.5, 1, 0.3);

    this.game.events.on('damage', (id,amount) => {

      if (this.game.fixtures.get(id)?.bodyId === this.game.playerBodyId)
      this._playerDamageCameraEffect(amount);
    });
    

    this.game.events.on('playerBodyId', (id) => this.game.playerBodyId = id);
  }
  

  applyState(state) {
    if (state && state.objects) this.imageManager.applyBodyStateDeltas(state.objects);
  }

  update() {
    this.inputManager.tick();
    this._updateRecentDamageEffects();
    
  }

  centerCamera() {
    const playerBodyContainer = this.imageManager.renderBodies.get(this.game.playerBodyId)?.container;

    if (playerBodyContainer) {
      this.cameras.main.centerOn(playerBodyContainer.x, playerBodyContainer.y);
    }
  }

  // NEW: smooth vignette + background shake based on recentDamage
  _updateRecentDamageEffects() {
    if (!this.vignette) return;

    // decay
    this.recentDamage *= this.recentDamageDecay;

    const t = Phaser.Math.Clamp(this.recentDamage / 100, 0, 1);

    // Adjust vignette subtly
    this.vignette.strength = Math.min(0.3 + t * 0.7,1); // 0.3 → 0.7

  }

  _playerDamageCameraEffect(amount) {
    const cam = this.cameras?.main;
    if (!cam) return;

    // NEW: add to recentDamage pool
    this.recentDamage = Math.min(100, this.recentDamage + amount);

    const maxDamageForFullEffect = 100;
    const normalized = Phaser.Math.Clamp(amount / maxDamageForFullEffect, 0, 1);

    const intensity = normalized * 0.05; // final intensity
    const maxDuration = 600;
    const duration = Math.round(maxDuration * normalized);
    cam.shake(duration, intensity);

    cam.flash(Math.round(100 + normalized * 1000), 0, 0, 0, true);

  }
}
