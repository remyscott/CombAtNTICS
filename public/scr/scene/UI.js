import { GameConsole } from "./gameConsole.js";

export class UI extends Phaser.Scene {
  constructor() {
    super({key: 'UI', active: true});
    console.log('UI initiated')
  }

  preload() {
  }

  create() {
    console.log('UI create')

    this.console = new GameConsole(this);  
  }

  update() {
  }
}