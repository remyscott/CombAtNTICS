import { Client } from "./client.js";
import { IngameWorld } from "./scenes/ingameWorld/ingameWorld.js"
import { UI } from "./scenes/UI/UI.js"

const config = {
  type: Phaser.AUTO,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight
  },
  scene: [ IngameWorld, UI ]
};

let phaserGame = new Phaser.Game(config);
let client = new Client(phaserGame);