import { Client } from "./client.js";
import { InWorldObjects } from "./scene/InWorldObjects.js"
import { UI } from "./scene/UI.js"

const config = {
  type: Phaser.AUTO,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  },
  scene: [ InWorldObjects, UI ]
};

let phaserGame = new Phaser.Game(config);
let client = new Client(phaserGame);