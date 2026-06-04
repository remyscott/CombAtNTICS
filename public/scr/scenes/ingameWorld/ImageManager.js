import { getObjectPixelsPerMeter } from '/shared/objectTypes.js';

if (!localStorage.getItem('uiscale')) {
  localStorage.setItem('uiScale', '1')
}

const style = {
  fontFamily: 'Arial',
  fontSize: `${14*Number(localStorage.getItem('uiscale'))}px`,
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 1
};

export class ImageManager {
  constructor(scene) {
    this.scene = scene;
    this.bodies = new Map();
    this.playerImageId = null;
    this.cameraFocusId = null;
    console.log('ImageManager initiated');
    this.playerImagePos = { x: 0, y: 0 };
    this.cameraFocusPos = { x: 0, y: 0 };
    this.requestedMetadata = false;
    this.requestedMetadataFor = [];
  }

  setImageFocusId(id) {
    this.cameraFocusId = id;
    this.updateImageFocusPos();
  }
  
  _resolveLocalPlayerFixtureId() {
    const bodyId = this.scene.game.playerBodyId;
    if (!bodyId || !this.scene.game.metadata || !this.scene.game.metadata.bodies) return null;
    const bodyMeta = this.scene.game.metadata.bodies[bodyId];
    if (!bodyMeta || !Array.isArray(bodyMeta.fixtures) || bodyMeta.fixtures.length === 0) return null;

    const primaryFixture = this._getPrimaryFixtureForBody(bodyMeta);
    return primaryFixture?.id || bodyMeta.fixtures[0].id;
  }

  updateImageFocusPos() {
    const localFixtureId = this._resolveLocalPlayerFixtureId();
    if (localFixtureId) {
      this.playerImageId = localFixtureId;
    }

    if (!this.cameraFocusId) {
      this.cameraFocusId = this.playerImageId;
    }

    this.playerImagePos.x = this.scene.images.get(this.playerImageId)?.x || 0;
    this.playerImagePos.y = this.scene.images.get(this.playerImageId)?.y || 0;
    this.cameraFocusPos.x = this.scene.images.get(this.cameraFocusId)?.x ?? this.playerImagePos.x;
    this.cameraFocusPos.y = this.scene.images.get(this.cameraFocusId)?.y ?? this.playerImagePos.y;
  }

  _ensureBody(id) {
    if (!this.bodies.get(id)) {
      const meta = structuredClone(this.scene.game.metadata.bodies[id]);
      if (meta) {
        this._tagPrimaryNameFixtures(meta);
        this.bodies.set(id, meta);

        for (const fixture of this.bodies.get(id).fixtures) {
          this._ensureFixture(fixture);
        }
      } else {
        this.requestMetadata();
      }
    }
    return this.bodies.get(id);
  }

  _getLocalPpm() {
    const raw = parseFloat(localStorage.getItem('ppmResolution'));
    return Number.isFinite(raw) ? raw : (this.scene.pixelsPerMeter || 50);
  }

  _getFixtureImageScale(fxMeta) {
    const localPpm = this._getLocalPpm();
    const imagePpm = getObjectPixelsPerMeter(fxMeta.type);
    const objectScale = (typeof fxMeta.scale === 'number') ? fxMeta.scale : 1;
    return objectScale * (localPpm / imagePpm);
  }

  _resolveFixtureMeta(metaId) {
    const fxMeta = this.scene.game.metadata?.fixtures?.[metaId] || null;
    return fxMeta ? structuredClone(fxMeta) : null;
  }

  _estimateFixtureSizeScore(fxMeta) {
    if (!fxMeta || typeof fxMeta.type !== 'string') return 0;
    const objectPpm = getObjectPixelsPerMeter(fxMeta.type);
    const scale = (typeof fxMeta.scale === 'number') ? fxMeta.scale : 1;
    return objectPpm * scale;
  }

  _getPrimaryFixtureForBody(bodyMeta) {
    if (!bodyMeta || !Array.isArray(bodyMeta.fixtures) || bodyMeta.fixtures.length === 0) return null;

    let primary = null;
    let bestScore = -Infinity;
    for (const fixtureRef of bodyMeta.fixtures) {
      const fxMeta = this._resolveFixtureMeta(fixtureRef.metaId);
      const score = this._estimateFixtureSizeScore(fxMeta);
      if (score > bestScore) {
        bestScore = score;
        primary = fixtureRef;
      }
    }

    return primary || bodyMeta.fixtures[0];
  }

