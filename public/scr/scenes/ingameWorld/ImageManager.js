export class ImageManager {
  constructor(scene) {
    this.scene = scene;
    this.bodies = []; // [{ id, fixtures: [{ id, metadata, image, nameImage }] }]
    this.playerImageId = null;
    console.log('ImageManager initiated');
    this.playerImagePos = {x:0, y:0};
  }

  updatePlayerImagePos() {
    if (!this.playerImageId) {
      this.playerImageId = this.scene.game.playerBodyId;
    }
    this.playerImagePos.x = this.scene.images.get(this.playerImageId)?.x|| 0;
    this.playerImagePos.y = this.scene.images.get(this.playerImageId)?.y || 0;
  }


  _ensureBodyEntry(id) {
    let body = this.bodies.find(b => b.id === id);
    if (!body) {
      body = { id, fixtures: [] };
      this.bodies.push(body);
    }
    return body;
  }

  _ensureFixtureEntry(body, fixtureMeta, createImage = true) {
    let fx = body.fixtures.find(f => f.id === fixtureMeta.id);
    if (!fx) {
      fx = {
        id: fixtureMeta.id,
        metadata: fixtureMeta,
        image: null,
        nameImage: null
      };
      body.fixtures.push(fx);
    } else {
      fx.metadata = fixtureMeta;
    }

    if (createImage) {
      // primary image (sprite)
      if (!fx.image) {
        const typeKey = fixtureMeta.type || 'missing';
        const image = this.scene.add.image(0, 0, typeKey)
          .setOrigin(0.5, 0.5)
          .setScale(fixtureMeta.scale || 1);
        image.id = fixtureMeta.id;
        fx.image = image;
        if (!this.scene.images) this.scene.images = new Map();
        this.scene.images.set(image.id, image);
      } else {
        fx.image.setScale(fixtureMeta.scale || 1);
        const desiredKey = fixtureMeta.type || 'missing';
        if (fx.image.texture.key !== desiredKey) {
          fx.image.setTexture(desiredKey);
        }
      }

      // name text image (if metadata.name exists)
      if (fixtureMeta.name) {
        // Create if missing
        if (!fx.nameImage) {

          const style = {
            fontFamily: 'Arial',
            fontSize: '14px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 1
          };
          const nameText = this.scene.add.text(0, 0, fixtureMeta.name, style)
            .setOrigin(0.5, 1); // origin bottom-center so it sits above the fixture
          fx.nameImage = nameText;
        } else {
          // update text if changed
          if (fx.nameImage.text !== fixtureMeta.name) {
            fx.nameImage.setText(fixtureMeta.name);
          }
        }
      } else {
        // metadata no longer has a name -> destroy existing nameImage
        if (fx.nameImage) {
          fx.nameImage.destroy();
          fx.nameImage = null;
        }
      }
    }

    return fx;
  }

  ensureBodiesForObjectStates(states, { createImages = true } = {}) {
    const seenBodyIds = new Set();
    let metadataRequested = false;

    for (const { id } of states) {
      seenBodyIds.add(id);

      if (!this.scene.game.metadata[id]) {
        if (!metadataRequested) {
          this.scene.game.client.requestMetadata();
          metadataRequested = true;
          console.log('Metadata missing for ID:', id, 'requested update from server');
        }
        this._ensureBodyEntry(id);
        continue;
      }

      const body = this._ensureBodyEntry(id);
      const fixtureList = this.scene.game.metadata[id].fixtures || [];
      const keepFixtureIds = new Set();

      for (const fixtureMeta of fixtureList) {
        keepFixtureIds.add(fixtureMeta.id);
        this._ensureFixtureEntry(body, fixtureMeta, createImages);
      }

      // remove fixtures not in metadata (and destroy their images/nameImages)
      body.fixtures = body.fixtures.filter(fx => {
        if (!keepFixtureIds.has(fx.id)) {
          if (fx.image) {
            fx.image.destroy();
            if (this.scene.images) this.scene.images.delete(fx.id);
          }
          if (fx.nameImage) {
            fx.nameImage.destroy();
          }
          return false;
        }
        return true;
      });
    }

    // remove bodies not in states (and clean up their fixtures images)
    this.bodies = this.bodies.filter(b => {
      if (!seenBodyIds.has(b.id)) {
        for (const fx of b.fixtures) {
          if (fx.image) {
            fx.image.destroy();
            if (this.scene.images) this.scene.images.delete(fx.id);
          }
          if (fx.nameImage) {
            fx.nameImage.destroy();
          }
        }
        return false;
      }
      return true;
    });
  }

  getBody(id) {
    return this.bodies.find(b => b.id === id) || null;
  }

  getFixture(bodyId, fixtureId) {
    const body = this.getBody(bodyId);
    return body ? body.fixtures.find(f => f.id === fixtureId) || null : null;
  }

  applyObjectStates(objectStates) {
    // make sure bodies/fixtures/images exist
    this.ensureBodiesForObjectStates(objectStates, { createImages: true });

    for (const { id, state } of objectStates) {
      if (!state || !state.pos || typeof state.pos.x !== 'number' || typeof state.pos.y !== 'number') {
        continue;
      }

      const body = this.getBody(id);
      if (!body) continue;

      for (const fixture of body.fixtures) {
        const image = fixture.image;
        if (image) {
          image.x = state.pos.x * this.scene.pixelsPerMeter;
          image.y = state.pos.y * this.scene.pixelsPerMeter;
          image.setRotation(state.angle || 0);

          const nameImage = fixture.nameImage;

          if (nameImage) {
            nameImage.x = image.x;
            const topOfImageY = image.y - (image.displayHeight / 2);
            const padding = (fixture.metadata?.namePadding != null)
              ? fixture.metadata.namePadding
              : 6;

            nameImage.y = topOfImageY - padding;

            // If you want the name to rotate with the fixture, uncomment:
            // nameImage.setRotation(img.rotation);
          }
        }
      }
    }
  }
}