import { InputGetter } from "./inputGetter.js";
import { ImageManager } from "./ImageManager.js";

export class InWorldObjects extends Phaser.Scene {
  constructor() {
    super({key: 'InWorldObjects', active: true});
    console.log('InWorldObjects initiated')
    this.metersToPixel = 50;
  }

  preload() {
    this.load.image('player', '../assets/img/player.png');
    this.load.image('missing', '../assets/img/missing.png');
    this.load.image('box', '../assets/img/box.png');
    this.load.image('circle', '../assets/img/circle.png');
    this.images = new Map();
  }

  create() {
    this.inputGettter = new InputGetter(this);
    this.imageManager = new ImageManager(this);
    
  }

  applyState(state) {
    if (state.objects) this.imageManager.applyObjectStates(state.objects);
  }

  update() {
    this.applyState(this.game.currentState);
    this.cameras.main.centerOn(this.imageManager.getImage(this.game.playerBodyId)?.x|| 0, this.imageManager.getImage(this.game.playerBodyId)?.y || 0);
    this.inputGettter.tick();
  }
}