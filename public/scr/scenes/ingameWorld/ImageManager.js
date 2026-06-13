import { getObjectPixelsPerMeter } from '/shared/objectTypes.js';

function getUiScale() {
  return Number(localStorage.getItem('uiscale') || 1);
}

const elementOrder = ['name', 'health', 'energy'];
function getPaddingFor(key) {
  return 10 * elementOrder.indexOf(key) * getUiScale();
}

let ppm =  50;

export class ImageManager {
  constructor(scene) {
    this.scene = scene;
    this.game = this.scene.game;
    ppm = this.scene.pixelsPerMeter;
    this.renderBodies = new Map();
    this.renderFixtures = new Map();

    if (!this.scene.uiLayer) {
      this.scene.uiLayer = this.scene.add.layer();
      this.scene.uiLayer.setDepth(99999);
    }

    this.game.events.on('stateUpdated', payload => this._onStateUpdated(payload));
    this.game.events.on('damage', (id, amount) => this._handleDamageEvent(id, amount));

    this._metadataRequested = false;
  }

  /* ---------------------------------------------------------
   *  MAIN UPDATE HANDLER
   * --------------------------------------------------------- */
  _onStateUpdated({ movedBodies, changedFixtures, destroyedBodies }) {

    this._tryCreateAll();
    for (const bodyId of destroyedBodies) {
      this._destroyBodyRender(bodyId);
    }

    for (const bodyId of movedBodies) {
      const renderBody = this._ensureRenderBody(bodyId);
      if (!renderBody) continue;

      const bodyState = this.game.bodies.get(bodyId);
      const container = renderBody.container;

      container.x = bodyState.interpolatedPos.x * ppm;
      container.y = bodyState.interpolatedPos.y * ppm;
      container.rotation = bodyState.interpolatedAngle;

      this._updateFixtureUIForBody(renderBody, ppm);
    }

    for (const fixtureId of changedFixtures || []) {
      this.applyFixtureVars(fixtureId);
    }

    this._metadataRequested = false;

  }

  /* ---------------------------------------------------------
   *  RENDER BODY
   * --------------------------------------------------------- */
  _tryCreateAll() {
    for (const fixtureId of this.game.fixtures.keys()) {
      if (!this.renderFixtures.has(fixtureId)) {
        if (this._ensureRenderFixture(fixtureId)) this.applyFixtureVars(fixtureId);
        
      }
    }
  }

  _ensureRenderBody(id) {
    let renderBody = this.renderBodies.get(id);
    const body = this.game.bodies.get(id);

    if (!body) {
      if (renderBody) this._destroyBodyRender(id);
      return null;
    }

    for (const fixtureId of body.fixtureIds) {
      const renderFixture = this._ensureRenderFixture(fixtureId);
      if (renderFixture) {this.applyFixtureVars(fixtureId)};
      
    }

    if (renderBody) return renderBody;

    const container = this.scene.add.container(0, 0);
    container.id = id;

    renderBody = { id, container, fixtures: [] };
    this.renderBodies.set(id, renderBody);
    this._updateFixtureUIForBody(renderBody, ppm)
    return renderBody;
  }

  /* ---------------------------------------------------------
   *  RENDER FIXTURE
   * --------------------------------------------------------- */
  _ensureRenderFixture(id) {
    const fixture = this.game.fixtures.get(id);
    let renderFixture = this.renderFixtures.get(id);

    if (!fixture) {
      if (renderFixture) this._destroyBodyRender(renderFixture.bodyId);
      return null;
    }

    if (renderFixture) return renderFixture;

    const meta = this.game.metadata?.fixtures?.[fixture.metaId];
    if (!meta) {
      if (!this._metadataRequested) {
        this._metadataRequested = true;
        this.game.client.requestMetadata();
      }
      return null;
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
        energyBar: null,
        arrow: null,
        distanceText: null
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

    const sorted = [...renderBody.fixtures].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));

    container.removeAll(false);
    for (const f of sorted) {
      if (f.image) container.add(f.image);
    }

