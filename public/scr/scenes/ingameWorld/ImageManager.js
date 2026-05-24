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
    console.log('ImageManager initiated');
    this.playerImagePos = {x:0, y:0};
    this.requestedMetadata = false;
  }

  updatePlayerImagePos() {
    if (!this.playerImageId) {
      this.playerImageId = this.scene.game.playerBodyId;
    }
    this.playerImagePos.x = this.scene.images.get(this.playerImageId)?.x || 0;
    this.playerImagePos.y = this.scene.images.get(this.playerImageId)?.y || 0;
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

      if (!fixture.image && fxMeta.type) {
        const image = this.scene.add.image(0, 0, fxMeta.type)
          .setOrigin(0.5, 0.5)
          .setScale(fxMeta.scale || 1);
        image.id = fixture.id;
        fixture.image = image;
        this.scene.images.set(image.id, image);
      }
      
      if (fxMeta.name) {
        if (!fixture.nameImage) {  
          const nameText = this.scene.add.text(0, 0, fxMeta.name, style)
            .setOrigin(0.5, 1);
          fixture.nameImage = nameText;
        } else if (fixture.nameImage.text !== fxMeta.name) {
          fixture.nameImage.setText(fxMeta.name);
        }
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
    const image = fixture.image;
    if (!image) return;

    const meta = fixture.metadata || {};
    const baseMargin = 96;
    const halfSizePx = Math.max(image.displayWidth, image.displayHeight) * 0.5 || 32;
    const enterMargin = baseMargin + halfSizePx;
    const exitMargin = enterMargin + 48;

    const inEnter = this._isWorldPosInCameraWithMargin(state.pos.x, state.pos.y, enterMargin);
    const inExit = this._isWorldPosInCameraWithMargin(state.pos.x, state.pos.y, exitMargin);

    const prevVisible = !!fixture._visibleState;
    let shouldBeVisible = false;
    if (prevVisible) {
      shouldBeVisible = inExit;
    } else {
      shouldBeVisible = inEnter;
    }

    if (meta.alwaysVisible) shouldBeVisible = true;

    // If visible, show sprite and hide offscreen label/arrow if present
    if (shouldBeVisible) {
      image.setVisible(true);
      if (fixture.nameImage) fixture.nameImage.setVisible(true);
      if (fixture.edgeMarker) {
        fixture.edgeMarker.clear();
        fixture.edgeMarker.setVisible(false);
      }

      // Apply transforms when visible
      image.x = state.pos.x * this.scene.pixelsPerMeter;
      image.y = state.pos.y * this.scene.pixelsPerMeter;
      image.setRotation(state.angle || 0);

      if (state.scale != null) image.setScale(state.scale);

      if (fixture.nameImage) {
        fixture.nameImage.x = image.x;
        const topOfImageY = image.y - (image.displayHeight / 2);
        const padding = (fixture.metadata?.namePadding != null) ? fixture.metadata.namePadding : 6;
        fixture.nameImage.y = topOfImageY - padding;
      }

      fixture._visibleState = true;
      return;
    }

    // OFFSCREEN behavior:
    // If the object is offscreen but has a name, render the name at the screen edge
    // and draw a small arrow pointing toward the object's offscreen direction.
    const hasName = !!(fixture.nameImage || (fixture.metadata && fixture.metadata.name));
    if (!hasName) {
      // hide visuals while offscreen
      if (image.visible) image.setVisible(false);
      if (fixture.nameImage && fixture.nameImage.visible) fixture.nameImage.setVisible(false);
      if (fixture.edgeMarker) {
        fixture.edgeMarker.clear();
        fixture.edgeMarker.setVisible(false);
      }
      fixture._visibleState = false;
      return;
    }

    // Compute screen coords of the object's world position
    const cam = this.scene.cameras && this.scene.cameras.main;
    if (!cam) {
      // Fallback: hide
      if (image.visible) image.setVisible(false);
      if (fixture.nameImage && fixture.nameImage.visible) fixture.nameImage.setVisible(false);
      if (fixture.edgeMarker) { fixture.edgeMarker.clear(); fixture.edgeMarker.setVisible(false); }
      fixture._visibleState = false;
      return;
    }

    const pixelsPerMeter = this.scene.pixelsPerMeter;
    const worldX = state.pos.x * pixelsPerMeter;
    const worldY = state.pos.y * pixelsPerMeter;
    const view = cam.worldView; // { x, y, width, height } in pixels

    // Convert world coords to screen coords (relative to viewport)
    const screenX = worldX - view.x;
    const screenY = worldY - view.y;

    const edgePaddingPx = 18; // distance from screen edge where label sits
    const labelOffsetPx = 28; // space between edge and label baseline
    const arrowSize = 10;     // triangle size in px

    // clamp to rect [edgePadding, width-edgePadding], [edgePadding, height-edgePadding]
    const clampedX = Math.max(edgePaddingPx, Math.min(view.width - edgePaddingPx, screenX));
    const clampedY = Math.max(edgePaddingPx, Math.min(view.height - edgePaddingPx, screenY));

    // Determine whether we're actually offscreen (not just barely inside)
    const isOffscreen = screenX < 0 || screenX > view.width || screenY < 0 || screenY > view.height;

    // Ensure nameImage exists and is updated
    if (!fixture.nameImage) {
      // create if missing (fallback to metadata name)
      const nameText = this.scene.add.text(0, 0, fixture.metadata?.name || 'unnamed', style).setOrigin(0.5, 0.5);
      fixture.nameImage = nameText;
    } else if (fixture.nameImage.text !== (fixture.metadata?.name || '')) {
      fixture.nameImage.setText(fixture.metadata?.name || '');
    }

    // world -> absolute screen coordinates (canvas coords)
    const absX = view.x + clampedX;
    const absY = view.y + clampedY;

    // Position the name near the edge, offset slightly inward from clamped point
    // If object is offscreen left/right, place label slightly inward horizontally,
    // if offscreen top/bottom place label slightly inward vertically.
    let labelX = absX;
    let labelY = absY;
    const marginInner = 8;

    if (screenX < 0) {
      // off left
      labelX = view.x + edgePaddingPx + marginInner;
      labelY = view.y + clampedY;
    } else if (screenX > view.width) {
      // off right
      labelX = view.x + view.width - edgePaddingPx - marginInner;
      labelY = view.y + clampedY;
    } else if (screenY < 0) {
      // off top
      labelX = view.x + clampedX;
      labelY = view.y + edgePaddingPx + marginInner;
    } else if (screenY > view.height) {
      // off bottom
      labelX = view.x + clampedX;
      labelY = view.y + view.height - edgePaddingPx - marginInner;
    }

    // Convert abs coords back to world coords for Phaser display on the same camera
    const displayX = labelX;
    const displayY = labelY;

    // Show name label at displayX, displayY (set to world coords by adding cam.scroll)
    fixture.nameImage.setVisible(true);
    fixture.nameImage.x = displayX;
    fixture.nameImage.y = displayY;

    // Create / reuse arrow graphics
    if (!fixture.edgeMarker) {
      const g = this.scene.add.graphics();
      g.setDepth(1000); // ensure on top
      fixture.edgeMarker = g;
    }
    const g = fixture.edgeMarker;
    g.clear();
    g.setVisible(true);
    g.fillStyle(0xffcc00, 1);

    // Determine arrow center & angle (pointing from label toward the object)
    const labelCenterX = displayX;
    const labelCenterY = displayY;
    const objScreenX = view.x + screenX;
    const objScreenY = view.y + screenY;
    const dx = objScreenX - labelCenterX;
    const dy = objScreenY - labelCenterY;
    const ang = Math.atan2(dy, dx);

    // Arrow coordinates relative to labelCenter; small triangle
    const ax = labelCenterX;
    const ay = labelCenterY;
    const s = arrowSize;

    // triangle points: tip at direction toward object, base behind it
    const tipX = ax + Math.cos(ang) * (s + 6);
    const tipY = ay + Math.sin(ang) * (s + 6);
    const leftX = ax + Math.cos(ang + Math.PI * 0.8) * s;
    const leftY = ay + Math.sin(ang + Math.PI * 0.8) * s;
    const rightX = ax + Math.cos(ang - Math.PI * 0.8) * s;
    const rightY = ay + Math.sin(ang - Math.PI * 0.8) * s;

    g.fillPoints([ { x: tipX, y: tipY }, { x: leftX, y: leftY }, { x: rightX, y: rightY } ], true);

    fixture._visibleState = false; // mark as not fully visible but with edge label shown
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
    if (!this.requestedMetadata) {this.requestedMetadata = true; console.log('requested metadata'); this.scene.game.client.requestMetadata();}
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
        }

        if (this.playerImageId === bodyId) {
          this.playerImageId = null;
        }

        this.bodies.delete(bodyId);
      }
    }
  }
}