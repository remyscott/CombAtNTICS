// InputManager.js
import { configurableInputs } from '/shared/inputslisting.js';
import { loadBindings } from '../../bindingsManager.js';
import { PhaserInputAdapter } from './phaserInputAdapter.js';

export class InputManager {
  constructor(scene) {
    this.scene = scene;

    let maxIndex = -1;
    for (const idx of Object.values(configurableInputs)) {
      const n = Number(idx);
      if (Number.isFinite(n) && n > maxIndex) maxIndex = n;
    }
    this.size = maxIndex + 1;

    this.inputs = new Uint8Array(this.size);

    this.scene.game.inputs = this.inputs;

    const bindings = loadBindings();
    this.inputAdapter = new PhaserInputAdapter(this.scene, bindings);

    this.scene.game.mousePos = { x: 0, y: 0 };  
    this.scene.game.mousePosRel = { x: 0, y: 0 };   

    this.scene.input.on('pointermove', p => {
      const ppm = this.scene.pixelsPerMeter || 50;

      this.scene.game.mousePos.x = p.worldX / ppm;
      this.scene.game.mousePos.y = p.worldY / ppm;

      const playerScreenPos = this.scene.game.bodies.get(this.scene.game.playerBodyId)?.container;
      this.scene.game.mousePosRel.x = p.worldX - (playerScreenPos?.x || 0);
      this.scene.game.mousePosRel.y = p.worldY - (playerScreenPos?.y || 0);
    });
 
    console.log('InputManager initiated (typed array size =', this.size, ')');
  }

  // Call from scene.update()
  tick() {
    if (!this.inputAdapter) return;

    // For each action name -> numeric index: write 1 or 0
    for (const [action, idx] of Object.entries(configurableInputs)) {
      const i = Number(idx);
      if (!Number.isFinite(i) || i < 0 || i >= this.size) continue;
      this.inputs[i] = this.inputAdapter.isActionDown(action) ? 1 : 0;
    }
  }

  // Clean up listeners
  destroy() {
    if (this.inputAdapter) {
      this.inputAdapter.destroy();
      this.inputAdapter = null;
    }
  }
}