    const maxDepth = sorted.reduce((m, f) => Math.max(m, f.depth ?? 0), 0);
    container.setDepth(maxDepth);
  }

  /* ---------------------------------------------------------
   *  FIXTURE UI CONTAINER
   * --------------------------------------------------------- */
  _ensureFixtureUI(renderFixture) {
    const ui = renderFixture.ui;

    if (!ui.container) {
      ui.container = this.scene.add.container(0, 0);
      ui.container.id = `${renderFixture.id}-ui`;
      ui.container.setDepth(99999);
      this.scene.uiLayer.add(ui.container);

      ui.arrow = this.scene.add.image(0, 0, "arrowIcon")
        .setOrigin(0.5)
        .setScale(0.7 * getUiScale())
        .setVisible(false);

      ui.distanceText = this.scene.add.text(0, 0, "", {
        fontSize: `${12 * getUiScale()}px`,
        color: "#fff",
        stroke: "#000",
        strokeThickness: 2
      }).setOrigin(0, 0.5);

      ui.container.add(ui.arrow);
      ui.container.add(ui.distanceText);
    }

    return ui;
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
   *  DESTROY BODY RENDER
   * --------------------------------------------------------- */
  _destroyBodyRender(bodyId) {
    const renderBody = this.renderBodies.get(bodyId);
    if (!renderBody) return;

    for (const renderFixture of renderBody.fixtures) {
      const ui = renderFixture.ui;

      if (ui?.nameText) ui.nameText.destroy();
      if (ui?.healthBar) ui.healthBar.destroy();
      if (ui?.energyBar) ui.energyBar.destroy();
      if (ui?.arrow) ui.arrow.destroy();
      if (ui?.distanceText) ui.distanceText.destroy();
      if (ui?.container) ui.container.destroy();

      if (renderFixture.image) renderFixture.image.destroy();

      this.renderFixtures.delete(renderFixture.id);
    }

    renderBody.container.destroy();
    this.renderBodies.delete(bodyId);
  }

  /* ---------------------------------------------------------
   *  APPLY VARS
   * --------------------------------------------------------- */
  applyFixtureVars(id) {
    const renderFixture = this.renderFixtures.get(id);
    if (!renderFixture) return;

    renderFixture.vars = this.game.fixtures.get(id).vars;

    const vars = renderFixture.vars;

    this._applyFixtureName(renderFixture);

    if (vars.health !== undefined || vars.maxHealth !== undefined) {
      this._applyFixtureHealth(renderFixture);
    }

    if (vars.energy !== undefined) {
      this._applyFixtureEnergy(renderFixture);
    }
  }

  /* ---------------- NAME ---------------- */
  _applyFixtureName(renderFixture) {
    const img = renderFixture.image;
    if (!img) return;

    const ui = this._ensureFixtureUI(renderFixture);

    if (!ui.nameText) {
      ui.nameText = this.scene.add.text(0, 0, renderFixture.vars.name || "", {
        fontSize: `${12 * getUiScale()}px`,
        color: "#fff",
        align: "center",
        stroke: "#000",
        strokeThickness: 2
      }).setOrigin(0.5, 0.5);

      ui.container.add(ui.nameText);
    } else {
      ui.nameText.setText(renderFixture.vars.name || "");
    }

    ui.nameText._offsetY = - getPaddingFor("name");
  }

  /* ---------------- HEALTH ---------------- */
  _applyFixtureHealth(renderFixture) {
    const img = renderFixture.image;
    if (!img) return;

    const ui = this._ensureFixtureUI(renderFixture);

    if (!ui.healthBar) {
      ui.healthBar = this.scene.add.rectangle(
        0, 0,
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

    ui.healthBar._offsetY = - getPaddingFor("health");
  }

  /* ---------------- ENERGY ---------------- */
  _applyFixtureEnergy(renderFixture) {
    const img = renderFixture.image;
    if (!img) return;

    const ui = this._ensureFixtureUI(renderFixture);

    if (!ui.energyBar) {
      ui.energyBar = this.scene.add.rectangle(
        0, 0,
        30 * getUiScale(),
        4 * getUiScale(),
        0x00AEEF
      ).setOrigin(0.5, 1);

      ui.container.add(ui.energyBar);
    }

    ui.energyBar.scaleX = (renderFixture.vars.energy ?? 0) / 100;
    ui.energyBar._offsetY = - getPaddingFor("energy");
  }

  /* ---------------------------------------------------------
   *  UPDATE UI POSITIONS FOR A BODY
   * --------------------------------------------------------- */
  _updateFixtureUIForBody(renderBody, ppm) {
    const container = renderBody.container;
    if (!container) return;

    const cam = this.scene.cameras.main;
    const screenW = cam.displayWidth;
    const screenH = cam.displayHeight;

    const playerBodyContainer = this.renderBodies.get(this.game.playerBodyId)?.container;

    for (const renderFixture of renderBody.fixtures) {
      const img = renderFixture.image;
      const ui = renderFixture.ui;
      const uiContainer = ui?.container;

      if (!img || !uiContainer) continue;

      const fx = renderFixture.position?.x || 0;
      const fy = renderFixture.position?.y || 0;

      const cos = Math.cos(container.rotation);
      const sin = Math.sin(container.rotation);

      const worldX = container.x + (fx * ppm * cos - fy * ppm * sin);
      const worldY = container.y + (fx * ppm * sin + fy * ppm * cos);

      // world → screen
      const screenX = worldX - cam.scrollX;
      const screenY = worldY - cam.scrollY;

      const hasName = ui.nameText && ui.nameText.text !== "";

      const offscreen =
        screenX < 0 || screenX > screenW ||
        screenY < 0 || screenY > screenH;

      if (hasName && offscreen) {
        // 1. Project to edge in screen space
        const proj = projectToScreenEdge(screenX, screenY, screenW, screenH);

        // 2. Compute UI size (arrow + distance vs name)
        const arrowW = ui.arrow.displayWidth;
        const arrowH = ui.arrow.displayHeight;

        const distW = ui.distanceText.width;
        const distH = ui.distanceText.height;

        const nameW = ui.nameText.width;
        const nameH = ui.nameText.height;

        const uiWidth = Math.max(arrowW + distW + 10, nameW);
        const uiHeight = arrowH + nameH + 10;

        const halfW = uiWidth / 2;
        const halfH = uiHeight / 2;

        // 3. Clamp projected point so whole UI stays on-screen
        let projX = proj.x;
        let projY = proj.y;

        projX = Math.min(Math.max(projX, halfW), screenW - halfW);
        projY = Math.min(Math.max(projY, halfH), screenH - halfH);

        // 4. Back to world space
        const worldProjX = projX + cam.scrollX;
        const worldProjY = projY + cam.scrollY;

        uiContainer.x = worldProjX;
        uiContainer.y = worldProjY;
        uiContainer.rotation = 0;

        // Arrow + distance
        ui.arrow.setVisible(true);
        ui.arrow.rotation = proj.angle + Math.PI / 2;
        ui.arrow.x = 0;
        ui.arrow.y = 0;

        let dist = 0;
        if (playerBodyContainer) {
          const dx = fx - playerBodyContainer.x / ppm;
          const dy = fy - playerBodyContainer.y / ppm;
          dist = Math.sqrt(dx * dx + dy * dy);
        }

        ui.distanceText.setText(`${Math.round(dist)}m`);
        ui.distanceText.setVisible(true);
        const arrowOnRight = projX > screenW * 0.5;

        // Distance text placement
        if (arrowOnRight) {
          // Arrow is on RIGHT → distance goes LEFT of name
          ui.distanceText.x = - (ui.distanceText.width + 10);
          ui.distanceText.y = 0;

          ui.nameText.x = 0;
          ui.nameText.y = arrowH + 10;
        } else {
          // Arrow is on LEFT → distance stays next to arrow
          ui.distanceText.x = arrowW / 2 + 10;
          ui.distanceText.y = 0;

          ui.nameText.x = 0;
          ui.nameText.y = arrowH + 10;
        }

        if (ui.healthBar) ui.healthBar.setVisible(false);
        if (ui.energyBar) ui.energyBar.setVisible(false);

      } else {
        // On-screen: container at top of image in world space
        uiContainer.x = worldX;
        uiContainer.y = worldY - img.displayHeight / 2;
        uiContainer.rotation = 0;

        ui.arrow.setVisible(false);
        ui.distanceText.setVisible(false);

        if (ui.nameText) {
          ui.nameText.x = 0;
          ui.nameText.y = ui.nameText._offsetY;
        }
        if (ui.healthBar) {
          ui.healthBar.setVisible(true);
          ui.healthBar.x = 0;
          ui.healthBar.y = ui.healthBar._offsetY;
        }
        if (ui.energyBar) {
          ui.energyBar.setVisible(true);
          ui.energyBar.x = 0;
          ui.energyBar.y = ui.energyBar._offsetY;
        }
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

/* ---------------------------------------------------------
 *  SCREEN EDGE PROJECTION
 * --------------------------------------------------------- */
function projectToScreenEdge(x, y, screenW, screenH) {
  const cx = screenW / 2;
  const cy = screenH / 2;

  const dx = x - cx;
  const dy = y - cy;

  const angle = Math.atan2(dy, dx);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const tX = (cos > 0)
    ? (screenW - cx) / cos
    : (0 - cx) / cos;

  const tY = (sin > 0)
    ? (screenH - cy) / sin
    : (0 - cy) / sin;

  const t = Math.min(tX, tY);

  return {
    x: cx + cos * t,
    y: cy + sin * t,
    angle
  };
}
