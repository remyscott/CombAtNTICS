import { getObjectPixelsPerMeter } from '/shared/objectTypes.js';
const uiScale = Number(localStorage.getItem('uiScale') || '1');
if (!localStorage.getItem('uiScale')) {
  localStorage.setItem('uiScale', '1');
}

const style = {
  fontFamily: 'Arial',
  fontSize: `${14 * uiScale}px`,
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
    this.playerImagePos = { x: 0, y: 0 };
    this.cameraFocusPos = { x: 0, y: 0 };
    this.requestedMetadata = false;
    
    console.log('ImageManager initiated');
  }

  

  _ensureBody(id) {
    let body = this.bodies.get(id);
    if (!body) {
      body = this.scene.game.metadata?.bodies?.[id];
      if (body) {
        this.bodies.set(id, body);
        for (const fixture of body.fixtures || []) {
          this._ensureFixture(fixture);
        }
      } else {
        this.requestMetadata();
      }
    }
    return body;
  }

  _getFixtureScale(meta) {
    const localPpm = parseFloat(localStorage.getItem('ppmResolution')) || this.scene.pixelsPerMeter || 50;
    const imagePpm = getObjectPixelsPerMeter(meta.type) || localPpm;
    const objectScale = typeof meta.scale === 'number' ? meta.scale : 1;
    return objectScale * (localPpm / imagePpm);
  }

  _resolveFixtureMeta(metaId) {
    return this.scene.game.metadata?.fixtures?.[metaId] || null;
  }

  _ensureFixture(fixture) {
    const meta = this._resolveFixtureMeta(fixture.metaId);
    if (!meta) {
      this.requestMetadata();
      return fixture;
    }

    fixture.metadata = meta;
    this._ensureFixtureImage(fixture, meta);
    this._ensureFixtureNameImage(fixture, meta);
    return fixture;
  }

  _ensureFixtureImage(fixture, meta) {
    if (!fixture.image && meta.type) {
      const image = this.scene.add.image(0, 0, meta.type)
        .setOrigin(0.5, 0.5)
        .setScale(this._getFixtureScale(meta));
      image.id = fixture.id;
      fixture.image = image;
      this.scene.images.set(image.id, image);
      this.scene.events.emit('image-created', image);
    }

    if (fixture.image && typeof meta.depth === 'number') {
      if (typeof fixture.image.setDepth === 'function') fixture.image.setDepth(meta.depth);
      else if (typeof fixture.image.setZ === 'function') fixture.image.setZ(meta.depth);
      else fixture.image.depth = meta.depth;
    }


  }

  _ensureFixtureNameImage(fixture, meta) {
    if (!meta.name) {
      if (fixture.nameImage) {
        fixture.nameImage.destroy();
        fixture.nameImage = null;
      }
      return;
    }

    if (!fixture.nameImage) {
      fixture.nameImage = this.scene.add.text(0, 0, meta.name, meta.nameStyle || style).setOrigin(0.5, 0.5);
    } else if (fixture.nameImage.text !== meta.name) {
      fixture.nameImage.setText(meta.name);
    }

    if (typeof meta.depth === 'number') {
      const nameDepth = meta.depth + 0.1;
      if (typeof fixture.nameImage.setDepth === 'function') fixture.nameImage.setDepth(nameDepth);
      else if (typeof fixture.nameImage.setZ === 'function') fixture.nameImage.setZ(nameDepth);
      else fixture.nameImage.depth = nameDepth;
    }
  }

  _computeFixturePosition(fixture, state) {
    let px = state.pos.x;
    let py = state.pos.y;

    if (fixture.position) {
      const offX = fixture.position.x || 0;
      const offY = fixture.position.y || 0;
      const angle = state.angle || 0;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      px += offX * ca - offY * sa;
      py += offX * sa + offY * ca;
    }

    const ppm = this.scene.pixelsPerMeter || 50;
    return { px, py, wx: px * ppm, wy: py * ppm };
  }

  _isWorldPosInCameraWithMargin(fixture, wx, wy, marginPx = 64) {
    const cam = this.scene.cameras?.main;
    if (!cam) return true;

    const view = cam.worldView;
    const img = fixture.image;
    const halfWidth = img ? (img.displayWidth || 0) / 1.5 : 0;
    const halfHeight = img ? (img.displayHeight || 0) / 1.5 : 0;

    return wx + halfWidth >= view.x - marginPx && wx - halfWidth <= view.x + view.width + marginPx &&
           wy + halfHeight >= view.y - marginPx && wy - halfHeight <= view.y + view.height + marginPx;
  }

  _applyStateToFixture(fixture, state) {
    if (!fixture.image) return;

    const { px, py, wx, wy } = this._computeFixturePosition(fixture, state);
    const shouldBeVisible = this._isWorldPosInCameraWithMargin(fixture, wx, wy, 96) || this.cameraFocusId === fixture.id;

    if (shouldBeVisible) {
      this._updateOnscreenFixture(fixture, state, wx, wy);
    } else {
      this._updateOffscreenFixture(fixture, state, wx, wy);
    }
  }

  _updateOnscreenFixture(fixture, state, wx, wy) {
    const img = fixture.image;
    img.setVisible(true);
    img.x = wx;
    img.y = wy;
    if (state.angle != null) img.setRotation(state.angle + (fixture.angle || 0));

    if (fixture.nameImage) {
      fixture.nameImage.setVisible(true);
      fixture.nameImage.x = wx;
      fixture.nameImage.y = wy - (img.displayHeight / 2) - 6;
    }
  }

  _updateOffscreenFixture(fixture, state, wx, wy) {
    if (fixture.image) fixture.image.setVisible(false);
    if (fixture.nameImage) {
      fixture.nameImage.x = Math.max(Math.min(wx, this.scene.cameras.main.worldView.right - fixture.nameImage.width), this.scene.cameras.main.worldView.left + fixture.nameImage.width); 
      fixture.nameImage.y = Math.max(Math.min(wy, this.scene.cameras.main.worldView.bottom - fixture.nameImage.height), this.scene.cameras.main.worldView.top + fixture.nameImage.height);
      fixture.nameImage.setVisible(true);
    }
  }

  applyBodyStates(bodyStates) {
    for (const { id, state } of bodyStates) {
      const body = this._ensureBody(id);

      if (!body) continue;
      for (const fixture of body.fixtures || []) {
        this._ensureFixture(fixture);
        this._applyStateToFixture(fixture, state);
      }
    }

    this._removeBodiesNotInState(bodyStates);
    this.requestedMetadata = false;
  }

  requestMetadata() {
    if (this.requestedMetadata) return;
    this.requestedMetadata = true;
    this.scene.game.client.requestMetadata();
    console.log('metareq');
  }

  _removeBodiesNotInState(bodyStates) {
    if (!Array.isArray(bodyStates)) return;

    const presentIds = new Set(bodyStates.map(bs => bs.id));
    for (const [bodyId, bodyMeta] of this.bodies.entries()) {
      if (presentIds.has(bodyId)) continue;

      for (const fixture of bodyMeta.fixtures || []) {
        if (fixture.image && typeof fixture.image.destroy === 'function') fixture.image.destroy();
        if (fixture.nameImage && typeof fixture.nameImage.destroy === 'function') fixture.nameImage.destroy();
        if (fixture.edgeMarker && typeof fixture.edgeMarker.destroy === 'function') fixture.edgeMarker.destroy();
        fixture.image = null;
        fixture.nameImage = null;
        fixture.edgeMarker = null;
      }

      if (this.playerImageId === bodyId) this.playerImageId = null;
      this.bodies.delete(bodyId);
    }
  }


  handleDamageEvent(ev) {
    if (!(ev.id && ev.amount)) return;

    

    const body = this._ensureBody(ev.id);
    if (!body) return;
    for (const fixture of body.fixtures || []) {
      if (fixture.image) {
        this._applyDamageTintToImage(fixture.image, ev.amount);
      }
    }
  }

  _applyDamageTintToImage(image, amount) {
    const maxDamageForFullEffect = 100; 
    const normalized = Phaser.Math.Clamp(amount / maxDamageForFullEffect, 0, 1);

    if (image) {
      // Avoid overlapping tweens by clearing previous tween on this image
      if (this._playerTintTween) {
        this._playerTintTween.stop();
        image.clearTint();
      }

      image.setTint(0xff8888);
      this._playerTintTween = this.scene.tweens.add({
        targets: image,
        alpha: { from: 1, to: 0.7 },
        duration: 120 + normalized * 200,
        yoyo: true,
        onComplete: () => {
          image.clearTint();
          image.setAlpha(1);
          this._playerTintTween = null;
        },
        onStop: () => {
          image.clearTint();
          image.setAlpha(1);
          this._playerTintTween = null;
        }
      });
    }
  }
}