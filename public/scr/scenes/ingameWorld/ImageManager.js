import { getObjectPixelsPerMeter } from '/shared/objectTypes.js';

const uiScale = Number(localStorage.getItem('uiScale') || '1');
if (!localStorage.getItem('uiScale')) {
  localStorage.setItem('uiScale', '1');
}

export class ImageManager {
  constructor(scene) {
    this.scene = scene;
    this.bodies = new Map();
    this.scene.game.bodies = this.bodies;
    this.requestedMetadata = false;

    this.scene.game.events.on('destroyBody', (bodyId) => this.destroyBody(bodyId));
  }

  _ensureBody(id) {
    let body = this.bodies.get(id);
    if (body) return body;

    const meta = this.scene.game.metadata?.bodies?.[id];
    if (!meta) {
        this.requestMetadata();
        return null;
    }

    const container = this.scene.add.container(0, 0);
    container.id = id;

    body = {
        id,
        meta,
        container,
        fixtures: meta.fixtures.map(f => ({
            id: f.id,
            metaId: f.metaId,
            position: f.position,
            angle: f.angle,
            depth: f.depth || 0,
            image: null
        }))
    };

    this.bodies.set(id, body);

    for (const fixture of body.fixtures) {
        this._ensureFixture(body, fixture);
    }

    // 🔥 NEW: sort fixtures after creation
    this._sortBodyFixtures(body);

    return body;
  }

  _sortBodyFixtures(body) {
    body.container.sort((a, b) => {
        const fa = body.fixtures.find(f => f.id === a.id);
        const fb = body.fixtures.find(f => f.id === b.id);

        return (fa?.depth ?? 0) - (fb?.depth ?? 0);
    });
  }

  _ensureFixture(body, fixture) {
    // Already created?
    if (fixture.image) return fixture.image;

    const meta = this.scene.game.metadata?.fixtures?.[fixture.metaId];
    if (!meta) {
      this.requestMetadata();
      return null;
    }

    const scale = this._getFixtureScale(meta);

    const img = this.scene.add.image(0, 0, meta.type)
      .setOrigin(0.5)
      .setScale(scale);

    img.id = fixture.id;

    // Position
    if (fixture.position) {
      img.setPosition(
        (fixture.position.x * this.scene.pixelsPerMeter) || 0,
        (fixture.position.y * this.scene.pixelsPerMeter) || 0
      );
    }

    // Rotation
    if (fixture.angle) {
      img.setRotation(fixture.angle);
    }

    // Depth (Phaser 3 container → must apply to container)
    if (meta.depth) {
      body.container.setDepth(meta.depth);
    }

    body.container.add(img);

    fixture.image = img;
    return img;
  }

  _getFixtureScale(meta) {
    const localPpm =
      parseFloat(localStorage.getItem('ppmResolution')) ||
      this.scene.pixelsPerMeter ||
      50;

    const imagePpm = getObjectPixelsPerMeter(meta.type) || localPpm;
    const objectScale = typeof meta.scale === 'number' ? meta.scale : 1;

    return objectScale * (localPpm / imagePpm);
  }

  applyBodyStateDeltas(bodyStateDeltas) {
    for (const { id, state } of bodyStateDeltas) {
      const body = this._ensureBody(id);
      if (!body) continue;

      // Ensure fixtures now that metadata may exist
      for (const fixture of body.fixtures) {
        this._ensureFixture(body, fixture);
      }

      const ppm = this.scene.pixelsPerMeter || 50;

      body.container.x = state.pos.x * ppm;
      body.container.y = state.pos.y * ppm;
      body.container.rotation = state.angle || 0;
    }

    this.requestedMetadata = false;
  }

  handleDamageEvent(id, amt) {
    if (!(id && amt)) return;

    const body = this._ensureBody(id);
    if (!body) return;

    for (const fixture of body.fixtures) {
      if (fixture.image) {
        this._applyDamageTintToImage(fixture.image, amt);
      }
    }
  }

  _applyDamageTintToImage(image, amount) {
    const maxDamage = 100;
    const normalized = Phaser.Math.Clamp(amount / maxDamage, 0, 1);

    image.setTint(0xff8888);

    this.scene.tweens.add({
      targets: image,
      alpha: { from: 1, to: 0.7 },
      duration: normalized * 200,
      yoyo: true,
      onComplete: () => {
        image.clearTint();
        image.setAlpha(1);
      }
    });
  }

  requestMetadata() {
    if (this.requestedMetadata) return;
    this.requestedMetadata = true;
    this.scene.game.client.requestMetadata();
    console.log('metareq');
  }

  destroyBody(bodyId) {
    const body = this.bodies.get(bodyId);
    if (!body) return;

    body.container.destroy();
    this.bodies.delete(bodyId);
  }
}
