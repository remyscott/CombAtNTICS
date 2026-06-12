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
  backgroundColor: '#876672', 

};

class CustomGame extends Phaser.Game {
  constructor(config) {
    super(config);
    this.bodies = new Map();
    this.fixtures = new Map();
    this.metadata = {bodies: {}, fixtures:{}};
    this.client = null;
  }

  setClient(client) {
    this.client = client;
  }

  handleEvent(ev) {
    switch (ev.type) {
      case 'playerBodyId':
        console.log('hey')
        this.playerBodyId = ev.id;
        break;
    }
  }
}

const client = new Client();
const phaserGame = new CustomGame(config);
client.setGame(phaserGame);
phaserGame.setClient(client);

window.__GAME = phaserGame;
window.__CLIENT = client;