const style = {
  fontFamily: 'Arial',
  fontSize: '14px',
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
    return bodyMeta.fixtures[0].id;
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
        this.bodies.set(id, meta);

        for (const fixture of this.bodies.get(id).fixtures) {
          this._ensureFixture(fixture);
        }
      } else {
        this.requestMetadata();
      }
    } 
    return (this.bodies.get(id));
  }
  
  _ensureFixture(fixture) {
    const fxMeta = structuredClone(this.scene.game.metadata.fixtures[fixture.metaId]);
    if (fxMeta) {
      fixture.metadata = fxMeta; // store metadata reference on fixture
      const metaDepth = (typeof fxMeta.depth === 'number') ? fxMeta.depth : null;
      if (!fixture.image && fxMeta.type) {
        const image = this.scene.add.image(0, 0, fxMeta.type)
          .setOrigin(0.5, 0.5)
          .setScale(fxMeta.scale || 1);
        image.id = fixture.id;
        fixture.image = image;
        this.scene.images.set(image.id, image);

        // apply depth if specified
        if (metaDepth !== null) {
          if (typeof image.setDepth === 'function') image.setDepth(metaDepth);
          else if (typeof image.setZ === 'function') image.setZ(metaDepth);
          else image.depth = metaDepth;
        }
      } else if (fixture.image && metaDepth !== null) {
        // update existing image depth if metadata provides it (keeps layering consistent)
        const image = fixture.image;
        if (typeof image.setDepth === 'function') image.setDepth(metaDepth);
        else if (typeof image.setZ === 'function') image.setZ(metaDepth);
        else image.depth = metaDepth;
      }

      if (fxMeta.name) {
        if (!fixture.nameImage) {
          const nameText = this.scene.add.text(0, 0, fxMeta.name, style)
            .setOrigin(0.5, 1);
          fixture.nameImage = nameText;

          // If metaDepth provided, set name slightly above the fixture image
          if (metaDepth !== null) {
            const nameDepth = metaDepth + 0.1;
            if (typeof nameText.setDepth === 'function') nameText.setDepth(nameDepth);
            else if (typeof nameText.setZ === 'function') nameText.setZ(nameDepth);
            else nameText.depth = nameDepth;
          }
        } else if (fixture.nameImage.text !== fxMeta.name) {
          fixture.nameImage.setText(fxMeta.name);
        } else if (fixture.nameImage && metaDepth !== null) {
          // keep name depth in sync
          const nameDepth = metaDepth + 0.1;
          if (typeof fixture.nameImage.setDepth === 'function') fixture.nameImage.setDepth(nameDepth);
          else if (typeof fixture.nameImage.setZ === 'function') fixture.nameImage.setZ(nameDepth);
          else fixture.nameImage.depth = nameDepth;
        }
      } else if (fixture.nameImage) {
        fixture.nameImage.destroy();
        fixture.nameImage = null;
      }
    } else {
      this.requestMetadata();
    }
    return fixture;
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

  _applyStateToFixture(fixture, state) {
    // bail if no image
    if (!fixture.image) return;

    // determine visibility using adaptive margins in a single-expression style
    let shouldBeVisible = (!!fixture._visibleState
      ? this._isWorldPosInCameraWithMargin(state.pos.x, state.pos.y, 96 + Math.max(fixture.image.displayWidth, fixture.image.displayHeight) * 0.5 || 32 + 48)
      : this._isWorldPosInCameraWithMargin(state.pos.x, state.pos.y, 96 + Math.max(fixture.image.displayWidth, fixture.image.displayHeight) * 0.5 || 32)
    );
    if (fixture.metadata && fixture.metadata.alwaysVisible) shouldBeVisible = true;
    if (this.cameraFocusId === fixture.id) shouldBeVisible = true;

    // common world coords
    const wx = state.pos.x * (this.scene.pixelsPerMeter || 50);
    const wy = state.pos.y * (this.scene.pixelsPerMeter || 50);

    // ON-SCREEN branch
    if (shouldBeVisible && this.scene.cameras && this.scene.cameras.main) {
      const img = fixture.image;
      if (!img.visible) img.setVisible(true);
      img.x = wx; img.y = wy;
      if (state.angle != null) img.setRotation(state.angle);
      if (state.scale != null) img.setScale(state.scale);

      // hide edge marker if present
      if (fixture.edgeMarker) { fixture.edgeMarker.clear(); if (fixture.edgeMarker.visible) fixture.edgeMarker.setVisible(false); }

      // name: create once, update text only when changed
      if (fixture.metadata && fixture.metadata.name) {
        if (!fixture.nameImage) {
          const s = fixture.metadata.nameStyle || { fontSize: '14px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 };
          fixture.nameImage = this.scene.add.text(0, 0, fixture.metadata.name, s).setOrigin(0.5, 0.5);
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
      return;
    }

    // OFF-SCREEN branch
    if (fixture.image.visible) fixture.image.setVisible(false);

    // name presence check
    const name = (fixture.nameImage && fixture.nameImage.text) || (fixture.metadata && fixture.metadata.name);
    if (!name || !(this.scene.cameras && this.scene.cameras.main)) {
      if (fixture.nameImage && fixture.nameImage.visible) fixture.nameImage.setVisible(false);
      if (fixture.edgeMarker) { fixture.edgeMarker.clear(); if (fixture.edgeMarker.visible) fixture.edgeMarker.setVisible(false); }
      fixture._visibleState = false;
      return;
    }

    // screen coords and clamping (inline math)
    const view = this.scene.cameras.main.worldView;
    const sx = wx - view.x, sy = wy - view.y;
    const w = view.width, h = view.height;
    const pad = 18, inner = 8;

    let cx = sx < pad ? pad : (sx > w - pad ? w - pad : sx);
    let cy = sy < pad ? pad : (sy > h - pad ? h - pad : sy);

    // ensure label exists and text up-to-date (create once)
    if (!fixture.nameImage) {
      const s = (fixture.metadata && fixture.metadata.nameStyle) || { fontSize: '14px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 };
      fixture.nameImage = this.scene.add.text(0, 0, name, s).setOrigin(0.5, 0.5);
    } else if (fixture.nameImage.text !== name) {
      fixture.nameImage.setText(name);
    }
    if (!fixture.nameImage.visible) fixture.nameImage.setVisible(true);

    // half extents correction (centered origin)
    const halfW = (fixture.nameImage.width || 0) * 0.5;
    const halfH = (fixture.nameImage.height || 0) * 0.5;
    if (cx - halfW < pad) cx = pad + halfW + inner;
    if (cx + halfW > w - pad) cx = w - pad - halfW - inner;
    if (cy - halfH < pad) cy = pad + halfH + inner;
    if (cy + halfH > h - pad) cy = h - pad - halfH - inner;

    // prefer snapping to edge based on which side the object lies
    if (sx < 0) cx = pad + halfW + inner;
    else if (sx > w) cx = w - pad - halfW - inner;
    if (sy < 0) cy = pad + halfH + inner;
    else if (sy > h) cy = h - pad - halfH - inner;

    // position label in world coords (label follows camera)
    fixture.nameImage.x = view.x + cx;
    fixture.nameImage.y = view.y + cy;

    // edge marker create/reuse, draw triangle with numeric args (no temp arrays)
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