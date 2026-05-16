import { World, Box, Vec2, Circle} from 'planck';

export class GameWorld extends World {
  constructor(map) {
    super(map.planckConfig);
    this._id = 0;
    this.idToBody = new Map();
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

  newId() {
    return this._id++;
  }

  addNewObject(config) {
    const body = this.createBodyForType[config.objectType].call(this, config);
    this.registerBody(body);
  }

  createBoxBody(config) {
    const body = this.createBody({
      type: 'dynamic',
      position: config.position,
      angle: config.angle || 0,
    });

    body.createFixture({
      shape: new Box(0.5*config.scale, 0.5*config.scale),
      density: 1,
      friction: .5,
      restitution: .2,
      userData: {id: body.getUserData().id, type: config.objectType, scale: config.scale || 1}
    });

    return(body);
  }

  createLockboxBody(config) {
    const body = this.createBody({
      type: 'static',
      position: config.position,
      angle: config.angle || 0,
    });

    body.createFixture({
      shape: new Box(0.5*config.scale, 0.5*config.scale),
      friction: .5,
      restitution: .2,
      userData: {id: body.getUserData().id, type: config.objectType, scale: config.scale || 1}
    });
    
    return(body);
  }

  createBody(def) {
    const body = super.createBody({...def, userData: {...def.userData, id: this.newId(), fixtures: []}});
    this.registerBody(body);
    return body;
  }

  registerBody(body) {
    const bodyMetadata = body.getUserData();
    if (bodyMetadata.owner) {
      const {owner, ...withoutOwner} = bodyMetadata;
      this.objectMetadata[bodyMetadata.id] = withoutOwner;
    } else {
      this.objectMetadata[bodyMetadata.id] = bodyMetadata;
    }

    const fixtures = body.getFixtureList();
    if (fixtures) {
      if (!(fixtures.length)) {
        const fixtureMetadata = fixtures.getUserData();
        this.objectMetadata[bodyMetadata.id].fixtures.push(fixtureMetadata);
      }
      else for (const fixture of fixtures) {
        const fixtureMetadata = fixture.getUserData();
        this.objectMetadata[bodyMetadata.id].fixtures.push(fixtureMetadata);
      }
    }
    
    this.idToBody.set(bodyMetadata.id, body);
  }

  getBody(id) {
    const body = this.idToBody.get(id);
    if (!body) {
      this.idToBody.delete(id);
    }
    return body;
  }

  destroyBody(body) {
    const id = body.getUserData().id;
    super.destroyBody(body);
    this.idToBody.delete(id);
    delete this.objectMetadata[id];
  }
}

