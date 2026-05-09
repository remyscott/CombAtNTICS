console.log('You tryna cheat or smth? *smhing*');

import { attachRuntimeLogger } from './scr/attachRuntimeLogger.js'
import { Client } from './scr/client.js'
import { SceneAPI } from './scr/sceneAPI.js';
import { InputManager } from './scr/inputGetter.js'
import { GameConsole } from './scr/gameConsole.js'
let sceneAPI = null;
let client = null;
let inputManager = null;




function preload() {
  this.load.image('player', 'player.png');
  this.sprites = new Map();
}

function create() {
  this.playerName = null;
  this.gameConsole = new GameConsole(this);

  this._detachRuntimeLogger = attachRuntimeLogger(this.gameConsole, {
    forwardConsole: true,        // intercept console.* and forward
    captureErrors: true,         // window.onerror
    captureRejections: true      // unhandledrejection
  });
  
  this.sys.events.on('shutdown', () => {
    if (this._detachRuntimeLogger) this._detachRuntimeLogger();
  });

  sceneAPI = new SceneAPI(this); //this is the scene
  inputManager = new InputManager(this);
  inputManager.setUpInputs();

  client = new Client(this);


  
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