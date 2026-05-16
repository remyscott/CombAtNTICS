export class ImageManager {
  constructor(scene) {
    this.scene = scene;
    console.log('ImageManager initiated');
  }

  ensureImagesForObjectStates(states) {
    const idSet = new Set();
    for (const { id } of states) {
      if (!this.scene.game.metadata[id]) {
        this.scene.game.client.requestMetadata();
        console.log('Metadata missing for ID:', id, 'requested update from server');
        continue;
      }
      
      for (const fixture of this.scene.game.metadata[id]?.fixtures || []) {
        idSet.add(fixture.id);
        if (!this.scene.images.has(fixture.id)) {
          

          const image = this.scene.add.image(0, 0, fixture.type || 'missing').setOrigin(0.5, 0.5).setScale(fixture.scale || 1);
          image.id = fixture.id;
          this.scene.images.set(image.id, image);
          idSet.add(image.id);

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
      if (state && state.pos && typeof state.pos.x === 'number' && typeof state.pos.y === 'number') {

        for (const fixture of this.scene.game.metadata[id]?.fixtures || []) {
          const image = this.scene.images.get(fixture.id);
          if (!image) continue;

          image.x = state.pos.x * this.scene.metersToPixel;
          image.y = state.pos.y * this.scene.metersToPixel;
          image.setRotation(state.angle)
        }

      }
    }
  }
}