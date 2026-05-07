console.log('You tryna cheat or smth? *smhing*');

import {Client} from './client.js'
import { SceneAPI } from './sceneAPI.js';

let sceneAPI = null;
let client = null;







function preload() {
  this.load.image('player', 'player.png');
  this.sprites = new Map();
}





function create() {
  client = new Client();
  sceneAPI = new SceneAPI(this); //this is the scene


  client.ws.addEventListener('open', () => {
    sceneAPI.gameConsole.log('WebSocket opened');
    sceneAPI.gameConsole.log('Calibrating buffer ...');

    // when you start calibration, you can show status messages via sceneAPI
    const calibPromise = client.startTimeSyncAI(
      { count: 50, interval: 1, timeout: 500 },
      (prog) => {
        if (prog && typeof prog.index === 'number') {
          sceneAPI.gameConsole.log(`Calib ${prog.index + 1}/${prog.count}: ${prog.ok ? prog.rtt + 'ms' : 'timeout'}`, { level: 'info' });
        }
      }
    );
    
    // log the final result when it completes
    calibPromise.then(stats => {
      let ext = '';
      if (stats.networkBuffer === 50) ext = ' (This is the minimum buffer)';
      sceneAPI.gameConsole.log(`Calibrated: buffer ${stats.networkBuffer}ms${ext}`, { level: 'info' });
      
    }).catch(err => {
      console.warn('calibration failed', err);
      sceneAPI.gameConsole.error('Calibration failed — using defaults');
    });

  });

  this.input.on('pointermove', (pointer) => {
    client.ws.send(JSON.stringify({type : 'mousePos', pos: {x: pointer.worldX, y: pointer.worldY}}));
  });
}

function update() {
  sceneAPI.applyState(client.getCurrentState());
}

const phaserConfig = {
  type: Phaser.AUTO,
  width: '800',
  height: '600',
  scene: { preload, create, update }
};

new Phaser.Game(phaserConfig);