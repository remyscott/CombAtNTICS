// maps.js
// Map helpers + maps built from arcs and simple primitives
// Only uses objectType values: 'lockbox', 'box', 'circle'

function degToRad(d) { return d * Math.PI / 180; }
function randRange(min, max) { return Math.random() * (max - min) + min; }

function normalizeObject(obj) {
  const t = (obj.objectType || obj.type || 'box').toString().trim().toLowerCase();
  // only allow the three canonical types; fallback to box
  const allowed = new Set(['lockbox', 'box', 'circle', 'ball']);
  const objectType = allowed.has(t) ? t : 'box';
  const normalized = {
    objectType,
    scale: (typeof obj.scale === 'number') ? obj.scale : (obj.size || 1),
    position: {
      x: (obj.position && typeof obj.position.x === 'number') ? obj.position.x : (typeof obj.x === 'number' ? obj.x : 0),
      y: (obj.position && typeof obj.position.y === 'number') ? obj.position.y : (typeof obj.y === 'number' ? obj.y : 0)
    },
    type: obj.type || obj.bodyType || 'static'
  };
  if (obj.angle != null) normalized.angle = obj.angle;
  if (obj.metadata != null) normalized.metadata = obj.metadata;
  if (obj.moving != null) normalized.moving = obj.moving;
  if (obj.freq != null) normalized.freq = obj.freq;
  if (obj.phase != null) normalized.phase = obj.phase;
  if (obj.axis != null) normalized.axis = obj.axis;
  if (obj.ttl != null) normalized.ttl = obj.ttl;
  if (obj.mag != null) normalized.mag = obj.mag;


  return normalized;
}

/*
  createRow supports two forms for compatibility:

  1) Old: createRow(start, end, step, y, objectType = 'box', scale = 1, type = 'static')
  2) New: createRow({ start, end, step, y, objectType = 'box', scale = 1, type = 'static' })

  Returns an array of normalized objects positioned along X from start to end inclusive with given step.
*/
export function createRow(a, b, c, d, e = 'box', f = 1, g = 'static') {
  // If first argument is an object, use object form
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    const opts = a;
    const { start, end, step, y, ...rest } = opts;
    const objectType = opts.objectType || opts.type || 'box';
    const scale = (typeof opts.scale === 'number') ? opts.scale : (opts.size || 1);
    const type = opts.bodyType || opts.type || 'static';
    if (typeof start !== 'number' || typeof end !== 'number' || typeof step !== 'number' || typeof y !== 'number') {
      return [];
    }
    const count = Math.max(0, Math.floor((end - start) / step) + 1);
    return Array.from({ length: count }, (_, i) => {
      // forward any extra properties from opts (e.g. moving, freq, phase, axis, ttl)
      const item = Object.assign({}, rest, {
        position: { x: start + i * step, y },
        objectType,
        scale,
        type
      });
      return normalizeObject(item);
    });
  }

  // Old-style positional parameters
  const start = a;
  const end = b;
  const step = c;
  const y = d;
  const objectType = e;
  const scale = f;
  const type = g;
  if (typeof start !== 'number' || typeof end !== 'number' || typeof step !== 'number' || typeof y !== 'number') {
    return [];
  }
  const count = Math.max(0, Math.floor((end - start) / step) + 1);
  return Array.from({ length: count }, (_, i) => normalizeObject({
    position: { x: start + i * step, y },
    objectType, scale, type
  }));
}

export function createColumn(start, end, step, x, objectType = 'box', scale = 1, type = 'static') {
  const count = Math.max(0, Math.floor((end - start) / step) + 1);
  return Array.from({ length: count }, (_, i) => normalizeObject({
    position: { x, y: start + i * step },
    objectType, scale, type
  }));
}

// NEW: Circle arc generator (can be full circle when arcDeg = 360)
export function makeCircleArc(radius = 20, count = 48, startAngleDeg = 0, arcDeg = 360, options = {}) {
  const { objectType = 'lockbox', scale = 1.6, cx = 0, cy = 0, anglePerItem = true } = options;
  const arr = [];
  const startRad = degToRad(startAngleDeg);
  const arcRad = degToRad(arcDeg);
  const step = (count > 1) ? (arcRad / (count - 1)) : 0;
  for (let i = 0; i < count; i++) {
    const theta = startRad + i * step;
    const x = cx + Math.cos(theta) * radius;
    const y = cy + Math.sin(theta) * radius;
    const obj = { objectType, scale, position: { x, y } };
    if (anglePerItem) obj.angle = theta;
    arr.push(normalizeObject(obj));
  }
  return arr;
}

export function makeSpiral(center = {x:0,y:0}, turns = 3, spacing = 1.2, count = 100, options = {}) {
  const { objectType = 'circle', scale = 0.5, startAngle = 0 } = options;
  const arr = [];
  for (let i = 0; i < count; i++) {
    const t = (count === 1) ? 0 : i / (count - 1);
    const theta = startAngle + t * turns * Math.PI * 2;
    const r = t * turns * spacing;
    const x = center.x + Math.cos(theta) * r;
    const y = center.y + Math.sin(theta) * r;
    arr.push(normalizeObject({ objectType, scale, position: { x, y }, angle: theta }));
  }
  return arr;
}

