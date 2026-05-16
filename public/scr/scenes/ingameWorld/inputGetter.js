export class InputGetter{
  constructor(scene) {
    this.scene = scene;
    this.inputs = {mousePos: {x:0, y:0}, click: false};
    this.scene.game.inputs = this.inputs;
    console.log('InputGetter initiated');
    this.setUpInputs();
  }

  setUpInputs() {
    this.scene.input.on('pointerdown', (pointer) => {
      this.inputs.click = true;
      this.scene.centerCamera();
    });
    console.log('Inputs Setup')
  }
  tick() {
    this.inputs.mousePos.x = this.scene.input.activePointer.worldX / this.scene.metersToPixel;
    this.inputs.mousePos.y = this.scene.input.activePointer.worldY / this.scene.metersToPixel;
  }
}