export class SpriteManager {
  constructor(scene) {
    this.scene = scene;
    console.log('SpriteManager initiated');
  }

  ensureSpritesForObjectStates(states) {
    const idSet = new Set();
    for (const { id } of states) {
      idSet.add(id);
      if (!this.scene.sprites.has(id)) {
        const startPos = { x: 0, y: 0 };
        const sprite = this.scene.add.sprite(startPos.x, startPos.y, this.scene.game.currentMetadata.objects[id]?.type || 'missing').setOrigin(0.5, 0.5);
        sprite.id = id;
        this.scene.sprites.set(id, sprite);
        //console.log(`created sprite with id: ${id}`);
      }
    }

    for (const [existingId, sprite] of this.scene.sprites.entries()) {
      if (!idSet.has(existingId)) {
        sprite.destroy();
        this.scene.sprites.delete(existingId);
        if (this.scene.sceneSprites) {
          this.scene.sceneSprites.delete(existingId);
        }
        //console.log(`deleted sprite ${existingId}`);
      }
    }
  }

  getSprite(id) {
    return this.scene.sprites.get(id);
  }

  applyObjectStates(objectStates) {
    this.ensureSpritesForObjectStates(objectStates);

    for (const {id, state} of objectStates) {
      const sprite = this.getSprite(id);
      if (!sprite) continue;
  
      if (state && state.pos && typeof state.pos.x === 'number' && typeof state.pos.y === 'number') {
        sprite.x = state.pos.x * this.scene.metersToPixel;
        sprite.y = state.pos.y * this.scene.metersToPixel;
        sprite.setRotation(state.angle)
      }
    }
  }
  
}