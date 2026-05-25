import { Client } from './client.js';
import { IngameWorld } from './scenes/ingameWorld/ingameWorld.js';
import { UI } from './scenes/UI/UI.js';

const config = {
  type: Phaser.AUTO,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  },
  scene: [ IngameWorld, UI ],
};

const phaserGame = new Phaser.Game(config);
const client = new Client(phaserGame);

window.__GAME = phaserGame;
window.__CLIENT = client;