  _tagPrimaryNameFixtures(bodyMeta) {
    if (!bodyMeta || !Array.isArray(bodyMeta.fixtures)) return;

    const groups = new Map();
    for (const fixture of bodyMeta.fixtures) {
      const fxMeta = this._resolveFixtureMeta(fixture.metaId);
      if (!fxMeta?.name) continue;

      const name = fxMeta.name;
      const score = this._estimateFixtureSizeScore(fxMeta);
      const entry = groups.get(name) || { bestScore: -Infinity, primary: null };
      if (score > entry.bestScore) {
        entry.bestScore = score;
        entry.primary = fixture;
      }
      groups.set(name, entry);
    }

    for (const fixture of bodyMeta.fixtures) {
      fixture.isPrimaryLabel = false;
    }
    for (const entry of groups.values()) {
      if (entry.primary) entry.primary.isPrimaryLabel = true;
    }
  }

  _isPrimaryLabelAnchor(fixture) {
    return fixture.isPrimaryLabel !== false;
  }

  // Returns true if the given world position (meters) is within the camera view (with padding)
  _isWorldPosInCameraWithMargin(xMeters, yMeters, marginPx = 64) {
    const cam = this.scene.cameras && this.scene.cameras.main;
    if (!cam) return true; // conservative
    const px = xMeters * this.scene.pixelsPerMeter;
    const py = yMeters * this.scene.pixelsPerMeter;
    const view = cam.worldView; // x,y,width,height in world (pixels)
    return (px >= view.x - marginPx && px <= view.x + view.width + marginPx &&
            py >= view.y - marginPx && py <= view.y + view.height + marginPx);
  }

    // JavaScript (Phaser-like)
  _ensureFixture(fixture) {
    const fxMeta = this._resolveFixtureMeta(fixture.metaId);
    if (!fxMeta) {
      this.requestMetadata();
      return fixture;
    }

    fixture.metadata = fxMeta;
    this._ensureFixtureImage(fixture, fxMeta);
    this._ensureFixtureNameImage(fixture, fxMeta);

    return fixture;
  }

  _ensureFixtureImage(fixture, fxMeta) {
    if (!fixture.image && fxMeta.type) {
      const image = this.scene.add.image(0, 0, fxMeta.type)
        .setOrigin(0.5, 0.5)
        .setScale(this._getFixtureImageScale(fxMeta));
      image.id = fixture.id;
      fixture.image = image;
      this.scene.images.set(image.id, image);
    }
    if (fixture.image && fxMeta.type) {
      fixture.image.setScale(this._getFixtureImageScale(fxMeta));
    }
    // apply depth if specified
    const metaDepth = (typeof fxMeta.depth === 'number') ? fxMeta.depth : null;
    if (fixture.image && metaDepth !== null) {
      if (typeof fixture.image.setDepth === 'function') fixture.image.setDepth(metaDepth);
      else if (typeof fixture.image.setZ === 'function') fixture.image.setZ(metaDepth);
      else fixture.image.depth = metaDepth;
    }
  }

  _ensureFixtureNameImage(fixture, fxMeta) {
    if (fxMeta.name) {
      if (!fixture.nameImage) {
        const s = fxMeta.nameStyle || style;
        fixture.nameImage = this.scene.add.text(0, 0, fxMeta.name, s).setOrigin(0.5, 0.5);
      } else if (fixture.nameImage.text !== fxMeta.name) {
        fixture.nameImage.setText(fxMeta.name);
      }
      // keep name depth in sync with fixture image
      const metaDepth = (typeof fxMeta.depth === 'number') ? fxMeta.depth : null;
      if (metaDepth !== null) {
        const nd = metaDepth + 0.1;
        if (typeof fixture.nameImage.setDepth === 'function') fixture.nameImage.setDepth(nd);
        else if (typeof fixture.nameImage.setZ === 'function') fixture.nameImage.setZ(nd);
        else fixture.nameImage.depth = nd;
      }
    } else if (fixture.nameImage) {
      fixture.nameImage.destroy();
      fixture.nameImage = null;
    }
  }

