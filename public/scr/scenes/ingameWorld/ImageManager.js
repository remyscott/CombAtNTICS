import { getObjectPixelsPerMeter } from '/shared/objectTypes.js';

function getUiScale() {
  return Number(localStorage.getItem('uiscale') || 1);
}

const elementOrder = ['name', 'health', 'energy'];
function getPaddingFor(key) {
  return 10 * elementOrder.indexOf(key) * getUiScale();
}

export class ImageManager {
  constructor(scene) {
    this.scene = scene;
    this.game = this.scene.game;

    // Render-only maps
    this.renderBodies = new Map();   // bodyId -> { id, container, fixtures: [] }
    this.renderFixtures = new Map(); // fixtureId -> { id, bodyId, image, ui, vars, depth }

    // UI layer for names / health bars that should not rotate
    if (!this.scene.uiLayer) {
      this.scene.uiLayer = this.scene.add.layer();
      this.scene.uiLayer.setDepth(99999);
    }

    // Listen for batched state updates
    this.game.events.on('stateUpdated', payload => this._onStateUpdated(payload));

    // Damage tint animation
    this.game.events.on('damage', (id, amount) => {
      this._handleDamageEvent(id, amount);
    });

    this._metadataRequested = false;
  }

  /* ---------------------------------------------------------
   *  MAIN UPDATE HANDLER
   * --------------------------------------------------------- */
  
  _onStateUpdated({ movedBodies, changedFixtures, destroyedBodies}) {
    const ppm = this.scene.pixelsPerMeter || 50;

    for (const bodyId of destroyedBodies) {
      this._destroyBodyRender(bodyId);
    }

    for (const bodyId of movedBodies) {
      const renderBody = this._ensureRenderBody(bodyId);

      if (!renderBody) continue;
      const bodyState = this.game.bodies?.get(bodyId);

      const container = renderBody.container;
      container.x = bodyState.interpolatedPos.x * ppm;
      container.y = bodyState.interpolatedPos.y * ppm;
      container.rotation = bodyState.interpolatedAngle;

      this._updateFixtureUIForBody(renderBody, ppm);
    }

    // 3. Vars changes
    for (const fixtureId of changedFixtures || []) {
      console.log('something tried to change')
      this.applyFixtureVars(fixtureId);
    }

    this._metadataRequested = false;

  }


  /* ---------------------------------------------------------
   *  RENDER BODY
   * --------------------------------------------------------- */
  _ensureRenderBody(id) {
    let renderBody = this.renderBodies.get(id);
    const body = this.game?.bodies?.get(id);
    
    if (!body) {        //THIS IS A SAFEGUARD, RENDER BODIES ARE SUPPOSED TO BE DELETED IN APPLY CHANGES
      if (renderBody) {
        this._destroyBodyRender(id)
      }
      return;
    }
    for (const fixtureId of body.fixtureIds) {
      const renderFixture = this._ensureRenderFixture(fixtureId);
      if (renderFixture) this.applyFixtureVars(fixtureId);
    }
    if (renderBody) return renderBody;
    const container = this.scene.add.container(0, 0);
    container.id = id;

    renderBody = {
      id,
      container,
      fixtures: [] // array of renderFixtures
    };

    this.renderBodies.set(id, renderBody);
    return renderBody;
  }

  /* ---------------------------------------------------------
   *  RENDER FIXTURE
   * --------------------------------------------------------- */
  _ensureRenderFixture(id) {
    const fixture = this.game.fixtures?.get(id);
    let renderFixture = this.renderFixtures.get(id);

    if (!fixture) {
      if (renderFixture) {
        this._destroyBodyRender(renderFixture.bodyId);
      }
      return;
    }

    if (renderFixture) return renderFixture;

    const meta = this.game.metadata?.fixtures?.[fixture.metaId];

    if (!meta) {
      if (!this._metadataRequested) {
        console.log('metareq');
        this._metadataRequested = true;
        this.game.client.requestMetadata();
      }
      return;
    }

    const renderBody = this.renderBodies.get(fixture.bodyId);
    if (!renderBody) return null;

    renderFixture = {
      id,
      bodyId: fixture.bodyId,
      metaId: fixture.metaId,
      position: fixture.position,
      angle: fixture.angle,
      image: null,
      ui: {
        container: null,
        nameText: null,
        healthBar: null,
        energyBar: null
      },
      vars: fixture.vars || {},
      depth: meta.depth ?? 1
    };

    this.renderFixtures.set(id, renderFixture);
    renderBody.fixtures.push(renderFixture);

    this._createFixtureImage(renderBody, renderFixture, meta);
    this._sortBodyFixtures(renderBody);
    return renderFixture;
  }

