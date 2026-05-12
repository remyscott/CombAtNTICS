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
        const startPos = { x: 0, y: 0 };
        const image = this.scene.add.image(startPos.x, startPos.y, this.scene.game.currentMetadata.objects[id]?.type || 'missing').setOrigin(0.5, 0.5).setScale(this.scene.game.currentMetadata.objects[id]?.scale || 1);
        image.id = id;
        this.scene.images.set(id, image);
        //console.log(`created image with id: ${id}`);
      }
    }

    for (const [existingId, image] of this.scene.images.entries()) {
      if (!idSet.has(existingId)) {
        image.destroy();
        this.scene.images.delete(existingId);

        //console.log(`deleted image ${existingId}`);
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