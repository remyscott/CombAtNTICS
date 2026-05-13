import { World, Box, Vec2, Circle} from 'planck';

export class GameWorld extends World {
  constructor(map) {
    super(map.planckConfig);
    this._id = 0;
    this.objectMetadata = {};
    this.defaultAttributesFor = {
      'lockbox': {type: 'static', friction: .5, restitution: .2},
      'box': {type: 'dynamic', friction: .5, restitution: .2},
    }

    this.loadMapObjects(map.objects);
  }

  loadMapObjects(objects) {
    this.createBodyForType = {'box': this.createBoxBody, 'lockbox': this.createLockboxBody};

    for (const object of objects) {
      this.addNewObject(object);
    } 
  }

  newBodyId() {
    return this._id++;
  }

  addNewObject(config) {
    const body = this.createBodyForType[config.objectType].call(this, config);
  }

  createBoxBody(config) {
    const body = this.createBody({
      type: 'dynamic',
      position: config.position,
      angle: config.angle || 0,
      userData: {id: this.newBodyId(), type: config.objectType, scale: config.scale || 1}
    });

    body.createFixture({
      shape: new Box(0.5*config.scale, 0.5*config.scale),
      density: 1,
      friction: .5,
      restitution: .2,
    });

    return(body);
  }

  createLockboxBody(config) {
    const body = this.createBody({
      type: 'static',
      position: config.position,
      angle: config.angle || 0,
      userData: {id: this.newBodyId(), type: config.objectType, scale: config.scale || 1}
    });

    body.createFixture({
      shape: new Box(0.5*config.scale, 0.5*config.scale),
      friction: .5,
      restitution: .2,
    });
    
    return(body);
  }

  createBody(def) {
    const body = super.createBody(def);
    const metadata = body.getUserData();
    if (metadata.owner) {
      const {owner, ...withoutOwner} = metadata;
      this.objectMetadata[metadata.id] = withoutOwner;
    } else {
      this.objectMetadata[metadata.id] = metadata;
    }
    return body;
  }
}

