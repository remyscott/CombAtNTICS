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
    planckConfig: { gravity: { x: 0, y: 0.1} },
    objects: [
      ...createRow(-10, 10, 2, 5, 'lockbox', 2),
      ...createRow(-10, 10, 2, -15, 'lockbox', 2),
      ...createColumn(-15, 5, 2, -10, 'lockbox', 2),
      ...createColumn(-15, 5, 2, 10, 'lockbox', 2),
      ...createColumn(-10,0,2, 0, 'box', 1),
      ...createColumn(-10,0,1, 5, 'box', 0.5),
      ...createColumn(-10,0,0.5, -5, 'box', 0.25),
      ...createColumn(-10,0,2.5, 7, 'box', 2),

    ]
  },

  map2: {
    planckConfig: { gravity: { x: 0, y: 10} },
    objects: [
      ...createRow(-10, 0, 2, 5, 'lockbox', 2),
      ...createRow(-10, 7, 2, -15, 'lockbox', 2),
      ...createColumn(-15, 5, 2, -10, 'lockbox', 2),
      ...createColumn(-15, -5, 2, 10, 'lockbox', 2),
      ...createRow(-0, 20, 2, 15, 'lockbox', 2),
      ...createRow(10, 50, 2, 5, 'lockbox', 2),
      ...createColumn(5, 15, 2, -0, 'lockbox', 2),
      ...createColumn(-5, 15, 2, 20, 'lockbox', 2),
      ...createColumn(-10,0,2, 0, 'box', 1),
      ...createColumn(-10,0,1, 5, 'box', 0.5),
      ...createColumn(-10,0,0.5, -5, 'box', 0.25),
      ...createColumn(-10,0,0.5, -5, 'box', 0.25),
      ...createColumn(-10,0,0.25, -7.5, 'box', 0.125),
      ...createColumn(-10,0,2.5, 7, 'box', 2),

    ]
  }
};