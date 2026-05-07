export class InputManager{
  constructor(scene, inputInterval) {
    this.scene = scene;
    this.inputs = {mousePos: {x:0, y:0}}
    this.timeSinceInputsSent = 0;
    this.inputInterval = inputInterval || 1000/60;
  }

  setUpInputs() {
    this.scene.input.on('pointermove', (pointer) => {
      this.inputs.mousePos.x = pointer.x;
      this.inputs.mousePos.y = pointer.y;
    });
  }

  tick(delta) {
    this.timeSinceInputsSent += delta;

    if (this.timeSinceInputsSent >= this.inputInterval) {
      this.timeSinceInputsSent -= this.inputInterval;
      return this.inputs;
    }

    return null;
  }
}