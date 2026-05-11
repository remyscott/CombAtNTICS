export class InputGetter{
  constructor(scene) {
    this.scene = scene;
    this.inputs = {mousePos: {x:0, y:0}, buildAFuckingBoxIWantToTest: false};
    this.scene.game.inputs = this.inputs;
    console.log('InputGetter initiated');
    this.setUpInputs();
  }

  setUpInputs() {
    this.scene.input.on('pointerdown', (pointer) => {
      this.inputs.buildAFuckingBoxIWantToTest = true;
    });
    console.log('Inputs Setup')
    console.info('Click to create more boxes!')
  }
  tick() {
    this.inputs.mousePos.x = this.scene.input.activePointer.worldX / this.scene.metersToPixel;
    this.inputs.mousePos.y = this.scene.input.activePointer.worldY / this.scene.metersToPixel;
  }
}