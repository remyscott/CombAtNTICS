function createRow(start, end, step, y, objectType, scale, type = 'static') {
  const count = Math.floor((end - start) / step) + 1;
  return Array.from({ length: count }, (_, i) => ({
    position: { x: start + i * step, y },
    objectType,
    scale,
    type
  }));
}

function createColumn(start, end, step, x, objectType, scale, type = 'static') {
  const count = Math.floor((end - start) / step) + 1;
  return Array.from({ length: count }, (_, i) => ({
    position: { x, y: start + i * step },
    objectType,
    scale,
    type
  }));
}

export const maps = {
  map1: {
    planckConfig: { gravity: { x: 0, y: 10} },
    objects: [
      ...createRow(-10, 10, 2, 5, 'lockbox', 2),
      ...createRow(-10, 10, 2, -15, 'lockbox', 2),
      ...createColumn(-15, 5, 2, -10, 'lockbox', 2),
      ...createColumn(-15, 5, 2, 10, 'lockbox', 2),
    ]
  }
};