  _createFixtureImage(renderBody, renderFixture, meta) {
    if (renderFixture.image) return renderFixture.image;

    const scale = this._getFixtureScale(meta);

    const img = this.scene.add.image(0, 0, meta.type)
      .setOrigin(0.5)
      .setScale(scale);

    img.id = renderFixture.id;
    img.setDepth(renderFixture.depth);

    const ppm = this.scene.pixelsPerMeter || 50;
    if (renderFixture.position) {
      img.setPosition(
        (renderFixture.position.x * ppm) || 0,
        (renderFixture.position.y * ppm) || 0
      );
    }

    if (renderFixture.angle) {
      img.setRotation(renderFixture.angle);
    }

    renderBody.container.add(img);
    renderFixture.image = img;

    return img;
  }

  _sortBodyFixtures(renderBody) {
    const container = renderBody.container;

    const sorted = [...renderBody.fixtures].sort((a, b) => {
      const da = a.depth ?? 0;
      const db = b.depth ?? 0;
      return da - db;
    });

    container.removeAll(false);

    for (const f of sorted) {
      if (f.image) container.add(f.image);
    }

    const maxDepth = sorted.reduce((max, f) => Math.max(max, f.depth ?? 0), 0);
    container.setDepth(maxDepth);
  }

  /* ---------------------------------------------------------
   *  FIXTURE UI CONTAINER
   * --------------------------------------------------------- */
  _ensureFixtureUI(renderFixture) {
    if (!renderFixture.ui) {
      renderFixture.ui = {
        container: null,
        nameText: null,
        healthBar: null,
        energyBar: null
      };
    }

    if (!renderFixture.ui.container) {
      const ui = this.scene.add.container(0, 0);
      ui.id = `${renderFixture.id}-ui`;
      ui.setDepth(99999);
      this.scene.uiLayer.add(ui);

      renderFixture.ui.container = ui;
    }

    return renderFixture.ui;
  }

