export class SpriteManager {
  constructor(scene) {
    this.scene = scene;
  }

  ensureCorrectPlayerSpritesForState(names) {
    for (const name of names) {
      if (!this.scene.sprites.has(name)) {
        let startPos = { x: 0 , y: 0 };
        const sprite = this.scene.add.sprite(startPos.x, startPos.y, 'player').setOrigin(0.5, 0.5);
        sprite.name = name;
        this.scene.sprites.set(name, sprite);
      }
    }

    const nameSet = new Set(names);
    for (const [existingName, sprite] of Array.from(this.scene.sprites.entries())) {
      if (!nameSet.has(existingName)) {
        sprite.destroy();
        this.scene.sceneSprites.delete(existingName);
      }
    }
  }

  getSprite(name) {
    return this.scene.sprites.get(name);
  }

  applyPlayerStates(currentPlayerStates) {
    const names = currentPlayerStates.map(([name]) => name);
    if (names.length) this.ensureCorrectPlayerSpritesForState(names);

    for (const [name, state] of currentPlayerStates) {
      const sprite = this.getSprite(name);
      if (!sprite) continue;
  
      if (state && state.pos && typeof state.pos.x === 'number' && typeof state.pos.y === 'number') {
        sprite.x = state.pos.x;
        sprite.y = state.pos.y;
      }
    }
  }
  
}