  // compute world and pixel positions; returns {px,py,wx,wy}
  _computeFixturePosition(fixture, state) {
    // base world meters
    let px = state.pos.x, py = state.pos.y;
    if (fixture.position && (fixture.position.x != null || fixture.position.y != null)) {
      const offX = (fixture.position.x != null) ? fixture.position.x : 0;
      const offY = (fixture.position.y != null) ? fixture.position.y : 0;
      const a = (state.angle != null) ? state.angle : 0;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = offX * ca - offY * sa;
      const ry = offX * sa + offY * ca;
      px = state.pos.x + rx;
      py = state.pos.y + ry;
    }
    const ppm = (this.scene.pixelsPerMeter || 50);
    return { px, py, wx: px * ppm, wy: py * ppm };
  }

  _applyStateToFixture(fixture, state) {
    if (!fixture.image) return;
    const { px, py, wx, wy } = this._computeFixturePosition(fixture, state);

    // choose margin based on previous visible state and image size
    const size = Math.max(fixture.image.displayWidth || 0, fixture.image.displayHeight || 0);
    const margin = 96 + Math.max(size * 0.5, 32);
    let shouldBeVisible = this._isWorldPosInCameraWithMargin(px, py, margin);
    if (fixture.metadata && fixture.metadata.alwaysVisible) shouldBeVisible = true;
    if (this.cameraFocusId === fixture.id) shouldBeVisible = true;

    const cam = this.scene.cameras && this.scene.cameras.main;
    if (shouldBeVisible && cam) {
      this._updateOnscreenFixture(fixture, state, wx, wy);
    } else {
      this._updateOffscreenFixture(fixture, state, wx, wy);
    }
  }

  _updateOnscreenFixture(fixture, state, wx, wy) {
    const img = fixture.image;
    if (!img.visible) img.setVisible(true);
    img.x = wx; img.y = wy;
    if (state.angle != null) img.setRotation(state.angle + (fixture.angle || 0));

    // hide edge marker if present
    if (fixture.edgeMarker) { fixture.edgeMarker.clear(); if (fixture.edgeMarker.visible) fixture.edgeMarker.setVisible(false); }

    if (fixture.metadata && fixture.metadata.name && this._isPrimaryLabelAnchor(fixture)) {
      if (!fixture.nameImage) {
        this._ensureFixtureNameImage(fixture, fixture.metadata);
      } else if (fixture.nameImage.text !== fixture.metadata.name) {
        fixture.nameImage.setText(fixture.metadata.name);
      }
      if (!fixture.nameImage.visible) fixture.nameImage.setVisible(true);
      const pad = (fixture.metadata.namePadding != null) ? fixture.metadata.namePadding : 6;
      fixture.nameImage.x = wx;
      fixture.nameImage.y = wy - (img.displayHeight / 2) - pad;
    } else if (fixture.nameImage && fixture.nameImage.visible) {
      fixture.nameImage.setVisible(false);
    }
    fixture._visibleState = true;
  }

