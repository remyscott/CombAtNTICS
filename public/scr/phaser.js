console.log('You tryna cheat or smth? *smhing*');

import {Client} from './client.js'

let SceneAPI = null;
let client = null;

const phaserConfig = {
  type: Phaser.AUTO,
  width: '800',
  height: '600',
  scene: { preload, create, update }
};






function preload() {
  this.load.image('player', 'player.png');
  this.sceneSprites = new Map();
}





function create() {
  const scene = this;

  SceneAPI = {
    ensurePlayerSprites(names) {
      for (const name of names) {
        if (!scene.sceneSprites.has(name)) {
          const history = client.playerStatesByServerTime.get(name);
          let startPos = { x: phaserConfig.width / 2, y: phaserConfig.height / 2 };
          if (history && history.length) {
            const latest = history[history.length - 1].state;
            if (latest && latest.pos && typeof latest.pos.x === 'number' && typeof latest.pos.y === 'number') {
              startPos = { x: latest.pos.x, y: latest.pos.y };
            }
          }

          const sprite = scene.add.sprite(startPos.x, startPos.y, 'player').setOrigin(0.5, 0.5);
          sprite.name = name;
          scene.sceneSprites.set(name, sprite);
        }
      }

      const nameSet = new Set(names);
      for (const [existingName, sprite] of Array.from(scene.sceneSprites.entries())) {
        if (!nameSet.has(existingName)) {
          sprite.destroy();
          scene.sceneSprites.delete(existingName);
        }
      }
    },

    getSprite(name) {
      return scene.sceneSprites.get(name);
    }
  };

  client = new Client();

  this.calibContainer = this.add.container(0, 0);


  const w = phaserConfig.width, h = phaserConfig.height;
  const bg = this.add.rectangle(w/2, h/2, w, h, 0x000000, 0.5);
  const title = this.add.text(w/2, h/2 - 60, 'Calibrating network...', { fontSize: '24px', color: '#ffffff' }).setOrigin(0.5);
  const progressText = this.add.text(w/2, h/2, '0 / 0 pings', { fontSize: '18px', color: '#ffffff' }).setOrigin(0.5);
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
      { count: 20, interval: 1, timeout: 500 },
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

function update(time, delta) {

  const currentStates = client.getCurrentPlayerStates();

  const names = currentStates.map(([name]) => name);
  if (names.length) SceneAPI.ensurePlayerSprites(names);

  for (const [name, state] of currentStates) {
    const sprite = SceneAPI.getSprite(name);
    if (!sprite) continue;

    if (state && state.pos && typeof state.pos.x === 'number' && typeof state.pos.y === 'number') {
      sprite.x = state.pos.x;
      sprite.y = state.pos.y;
    }
  }

}

new Phaser.Game(phaserConfig);