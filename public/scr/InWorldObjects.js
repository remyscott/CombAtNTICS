import { InputGetter } from "./inputGetter.js";
import { SpriteManager } from "./spriteManager.js";

export class InWorldObjects extends Phaser.Scene {
  constructor() {
    super({key: 'InWorldObjects', active: true});
    console.log('InWorldObjects initiated')
  }

  preload() {
    this.load.image('player', '../assets/img/player.png');
    this.sprites = new Map();
  }

  create() {
    this.inputGettter = new InputGetter(this);
    this.spriteManager = new SpriteManager(this);
  }

  applyState(state) {
    if (state.players) this.spriteManager.applyPlayerStates(state.players);
  }

  update() {
    this.applyState(this.game.currentState);
  }
}