// JavaScript
// Vec2 helpers: pure (no mutation). Returns planck.Vec2 if available, else plain {x,y}.

const Vec2Factory = (typeof planck !== 'undefined' && planck.Vec2) ? planck.Vec2 : ((x, y) => ({ x: x || 0, y: y || 0 }));

export function vec2(x, y) {
  return Vec2Factory(x, y);
}

export function clone(v) {
  return Vec2Factory(v.x, v.y);
}

export function length(v) {
  return Math.hypot(v.x, v.y);
}

export function lengthSq(v) {
  return v.x * v.x + v.y * v.y;
}

export function normalize(v) {
  const L = Math.hypot(v.x, v.y);
  if (L > 0) {
    return Vec2Factory(v.x / L, v.y / L);
  }
  return Vec2Factory(0, 0);
}

export function mulScalar(v, s) {
  return Vec2Factory(v.x * s, v.y * s);
}

export function add(v, w) {
  return Vec2Factory(v.x + w.x, v.y + w.y);
}

export function sub(v, w) {
  return Vec2Factory(v.x - w.x, v.y - w.y);
}

export function dot(v, w) {
  return v.x * w.x + v.y * w.y;
}

export function cross(v, w) {
  return v.x * w.y - v.y * w.x;
}

export function rotate(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return Vec2Factory(v.x * c - v.y * s, v.x * s + v.y * c);
}

export function perp(v) {
  return Vec2Factory(-v.y, v.x);
}