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


export function lerpStatesFast(s0, s1, alpha) {
  // both missing
  if (s0 == null && s1 == null) return null;
  if (s0 == null) return fastClone(s1);
  if (s1 == null) return fastClone(s0);

  // numbers
  if (typeof s0 === 'number' && typeof s1 === 'number') {
    return lerpNumber(s0, s1, alpha);
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