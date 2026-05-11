export class InputGetter{
  constructor(scene) {
    this.scene = scene;
    this.inputs = {mousePos: {x:0, y:0}, buildAFuckingBoxIWantToTest: false};
    this.scene.game.inputs = this.inputs;
    console.log('InputGetter initiated')
    this.setUpInputs();
  }

  setUpInputs() {
    this.scene.input.on('pointermove', (pointer) => {
      this.inputs.mousePos.x = pointer.x / this.scene.metersToPixel;
      this.inputs.mousePos.y = pointer.y / this.scene.metersToPixel;
    });
    this.scene.input.on('pointerdown', (pointer) => {
      this.inputs.buildAFuckingBoxIWantToTest = true;
    });
    console.log('Inputs Setup')

  }
}