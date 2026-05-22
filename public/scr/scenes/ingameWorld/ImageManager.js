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
    this.bodies = new Map(); // [{ id, fixtures: [{ id, metadata, image, nameImage }] }]
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

  _applyStateToFixture(fixture, state) {
    const image = fixture.image;
    if (image) {
      image.x = state.pos.x * this.scene.pixelsPerMeter;
      image.y = state.pos.y * this.scene.pixelsPerMeter;
      image.setRotation(state.angle || 0);
      
      if (state.scale) {
        image.setScale(state.scale);
      }

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

  applyBodyStates(bodyStates) {
    for (const {id, state} of bodyStates) {
      const body = this._ensureBody(id);
      if (body) {
        for (const fixture of body.fixtures) {
          this._ensureFixture(fixture);
          this._applyStateToFixture(fixture, state)
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
    // bodyStates expected to be an array of { id, state } objects
    if (!Array.isArray(bodyStates)) return;

    // Build a Set of ids that are present in the incoming state
    const presentIds = new Set(bodyStates.map(bs => bs.id));

    // Iterate current bodies and remove those not in presentIds
    for (const [bodyId, bodyMeta] of this.bodies.entries()) {
      if (!presentIds.has(bodyId)) {
        // Remove each fixture's image and nameImage if present
        for (const fixture of bodyMeta.fixtures || []) {
          if (fixture.image) {
            // destroy Phaser image and remove from scene.images map
            if (typeof fixture.image.destroy === 'function') {
              fixture.image.destroy();
            }
            this.scene.images && this.scene.images.delete(fixture.image.id);
            fixture.image = null;
          }

          if (fixture.nameImage) {
            if (typeof fixture.nameImage.destroy === 'function') {
              fixture.nameImage.destroy();
            }
            // nameImage likely has no id in scene.images, but remove defensively
            this.scene.images && this.scene.images.delete(fixture.nameImage.id);
            fixture.nameImage = null;
          }
        }

        // If this body was the player image, clear the cached id
        if (this.playerImageId === bodyId) {
          this.playerImageId = null;
        }

        // Finally delete the body entry
        this.bodies.delete(bodyId);
      }
    }
  }
}