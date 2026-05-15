export class ImageManager {
  constructor(scene) {
    this.scene = scene;
    console.log('ImageManager initiated');
  }

  ensureImagesForObjectStates(states) {
    const idSet = new Set();
    for (const { id } of states) {
      idSet.add(id);
      if (!this.scene.images.has(id)) {
        if (!this.scene.game.metadata[id]) {
          this.scene.game.client.requestMetadata();
          continue;
        }

        let i = 0;
        for (const fixture of this.scene.game.metadata[id].fixtures) {
          const image = this.scene.add.image(0, 0, fixture.type || 'missing').setOrigin(0.5, 0.5).setScale(fixture.scale || 1);
          image.id = Number(String(i) + String(id));
          this.scene.images.set(id, image);
          i++;
        }
      }
    }

    for (const [existingId, image] of this.scene.images.entries()) {
      if (!idSet.has(existingId)) {
        image.destroy();
        this.scene.images.delete(existingId);
      }
    }
  }

  getImage(id) {
    return this.scene.images.get(id);
  }

  applyObjectStates(objectStates) {
    this.ensureImagesForObjectStates(objectStates);

    for (const {id, state} of objectStates) {
      const image = this.getImage(id);
      if (!image) continue;
  
      if (state && state.pos && typeof state.pos.x === 'number' && typeof state.pos.y === 'number') {
        image.x = state.pos.x * this.scene.metersToPixel;
        image.y = state.pos.y * this.scene.metersToPixel;
        image.setRotation(state.angle)
      }
    }
  }
  
}