export function makeGrid(x1, x2, y1, y2, spacing = 1, options = {}) {
  const { objectType = 'box', scale = 1, type = 'static' } = options;
  const arr = [];
  for (let y = y1; y <= y2 + 1e-9; y += spacing) {
    for (let x = x1; x <= x2 + 1e-9; x += spacing) {
      arr.push(normalizeObject({ objectType, scale, position: { x, y }, type }));
    }
  }
  return arr;
}

export function makeScatter(radius = 18, attempts = 100, minDist = 1.0, options = {}) {
  const { objectType = 'circle', scaleMin = 0.4, scaleMax = 1.6, bounceMean = 1.1, nonOverlap = true } = options;
  const arr = [];
  function randomPoint() {
    const t = 2 * Math.PI * Math.random();
    const u = Math.random() + Math.random();
    const r = (u > 1 ? 2 - u : u) * radius * 0.9;
    return { x: Math.cos(t) * r, y: Math.sin(t) * r };
  }
  for (let i = 0; i < attempts; i++) {
    const s = randRange(scaleMin, scaleMax);
    const p = randomPoint();
    if (nonOverlap) {
      let ok = true;
      for (const ex of arr) {
        const dx = p.x - ex.position.x;
        const dy = p.y - ex.position.y;
        const dist = Math.hypot(dx, dy);
        const minAllowed = (s + (ex.scale || 0)) * minDist;
        if (dist < minAllowed) { ok = false; break; }
      }
      if (!ok) continue;
    }
    arr.push(normalizeObject({ objectType, scale: s, position: p, bounce: (bounceMean + (Math.random() - 0.5) * 0.2) }));
  }
  return arr;
}

// Convenience rectangle border and wall rows
export function makeRectBorder(x1, y1, x2, y2, spacing = 1, options = {}) {
  const objs = [];
  const { objectType = 'box', scale = 1 } = options;
  objs.push(...makeGrid(x1, x2, y1, y1, spacing, { objectType, scale, type: 'static' }));
  objs.push(...makeGrid(x1, x2, y2, y2, spacing, { objectType, scale, type: 'static' }));
  objs.push(...createColumn(y1, y2, spacing, x1, objectType, scale, 'static'));
  objs.push(...createColumn(y1, y2, spacing, x2, objectType, scale, 'static'));
  return objs;
}
export function makeWallRows(x1, x2, yStart, rows, spacing = 1, options = {}) {
  const objs = [];
  for (let r = 0; r < rows; r++) {
    objs.push(...createRow({ start: x1, end: x2, step: spacing, y: yStart + r * spacing * 1.2, objectType: options.objectType || 'box', scale: options.scale || 1 }));
  }
  return objs;
}

// -------------------- Maps using circle arcs / rooms --------------------
export const maps = [];

/* Double arena with narrow tunnel */
maps.push({
  name: 'doubleArena',
  planckConfig: { gravity: { x: 0, y: 9.8 } },
  objects: [
    ...makeCircleArc(16, 40, 15, 330, { objectType: 'lockbox', scale: 2.4, cx: -28, cy: 0 }),
    ...makeCircleArc(16, 40, 195, 330, { objectType: 'lockbox', scale: 2.4, cx: 28, cy: 0 }),

    // narrow tunnel as a few boxes forming corridor
    ...createRow({ start: -12, end: 12, step: 2, y: -4, objectType: 'lockbox', scale: 2 }),
    ...createRow({ start: -12, end: 12, step: 2, y: 4, objectType: 'lockbox', scale: 2 }),

    // some circles inside each arena
    ...makeScatter(12, 400, 0, { objectType: 'ball', scaleMin: 0.1, scaleMax: 1 }).map(o => ({ ...o, position: { x: o.position.x - 28, y: o.position.y } })),
    ...makeScatter(12, 1, 0, { objectType: 'ball', scaleMin: 0.5, scaleMax: 1 }).map(o => ({ ...o, position: { x: o.position.x + 28, y: o.position.y } })),
  ]
});

