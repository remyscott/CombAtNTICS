import { World, Box, Vec2, Circle} from 'planck';

export class GameWorld extends World {
  constructor(map) {
    super(map.planckConfig);
    this._id = 0;
    this.loadMapObjects(map.objects);
  }

  loadMapObjects(objects) {
    for (const object of objects) {
      const body = this.createBody({
        type: object.type,
        position: object.position,
        angle: object.angle || 0,
        userData: {id: this.newBodyId(), type: object.objectType, scale: object.scale || 1}
      });

      if (object.objectType === 'lockbox' || object.objectType === 'box') {
        body.createFixture({
          shape: new Box(0.5*object.scale, 0.5*object.scale),
          density: 1,
          friction: .5,
          restitution: .2,
        });
      }

      if (object.objectType === 'circle') {
        body.createFixture({
          shape: new Circle(new Vec2(0, 0), object.scale/2 || .5),
          density: 1,
          friction: .5,
          restitution: 1,
        });
      }
    } 
  }

  newBodyId() {
    return this._id++;
  }
}