  _updateOffscreenFixture(fixture, state, wx, wy) {
    // hide main image, keep name & edge marker or move them to screen edges
    if (fixture.image.visible) fixture.image.setVisible(false);

    const name = (fixture.nameImage && fixture.nameImage.text) || (fixture.metadata && fixture.metadata.name);
    const cam = this.scene.cameras && this.scene.cameras.main;
    if (!name || !cam || !this._isPrimaryLabelAnchor(fixture)) {
      if (fixture.nameImage && fixture.nameImage.visible) fixture.nameImage.setVisible(false);
      if (fixture.edgeMarker) { fixture.edgeMarker.clear(); if (fixture.edgeMarker.visible) fixture.edgeMarker.setVisible(false); }
      fixture._visibleState = false;
      return;
    }

    // compute screen coords and clamp (same logic you had)
    const view = cam.worldView;
    const sx = wx - view.x, sy = wy - view.y;
    const w = view.width, h = view.height;
    const pad = 18, inner = 8;
    let cx = sx < pad ? pad : (sx > w - pad ? w - pad : sx);
    let cy = sy < pad ? pad : (sy > h - pad ? h - pad : sy);

    if (!fixture.nameImage) {
      const s = (fixture.metadata && fixture.metadata.nameStyle) || { fontSize: '14px', color: '#ffffff' };
      fixture.nameImage = this.scene.add.text(0, 0, name, s).setOrigin(0.5, 0.5);
    } else if (fixture.nameImage.text !== name) {
      fixture.nameImage.setText(name);
    }
    if (!fixture.nameImage.visible) fixture.nameImage.setVisible(true);

    const halfW = (fixture.nameImage.width || 0) * 0.5;
    const halfH = (fixture.nameImage.height || 0) * 0.5;
    if (cx - halfW < pad) cx = pad + halfW + inner;
    if (cx + halfW > w - pad) cx = w - pad - halfW - inner;
    if (cy - halfH < pad) cy = pad + halfH + inner;
    if (cy + halfH > h - pad) cy = h - pad - halfH - inner;

    if (sx < 0) cx = pad + halfW + inner;
    else if (sx > w) cx = w - pad - halfW - inner;
    if (sy < 0) cy = pad + halfH + inner;
    else if (sy > h) cy = h - pad - halfH - inner;

    fixture.nameImage.x = view.x + cx;
    fixture.nameImage.y = view.y + cy;

    // draw edge marker triangle pointing toward object
    if (!fixture.edgeMarker) { const g = this.scene.add.graphics(); g.setDepth(1000); fixture.edgeMarker = g; }
    const g2 = fixture.edgeMarker;
    g2.clear();
    if (!g2.visible) g2.setVisible(true);
    g2.fillStyle(0xffcc00, 1);
    const lx = fixture.nameImage.x, ly = fixture.nameImage.y;
    const ox = view.x + sx, oy = view.y + sy;
    const ang = Math.atan2(oy - ly, ox - lx);
    const s = 10;
    const tipX = lx + Math.cos(ang) * (s + 6), tipY = ly + Math.sin(ang) * (s + 6);
    const leftX = lx + Math.cos(ang + Math.PI * 0.8) * s, leftY = ly + Math.sin(ang + Math.PI * 0.8) * s;
    const rightX = lx + Math.cos(ang - Math.PI * 0.8) * s, rightY = ly + Math.sin(ang - Math.PI * 0.8) * s;
    g2.fillTriangle(tipX, tipY, leftX, leftY, rightX, rightY);

    fixture._visibleState = false;
  }

  applyBodyStates(bodyStates) {
    for (const {id, state} of bodyStates) {
      const body = this._ensureBody(id);
      if (body) {
        for (const fixture of body.fixtures) {
          this._ensureFixture(fixture);
          this._applyStateToFixture(fixture, state);
        }
      }
    }

    this._removeBodiesNotInState(bodyStates);
    this.requestedMetadata = false;
  }

  requestMetadata() {
    if (this.requestedMetadata) return;
    this.requestedMetadata = true; 
    this.scene.game.client.requestMetadata()
    console.log('metareq');
  }

  _removeBodiesNotInState(bodyStates) {
    if (!Array.isArray(bodyStates)) return;

    const presentIds = new Set(bodyStates.map(bs => bs.id));

    for (const [bodyId, bodyMeta] of this.bodies.entries()) {
      if (!presentIds.has(bodyId)) {
        for (const fixture of bodyMeta.fixtures || []) {
          if (fixture.image) {
            try {
              if (typeof fixture.image.destroy === 'function') {
                fixture.image.destroy();
              }
            } catch (e) {}
            if (fixture.image && fixture.image.id) {
              this.scene.images && this.scene.images.delete(fixture.image.id);
            }
            fixture.image = null;
          }

          if (fixture.nameImage) {
            try {
              if (typeof fixture.nameImage.destroy === 'function') {
                fixture.nameImage.destroy();
              }
            } catch (e) {}
            if (fixture.nameImage && fixture.nameImage.id) {
              this.scene.images && this.scene.images.delete(fixture.nameImage.id);
            }
            fixture.nameImage = null;
          }
          if (fixture.edgeMarker) {
            try {
              if (typeof fixture.edgeMarker.destroy === 'function') {
                fixture.edgeMarker.destroy();
              }
            } catch (e) {}
            if (fixture.edgeMarker && fixture.edgeMarker.id) {
              this.scene.images && this.scene.images.delete(fixture.edgeMarker.id);
            }
            fixture.nameImage = null;
          }
        }

        if (this.playerImageId === bodyId) {
          this.playerImageId = null;
        }

        this.bodies.delete(bodyId);
      }
    }
  }
}