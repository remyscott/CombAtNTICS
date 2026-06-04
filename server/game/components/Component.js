export class Component {
  constructor(player, opts = {}) {
    this.player = player;
    this.opts = opts;
    this.world = player?.world || player?.game?.world || null;
  }

  static getScaleFactor(player, opts = {}) {
    if (opts && typeof opts.scaleFactor === 'number') return opts.scaleFactor;
    if (player && player.opts && typeof player.opts.scaleFactor === 'number') return player.opts.scaleFactor;
    return 1;
  }

  static computeScaledOption(def, sf) {
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      const raw = Object.prototype.hasOwnProperty.call(def, 'value') ? def.value : def;
      if (typeof def.scaleFn === 'function') {
        return def.scaleFn(raw, sf);
      }
      const order = Number(def.scaleOrder) || 0;
      return typeof raw === 'number' ? raw * Math.pow(sf, order) : raw;
    }

    return def;
  }

  normalizeOpts(defaults = {}, opts = {}) {
    const sf = this.constructor.getScaleFactor(this.player, opts);
    const result = {};

    for (const key of Object.keys(defaults)) {
      result[key] = this.constructor.computeScaledOption(defaults[key], sf);
    }

    for (const key of Object.keys(opts)) {
      result[key] = this.constructor.computeScaledOption(opts[key], sf);
    }

    result.scaleFactor = sf;
    return result;
  }

  applyInputs(inputs) {
    // Override in subclass when input handling is needed.
  }

  update() {
    // Override in subclass for per-frame non-input state updates.
  }

  onDestroy() {
    // Override in subclass if cleanup is required.
  }

  registerBody(body) {
    if (body && this.world && typeof this.world.registerBody === 'function') {
      this.world.registerBody(body);
    }
  }

  safeDestroyBody(body) {
    if (!body || typeof body.getWorld !== 'function') return;
    const world = body.getWorld();
    if (!world || typeof world.destroyBody !== 'function') return;
    try {
      world.destroyBody(body);
    } catch (err) {
      // ignore
    }
  }

  safeDestroyJoint(joint) {
    if (!joint || !this.world || typeof this.world.destroyJoint !== 'function') return;
    try {
      this.world.destroyJoint(joint);
    } catch (err) {
      // ignore
    }
  }
}
