export class InputGetter{
  constructor(scene) {
    this.scene = scene;
    this.inputs = {mousePos: {x:0, y:0}}
    this.scene.game.inputs = this.inputs;
    console.log('InputGetter initiated')
    this.setUpInputs();
  }

  setUpInputs() {
    this.scene.input.on('pointermove', (pointer) => {
      this.inputs.mousePos.x = pointer.x;
      this.inputs.mousePos.y = pointer.y;
    });
    console.log('Inputs Setup')

  }
}