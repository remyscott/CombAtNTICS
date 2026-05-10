export class SpriteManager {
  constructor(scene) {
    this.scene = scene;
    console.log('SpriteManager initiated');
  }

  ensureSpritesForObjectStates(states) {
    for (const [id, state] of states) {
      if (!this.scene.sprites.has(id)) {
        let startPos = { x: 0 , y: 0 };
        const sprite = this.scene.add.sprite(startPos.x, startPos.y, 'player').setOrigin(0.5, 0.5);
        sprite.id = id;
        this.scene.sprites.set(id, sprite);
        console.info(`created sprite with id: ${id}`);
      }
    }

    const ids = states.map(([id]) => id);
    const idSet = new Set(ids);
    for (const [existingid, sprite] of Array.from(this.scene.sprites.entries())) {
      if (!(idSet.has(existingid))) {
        sprite.destroy();
        this.scene.sceneSprites.delete(existingid);
        console.info(`deleted sprite ${existingid}`);
      }
    }
  }

  getSprite(id) {
    return this.scene.sprites.get(id);
  }

  applyObjectStates(ObjectStates) {
    const ids = ObjectStates.map(([id]) => id);
    if (ids.length) this.ensureSpritesForObjectStates(ObjectStates);

    for (const  [id, state] of ObjectStates) {
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