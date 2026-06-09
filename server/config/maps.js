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
export const maps = [makeBallPit, makeRingMap, makeCrystalMap];

export function makeBallPit() {
  const res = {name: 'balls',
    planckConfig: { gravity: { x: 0, y: 9.8 } },
    objects: [
      ...makeScatter(10, 250, 0, { objectType: 'ball', scaleMin: 0.8, scaleMax: 1.2 }),
      ...makeCircleArc(150, 36, 0, 360, { objectType: 'lockbox', scale: 30})
    ]
  };

  return res;
}

export function makeRingMap() {
  const res = {name: 'big',
    planckConfig: { gravity: { x: 0, y: 0 } },
    objects: [
      ...makeScatter(10, 50, 0.9, { objectType: 'circle', scaleMin: 0.4, scaleMax: 1.2 }),
      ...makeScatter(10, 50, 0.9, { objectType: 'box', scaleMin: 0.4, scaleMax: .9 })
    ]
  };

  let cum = 3.5;
  for (let i = 1.5; i < 20; i++) {
    res.objects.push(...makeCircleArc(i*5+cum, 10+i*4, Math.random()*360, 160+i*10, { objectType: 'lockbox', scale: 1.1*i + 1.5, cx: 0, cy: 0 }));
    cum += i*1.01;
  }
  return res;
}
  

export function makeCrystalMap() {
  const res = {
    name: '2',
    planckConfig: { gravity: { x: 0, y: 0 } },
    objects: [
    ...makeCircleArc(200, 36, 0, 360, { objectType: 'lockbox', scale: 30, cx: 0, cy: 0 })  ,
    ...makeCircleArc(180, 36, 5, 360, { objectType: 'lockbox', scale: 24, cx: 0, cy: 0 })  ]
  };

  let cum = 0;
  for (let i = 2; i < 10; i++) {
    res.objects.push(...makeCircleArc(i*10+cum, i-1, Math.random()*360, 200+Math.random()*100, { objectType: 'lockbox', scale: 2+i*5, cx: -15+i*5, cy: 0 }));
    cum += i*2;
  }
  cum = 0;
  for (let i = 2; i < 10; i++) {
    res.objects.push(...makeCircleArc(i*10+cum, i, Math.random()*360, 200+Math.random()*100, { objectType: 'lockbox', scale: 2+i*4, cx: 15-i*5, cy: 5 }));
    cum += i*2;
  }
  cum = 0;
  for (let i = 1; i < 10; i++) {
    res.objects.push(...makeCircleArc(i*10+cum, i, Math.random()*360, 200+Math.random()*100, { objectType: 'lockbox', scale: 1+i*3, cx: Math.random()*30, cy: 5*i-15 }));
    cum += i*2;
  }
  return res;
}

export default maps;