  /* ---------------------------------------------------------
   *  DAMAGE TINT
   * --------------------------------------------------------- */
  _handleDamageEvent(id, amt) {
    const renderFixture = this.renderFixtures.get(id);
    if (!renderFixture?.image) return;

    this._applyDamageTintToImage(renderFixture.image, amt);
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

  /* ---------------------------------------------------------
   *  DESTROY BODY RENDER (RENDER-ONLY)
   * --------------------------------------------------------- */
  _destroyBodyRender(bodyId) {
    const renderBody = this.renderBodies.get(bodyId);
    if (!renderBody) return;

    for (const renderFixture of renderBody.fixtures) {
      const ui = renderFixture.ui;

      if (ui?.nameText) ui.nameText.destroy();
      if (ui?.healthBar) ui.healthBar.destroy();
      if (ui?.energyBar) ui.energyBar.destroy();
      if (ui?.container) ui.container.destroy();

      if (renderFixture.image) renderFixture.image.destroy();

      this.renderFixtures.delete(renderFixture.id);
    }

    renderBody.container.destroy();
    this.renderBodies.delete(bodyId);
  }

  /* ---------------------------------------------------------
   *  APPLY VARS (NAME / HEALTH / ENERGY)
   * --------------------------------------------------------- */

  applyFixtureVars(id) {
    const renderFixture = this.renderFixtures.get(id);
    if (!renderFixture) return;
    console.log('there is a renderfixture')
    renderFixture.vars = this.game.fixtures.get(id).vars;

    const vars = renderFixture.vars;
    if (renderFixture.vars) {
      console.log('it has vars')

      this._applyFixtureName(renderFixture);
      if (vars.health !== undefined || vars.maxHealth !== undefined) {
        this._applyFixtureHealth(renderFixture);
      }
      if (vars.energy !== undefined) {
        this._applyFixtureEnergy(renderFixture);
      }
    }
  }

  /* ---------------- NAME ---------------- */
  _applyFixtureName(renderFixture) {
    const img = renderFixture.image;
    if (!img) return;

    const ui = this._ensureFixtureUI(renderFixture);

    const yOffset = -(img.displayHeight / 2) - getPaddingFor('name');

    if (!ui.nameText) {
      ui.nameText = this.scene.add.text(0, 0, renderFixture.vars.name || '', {
        fontSize: `${12 * getUiScale()}px`,
        color: "#fff",
        align: "center",
        stroke: '#000000',
        strokeThickness: 2
      }).setOrigin(0.5, 0.5);

      ui.container.add(ui.nameText);
    } else {
      ui.nameText.setText(renderFixture.vars.name || '');
    }

    ui.nameText._offsetY = yOffset;
  }

  /* ---------------- HEALTH ---------------- */
  _applyFixtureHealth(renderFixture) {
    const img = renderFixture.image;
    if (!img) return;

    const ui = this._ensureFixtureUI(renderFixture);

    if (!ui.healthBar) {
      ui.healthBar = this.scene.add.rectangle(
        0,
        0,
        30 * getUiScale(),
        4 * getUiScale(),
        0x00ff00
      ).setOrigin(0.5, 0.5);

      ui.container.add(ui.healthBar);
    }

    const maxHealth = renderFixture.vars.maxHealth || 100;
    const ratio = Math.max((renderFixture.vars.health ?? maxHealth) / maxHealth, 0);

    let r, g;
    if (ratio > 0.5) {
      const t = (ratio - 0.5) * 2;
      r = Math.max(255 * (1 - t), 127);
      g = 255;
    } else {
      const t = ratio * 2;
      r = 255;
      g = 255 * t;
    }

    ui.healthBar.fillColor = (r << 16) | (g << 8) | 0;
    ui.healthBar.scaleX = ratio * maxHealth / 100;

    ui.healthBar._offsetY = -(img.displayHeight / 2) - getPaddingFor('health');
  }

  /* ---------------- ENERGY ---------------- */
  _applyFixtureEnergy(renderFixture) {
    const img = renderFixture.image;
    if (!img) return;

    const ui = this._ensureFixtureUI(renderFixture);

    if (!ui.energyBar) {
      ui.energyBar = this.scene.add.rectangle(
        0,
        0,
        30 * getUiScale(),
        4 * getUiScale(),
        0x00AEEF
      ).setOrigin(0.5, 1);

      ui.container.add(ui.energyBar);
    }

    ui.energyBar.scaleX = (renderFixture.vars.energy ?? 0) / 100;
    ui.energyBar._offsetY = -(img.displayHeight / 2) - getPaddingFor('energy');
  }

  /* ---------------------------------------------------------
   *  UPDATE UI POSITIONS FOR A BODY (RENDER-ONLY)
   * --------------------------------------------------------- */
  _updateFixtureUIForBody(renderBody, ppm) {
    const container = renderBody.container;
    if (!container) return;

    

    for (const renderFixture of renderBody.fixtures) {

      const img = renderFixture.image;
      const uiContainer = renderFixture.ui?.container;
      if (!img || !uiContainer) continue;

      const cos = Math.cos(container.rotation);
      const sin = Math.sin(container.rotation);
      const fx = renderFixture.position?.x || 0;
      const fy = renderFixture.position?.y || 0;

      const worldX = container.x + (fx * ppm * cos - fy * ppm * sin);
      const worldY = container.y + (fx * ppm * sin + fy * ppm * cos);

      uiContainer.x = worldX;
      uiContainer.y = worldY;
      uiContainer.rotation = 0;

      const { nameText, healthBar, energyBar } = renderFixture.ui;

      if (nameText) {
        nameText.x = 0;
        nameText.y = nameText._offsetY || 0;
      }

      if (healthBar) {
        healthBar.x = 0;
        healthBar.y = healthBar._offsetY || 0;
      }

      if (energyBar) {
        energyBar.x = 0;
        energyBar.y = energyBar._offsetY || 0;
      }
    }
  }

  /* ---------------------------------------------------------
   *  SCALE HELPERS
   * --------------------------------------------------------- */
  _getFixtureScale(meta) {
    const localPpm =
      parseFloat(localStorage.getItem('ppmResolution')) ||
      this.scene.pixelsPerMeter ||
      50;

    const imagePpm = getObjectPixelsPerMeter(meta.type) || localPpm;
    const objectScale = typeof meta.scale === 'number' ? meta.scale : 1;

    return objectScale * (localPpm / imagePpm);
  }
}