maps.push({
  name: 'FILTERING APPARATUS',
  planckConfig: { gravity: { x: 0, y: 9.5 } },
  objects: [
    ...makeCircleArc(16, 30, 23, 253, { objectType: 'lockbox', scale: 2.5, cx: -10, cy: 10 }),

    ...makeCircleArc(8, 10, 15, 120, { objectType: 'lockbox', scale: 2.5, cx: -0, cy: 0 }),
    ...makeCircleArc(8, 10, 175, 120, { objectType: 'lockbox', scale: 2.5, cx: -0, cy: 0 }),
    {objectType: 'ball', scale: 10},
    ...createRow({ start: 8, end: 16, step: .8, y: 1, objectType: 'lockbox', scale: .25 }),
    ...createColumn(3, 7, .6, 12, 'lockbox', .25),
    ...makeScatter(2, 50, 0, { objectType: 'ball', scaleMin: 0.4, scaleMax: 0.7 }).map(o => ({ ...o, position: { x: o.position.x + 10, y: o.position.y+4 } })),
    ...createRow({ start: 12, end: 15, step: 1.25, y: 3, objectType: 'lockbox', scale: .3 }),
    ...makeCircleArc(16, 30, 200, 240, { objectType: 'lockbox', scale: 2.5, cx: 20, cy: -20 }),
    ...makeCircleArc(25, 5, 160, 10, { objectType: 'lockbox', scale: 2.5, cx: 40, cy: -6 }),

    ...createRow({ start: 24, end: 35, step: 2, y: -20, objectType: 'lockbox', scale: 2 }),

    ...createColumn(-16, 2, 2, 16, 'lockbox', 2),
    ...createColumn(-24, -7, 3, 4, 'lockbox', 1.5),
    ...createColumn(-24, -16, 3, 16, 'lockbox', 1.5),
    ...createColumn(-35, -25, 1.5, 16, 'lockbox', 1.5),
    ...makeScatter(3, 200, 0, { objectType: 'ball', scaleMin: 0.05, scaleMax: 0.5 }).map(o => ({ ...o, position: { x: o.position.x + 27, y: o.position.y-30 } })),

    ...makeScatter(4, 15, 0, { objectType: 'ball', scaleMin: 1.5, scaleMax: 2 }).map(o => ({ ...o, position: { x: o.position.x + 10, y: o.position.y-25 } })),
    ...createRow({ start: 4, end: 16, step: 2, y: -16, objectType: 'lockbox', scale: 2 }),

    ...createColumn(-24, 30, 2, 22, 'lockbox', 2),
    
    ...createColumn(12, 30, 2, 17, 'lockbox', 2),

    ...createColumn(16, 30, 2, 13.7, 'lockbox', 2),
    ...createRow({ start: -8, end: 16, step: 2, y: 8, objectType: 'lockbox', scale: 2 }),
    ...createRow({ start: -8, end: 16, step: 2, y: 12, objectType: 'lockbox', scale: 2 }),
    ...createRow({ start: 5, end: 14, step: 2, y: 15.2, objectType: 'lockbox', scale: 2 }),
    ...createRow({ start: 14, end: 23, step: 1, y: 30, objectType: 'lockbox', scale: 1 }),
  ]
});

let cu = 0;
for (let i = 1; i < 20; i++) {
  maps[1].objects.push(...createRow({ start: 17, end: 22, y: 12+(4/i)+cu, step: (2/(3*i+4))*3, objectType: 'lockbox', scale: Math.min(2/(3*i+4), 0.25), moving: true, freq: 2, phase: Math.random(), mag: 3}));
  cu += 4/i;
}

/* Donut-like map using arcs for partial rings (openings) */
maps.push({
  name: 'big',
  planckConfig: { gravity: { x: 0, y: 0 } },
  objects: [
    ...makeScatter(10, 50, 0.9, { objectType: 'circle', scaleMin: 0.4, scaleMax: 1.2 }),
    ...makeScatter(10, 50, 0.9, { objectType: 'box', scaleMin: 0.4, scaleMax: .9 })
  ]
});

let cum = 3.5;
for (let i = 2; i < 10; i++) {
  maps[2].objects.push(...makeCircleArc(i*10+cum, 16+i*6, Math.random()*360, 260+i*10, { objectType: 'lockbox', scale: i*2 + .5, cx: 0, cy: 0 }));
  cum += i*3.5;
}
cum = 0.5*3.5;
for (let i = 1.5; i < 10; i++) {
  maps[2].objects.push(...makeCircleArc(i*10+cum, 16+i* 6, Math.random()*360, 260+i*10, { objectType: 'lockbox', scale: i*2 + .5, cx: 0, cy: 0 }));
  cum += i*3.5;
}

maps.push({
  name: '2',
  planckConfig: { gravity: { x: 0, y: 0 } },
  objects: [
  ...makeCircleArc(100, 36, 0, 360, { objectType: 'lockbox', scale: 15, cx: 0, cy: 0 })  ,
  ...makeCircleArc(90, 36, 5, 360, { objectType: 'lockbox', scale: 12, cx: 0, cy: 0 })  ]
});

cum = 0;
for (let i = 2; i < 7; i++) {
  maps[3].objects.push(...makeCircleArc(i*10+cum, 4, Math.random()*360, 200, { objectType: 'lockbox', scale: i*7, cx: -15+i*5, cy: 0 }));
  cum += i*2;
}
cum = 0;
for (let i = 2; i < 7; i++) {
  maps[3].objects.push(...makeCircleArc(i*10+cum, 4, Math.random()*360, 200, { objectType: 'lockbox', scale: i*7, cx: 15-i*5, cy: 5 }));
  cum += i*2;
}

export default maps;