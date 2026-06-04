import objectTypes from '../../shared/objectTypes.js';
import { Box, Circle, Polygon, Vec2 } from 'planck';

export const pixelsPerMeter = objectTypes.pixelsPerMeter || 50;

export function getObjectTypeDefinition(type) {
  return (objectTypes.objects || {})[type] || null;
}

function createPlanckShape(planckConfig = {}, scale = 1) {
  const shapeType = planckConfig.shape || (Array.isArray(planckConfig.vertices) ? 'polygon' : null);
  if (!shapeType) {
    throw new Error('planckConfig must include a shape or vertices');
  }

  if (shapeType === 'box') {
    const halfWidth = (planckConfig.halfWidth ?? 0.5) * scale;
    const halfHeight = (planckConfig.halfHeight ?? 0.5) * scale;
    const center = planckConfig.center ? Vec2((planckConfig.center.x || 0) * scale, (planckConfig.center.y || 0) * scale) : Vec2(0, 0);
    const angle = planckConfig.angle || 0;
    return new Box(halfWidth, halfHeight, center, angle);
  }

  if (shapeType === 'circle') {
    const radius = (planckConfig.radius ?? 0.5) * scale;
    const center = planckConfig.center ? Vec2((planckConfig.center.x || 0) * scale, (planckConfig.center.y || 0) * scale) : Vec2(0, 0);
    return new Circle(center, radius);
  }

  if (shapeType === 'polygon') {
    if (!Array.isArray(planckConfig.vertices)) {
      throw new Error('polygon planckConfig requires a vertices array');
    }
    return Polygon(planckConfig.vertices.map(v => Vec2((v.x || 0) * scale, (v.y || 0) * scale)));
  }

  throw new Error(`Unsupported planck shape type "${shapeType}"`);
}

export function buildFixtureOptions(world, objectType, overrides = {}) {
  const def = getObjectTypeDefinition(objectType);
  if (!def) {
    throw new Error(`Unknown object type "${objectType}"`);
  }

  const cfg = def.planckConfig || {};
  const scale = overrides.scale ?? overrides.scaleFactor ?? cfg.scale ?? 1;
  const shape = createPlanckShape(cfg, scale);

  const userData = {
    id: overrides.userData?.id ?? (typeof world?.newId === 'function' ? world.newId() : undefined),
    type: objectType,
    ...cfg.userData,
    ...overrides.userData,
    scale
  };

  const fixtureOpts = {
    shape,
    userData
  };

  if (overrides.density !== undefined) fixtureOpts.density = overrides.density;
  else if (cfg.density !== undefined) fixtureOpts.density = cfg.density;

  if (overrides.friction !== undefined) fixtureOpts.friction = overrides.friction;
  else if (cfg.friction !== undefined) fixtureOpts.friction = cfg.friction;

  if (overrides.restitution !== undefined) fixtureOpts.restitution = overrides.restitution;
  else if (cfg.restitution !== undefined) fixtureOpts.restitution = cfg.restitution;

  if (cfg.filter !== undefined) fixtureOpts.filter = cfg.filter;
  if (overrides.filter !== undefined) fixtureOpts.filter = overrides.filter;
  if (cfg.isSensor !== undefined) fixtureOpts.isSensor = cfg.isSensor;
  if (overrides.isSensor !== undefined) fixtureOpts.isSensor = overrides.isSensor;

  return fixtureOpts;
}
