console.log('You tryna cheat or smth? *smhing*');

import {Client} from './client.js'
import { SceneAPI } from './sceneAPI.js';

let sceneAPI = null;
let client = null;

const phaserConfig = {
  type: Phaser.AUTO,
  width: '800',
  height: '600',
  scene: { preload, create, update }
};






function preload() {
  this.load.image('player', 'player.png');
  this.sprites = new Map();
}





function create() {
  client = new Client();
  sceneAPI = new SceneAPI(this); //this is the scene

  this.calibContainer = this.add.container(0, 0);


  const w = phaserConfig.width, h = phaserConfig.height;
  const bg = this.add.rectangle(w/2, h/2, w, h, 0x000000, 0.5);
  const title = this.add.text(w/2, h/2 - 60, 'Calibrating network...', { fontSize: '24px', color: '#ffffff' }).setOrigin(0.5);
  const progressText = this.add.text(w/2, h/2, '-1 / 0 pings', { fontSize: '18px', color: '#ffffff' }).setOrigin(0.5);
  const detailText = this.add.text(w/2, h/2 + 40, '', { fontSize: '14px', color: '#cccccc' }).setOrigin(0.5);
  const spinner = this.add.text(w/2, h/2 + 80, '⏳', { fontSize: '32px', color: '#ffffff' }).setOrigin(0.5);

  this.calibContainer.add([bg, title, progressText, detailText, spinner]);


  // keep refs for update
  this.calib = { container: this.calibContainer, progressText, detailText, spinner };


  // show UI
  this.calib.container.setVisible(true);


  client.ws.addEventListener('open', () => {
    // start calibration and update UI for each ping
    const calibPromise = client.startTimeSyncAI(
      { count: 50, interval: 1, timeout: 500 },
      (prog) => {
        const index = (prog && typeof prog.index === 'number') ? prog.index : -1;
        const total = (prog && typeof prog.count === 'number') ? prog.count : 6;
        const completed = index >= 0 ? Math.min(index + 1, total) : 0;
        this.calib.progressText.setText(`${completed} / ${total} pings`);
        this.calib.detailText.setText(prog && prog.ok ? `last RTT: ${prog.rtt} ms` : 'last RTT: timeout');
      }
    );

    // keep reference to tween so we can stop it
    this.calib.spinnerTween = this.tweens.add({
      targets: this.calib.spinner,
      angle: 360,
      duration: 800,
      repeat: -1,
      ease: 'Linear'
    });

    // hide UI and cleanup when calibration completes or fails
    calibPromise.then(stats => {
      if (this.calib.spinnerTween) {
        this.calib.spinnerTween.stop();
        this.calib.spinnerTween.remove();
        this.calib.spinnerTween = null;
      }
      this.calib.container.setVisible(false);

      let ext = ''
      if (stats.networkBuffer === 50) {
        ext = ' (This is the minimum buffer)'
      }
      const summary = this.add.text(phaserConfig.width/2, phaserConfig.height/2,
        `Calibrated: buffer ${stats.networkBuffer}ms` + ext, { fontSize: '18px', color: '#00ff00' }).setOrigin(0.5);
      this.time.delayedCall(2500, () => summary.destroy());
    }).catch(err => {
      console.warn('calibration failed', err);
      if (this.calib.spinnerTween) {
        this.calib.spinnerTween.stop();
        this.calib.spinnerTween.remove();
        this.calib.spinnerTween = null;
      }
      this.calib.detailText.setText('Calibration failed — using defaults');
      // hide after a short delay
      this.time.delayedCall(2500, () => this.calib.container.setVisible(false));
    });
  });

  this.input.on('pointermove', (pointer) => {
    client.ws.send(JSON.stringify({type : 'mousePos', pos: {x: pointer.worldX, y: pointer.worldY}}));
  });
}

function update() {
  sceneAPI.applyState(client.getCurrentState());
}

new Phaser.Game(phaserConfig);