// fast scalar lerp
function lerpNumber(a, b, alpha) {
  return a + (b - a) * alpha;
}

// fast shallow clone for primitives/arrays/objects (only clones structure; recurses for nested objects)
function fastClone(x) {
  if (x == null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.slice();
  const out = {};
  for (const k of Object.keys(x)) out[k] = fastClone(x[k]);
  return out;
}

// detect numeric array (all entries are numbers)
function isNumericArray(a) {
  if (!Array.isArray(a)) return false;
  for (let i = 0; i < a.length; i++) {
    if (typeof a[i] !== 'number') return false;
  }
  return true;
}

// compact, allocation-conscious recursive interpolator:
// - interpolates numbers
// - interpolates numeric arrays element-wise
// - recursively interpolates plain objects
// - otherwise snaps to the newer value (s1)
export function lerpStatesFast(s0, s1, alpha) {
  // both missing
  if (s0 == null && s1 == null) return null;
  // one side missing -> clone the present side
  if (s0 == null) return fastClone(s1);
  if (s1 == null) return fastClone(s0);

  // numbers
  if (typeof s0 === 'number' && typeof s1 === 'number') {
    return lerpNumber(s0, s1, alpha);
  }

  // both numeric arrays of same length -> element-wise lerp
  if (isNumericArray(s0) && isNumericArray(s1) && s0.length === s1.length) {
    const out = new Array(s0.length);
    for (let i = 0; i < s0.length; i++) out[i] = lerpNumber(s0[i], s1[i], alpha);
    return out;
  }

  // arrays with mixed/non-numeric content: do element-wise recursive where both objects, else snap
  if (Array.isArray(s0) && Array.isArray(s1) && s0.length === s1.length) {
    const out = new Array(s0.length);
    for (let i = 0; i < s0.length; i++) {
      const a = s0[i], b = s1[i];
      if (typeof a === 'number' && typeof b === 'number') out[i] = lerpNumber(a, b, alpha);
      else if (a != null && b != null && typeof a === 'object' && typeof b === 'object') out[i] = lerpStatesFast(a, b, alpha);
      else out[i] = b !== undefined ? fastClone(b) : fastClone(a);
    }
    return out;
  }

  // both plain objects -> walk keys and recurse
  if (typeof s0 === 'object' && typeof s1 === 'object' && !Array.isArray(s0) && !Array.isArray(s1)) {
    const out = {};
    const keys = new Set([...Object.keys(s0), ...Object.keys(s1)]);
    for (const k of keys) {
      const a = s0[k], b = s1[k];
      if (typeof a === 'number' && typeof b === 'number') {
        out[k] = lerpNumber(a, b, alpha);
      } else if (a != null && b != null && typeof a === 'object' && typeof b === 'object') {
        out[k] = lerpStatesFast(a, b, alpha);
      } else {
        out[k] = b !== undefined ? fastClone(b) : fastClone(a);
      }
    }
    return out;
  }

  // fallback: mismatched types or non-interpolatable -> snap to s1
  return fastClone(s1);
}