import { getObjectPixelsPerMeter } from '/shared/objectTypes.js';

function getUiScale() {
  return localStorage.getItem('uiscale') || 1;
}

const elementOrder = ['health', 'name']
function getPaddingFor(key) {
  return 12 * elementOrder.indexOf(key) * getUiScale();
}
export class ImageManager {
  constructor(scene) {
    this.scene = scene;
    this.bodies = new Map();
    this.fixtures = new Map();
    this.scene.game.bodies = this.bodies;
    this.requestedMetadata = false;

    // UI layer for names / health bars that should not rotate
    if (!this.scene.uiLayer) {
      this.scene.uiLayer = this.scene.add.layer();
      this.scene.uiLayer.setDepth(99999);
    }

    this.scene.game.events.on('destroyBody', (bodyId) => this.destroyBody(bodyId));
    this.scene.game.events.on('fixtureVarsUpdate', (id, vars) => this.handleVarsUpdate(id, vars));
    this.scene.game.events.on('damage', (id, amount) => {
      this.handleDamageEvent(id, amount);
    });
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
        image: null,
        uiContainer: null,
        vars: f.vars || {},
        bodyId: id
      }))
    };

    this.bodies.set(id, body);

    for (const fixture of body.fixtures) {
      this._ensureFixture(body, fixture);
    }

    this._sortBodyFixtures(body);
    return body;
  }

  _sortBodyFixtures(body) {
    body.container.sort((a, b) => {
      const fa = body.fixtures.find(f => f.id === a.id);
      const fb = body.fixtures.find(f => f.id === b.id);
      return (fb?.depth ?? 0) - (fa?.depth ?? 0);
    });
  }

  _ensureFixture(body, fixture) {
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

    if (fixture.position) {
      img.setPosition(
        (fixture.position.x * this.scene.pixelsPerMeter) || 0,
        (fixture.position.y * this.scene.pixelsPerMeter) || 0
      );
    }

    if (fixture.angle) {
      img.setRotation(fixture.angle);
    }

    body.container.add(img);
    fixture.body = body;
    fixture.image = img;
    this.fixtures.set(fixture.id, fixture);

    if (fixture.vars && Object.keys(fixture.vars).length) {
      console.log(fixture.vars);
      this.applyFixtureVars(fixture, fixture.vars);
    }

    return img;
  }

  // UI container per fixture, follows position but not rotation
  _ensureFixtureUIContainer(fixture) {
    if (fixture.uiContainer) return fixture.uiContainer;

    const ui = this.scene.add.container(0, 0);
    ui.id = `${fixture.id}-ui`;
    ui.setDepth(99999); // always above gameplay
    this.scene.uiLayer.add(ui);

    fixture.uiContainer = ui;
    return ui;
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

      for (const fixture of body.fixtures) {
        this._ensureFixture(body, fixture);
      }

      const ppm = this.scene.pixelsPerMeter || 50;

      body.container.x = state.pos.x * ppm;
      body.container.y = state.pos.y * ppm;
      body.container.rotation = state.angle || 0;
    }

    this._updateFixtureUI();
    this.requestedMetadata = false;
  }

  handleDamageEvent(id, amt) {
    if (!(id && amt)) return;

    const fixture = this.fixtures.get(id);
    if (!fixture) return;

    if (fixture.image) {
      this._applyDamageTintToImage(fixture.image, amt);
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

    for (const fixture of body.fixtures) {
      if (fixture.nameText) {
        fixture.nameText.destroy();
      }
      if (fixture.healthBar) {
        fixture.healthBar.destroy();
      }
      if (fixture.uiContainer) {
        fixture.uiContainer.destroy();
      }
      this.fixtures.delete(fixture.id);
    }

    body.container.destroy();
    this.bodies.delete(bodyId);
  }

  handleVarsUpdate(id, vars) {
    const fixture = this.fixtures.get(id);
    if (!fixture) return;

    this.applyFixtureVars(fixture, vars);
  }

  applyFixtureVars(fixture, vars = {}) {
    fixture.vars = { ...fixture.vars, ...vars };

    this._ensureFixtureUIContainer(fixture);

    if (vars.name) {
      this._applyFixtureName(fixture, vars.name);
    }

    if (vars.health !== undefined) {
      this._applyFixtureHealth(fixture, vars.health);
    }
  }

  _applyFixtureName(fixture, name) {
    const img = fixture.image;
    if (!img) return;

    const uiContainer = this._ensureFixtureUIContainer(fixture);

    const yOffset = -(img.displayHeight / 2) - getPaddingFor('name');

    if (!fixture.nameText) {
      fixture.nameText = this.scene.add.text(0, 0, name, {
        fontSize: `${12 * getUiScale()}px`,
        color: "#fff",
        align: "center",
        stroke: '#000000',      
        strokeThickness: 2
      }).setOrigin(0.5, 0.5);

      uiContainer.add(fixture.nameText);
    } else {
      fixture.nameText.setText(name);
    }

    fixture.nameText._offsetY = yOffset;
  }

  _applyFixtureHealth(fixture, health) {
    const img = fixture.image;
    if (!img) return;

    const uiContainer = this._ensureFixtureUIContainer(fixture);

    if (!fixture.healthBar) {
      const bar = this.scene.add.rectangle(
        0,
        0,
        30 * getUiScale(),
        4 * getUiScale(),
        0x00ff00 // initial color (green)
      ).setOrigin(0.5, 1);

      uiContainer.add(bar);
      fixture.healthBar = bar;
    }

    const maxHealth = fixture.vars.maxHealth || 100;
    const ratio = Phaser.Math.Clamp(health / maxHealth, 0, 1);

    // --- Smooth color blend: green → yellow → red ---
    // Green (0,255,0) → Yellow (255,255,0) → Red (255,0,0)
    let r, g;

    if (ratio > 0.5) {
      // Green → Yellow
      const t = (ratio - 0.5) * 2;
      r = 255 * (1 - t);
      g = 255;
    } else {
      // Yellow → Red
      const t = ratio * 2;
      r = 255;
      g = 255 * t;
    }

    const color = (r << 16) | (g << 8) | 0;

    fixture.healthBar.fillColor = color;
    fixture.healthBar.scaleX = Math.max(health/100,0);

    fixture.healthBar._offsetY = -(img.displayHeight / 2) - getPaddingFor('health');
  }

  _updateFixtureUI() {
    const ppm = this.scene.pixelsPerMeter || 50;

    for (const fixture of this.fixtures.values()) {
        const img = fixture.image;
        if (!img) continue;

        const body = fixture.body;
        if (!body) continue;

        const ui = fixture.uiContainer;
        if (!ui) continue;

        // --- Compute fixture world position exactly like the physics engine ---
        const fx = fixture.position?.x || 0;
        const fy = fixture.position?.y || 0;

        const cos = Math.cos(body.container.rotation);
        const sin = Math.sin(body.container.rotation);

        const worldX = body.container.x + (fx * ppm * cos - fy * ppm * sin);
        const worldY = body.container.y + (fx * ppm * sin + fy * ppm * cos);

        // --- Apply world position, but no rotation ---
        ui.x = worldX;
        ui.y = worldY;
        ui.rotation = 0;

        // --- Apply offsets for name + health bar ---
        if (fixture.nameText) {
            fixture.nameText.x = 0;
            fixture.nameText.y = fixture.nameText._offsetY || 0;
        }

        if (fixture.healthBar) {
            fixture.healthBar.x = 0;
            fixture.healthBar.y = fixture.healthBar._offsetY || 0;
        }
    }
  }
}
