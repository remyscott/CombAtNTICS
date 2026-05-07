console.log('You tryna cheat or smth? *smhing*');

import { Client } from './scr/client.js'
import { SceneAPI } from './scr/sceneAPI.js';
import { InputManager } from './scr/inputManager.js'
import { GameConsole } from './scr/gameConsole.js'
let sceneAPI = null;
let client = null;
let inputManager = null;




function preload() {
  this.load.image('player', 'player.png');
  this.sprites = new Map();
}

function create() {
  this.gameConsole = new GameConsole(this);

  client = new Client(this);
  sceneAPI = new SceneAPI(this); //this is the scene
  inputManager = new InputManager(this);

  
  

  inputManager.setUpInputs();

  
}

function update(delta, time) {
  sceneAPI.applyState(client.getCurrentState());
  
  
  const inputs = inputManager.tick(delta);
  if (inputs) {
    client.sendMessage({type: 'input', inputs})
  }
}

const phaserConfig = {
  type: Phaser.AUTO,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  },
  scene: { preload, create, update }
};

new Phaser.Game(phaserConfig);