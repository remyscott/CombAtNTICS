// components/Dash.js
import { Vec2, Box } from 'planck';
import { length, normalize } from '../../utilities/vec2helpers.js';
import { configurableInputs } from '../../../shared/inputsListing.js';
import { Component } from './Component.js';

const { DASH, UP, DOWN, LEFT, RIGHT } = configurableInputs;

export class Dash extends Component {
  /**
   * player: the Player instance (must have .body, .game)
   * opts:
   *   impulse: magnitude of impulse applied (default 12)
   *   cooldown: ms between uses (default 1000)
   *   maxSpeed: optional max linear speed after dash (default 20)
   *   directionPreference: 'input'|'facing' (default 'input')
   *   onDash: optional callback (player, info)
   */
  constructor(player, opts = {}) {
    super(player, opts);
    const defaults = {
      dashSize: { value: 0.2, scaleOrder: 1 },
      impulse: { value: 24, scaleOrder: 2 },
      cooldown: 1000,
      directionPreference: 'input', // use inputs by default
      onDash: null
    };
    this.opts = this.normalizeOpts(defaults, opts);

    this._lastDash = 0;
    this._tmp = Vec2(0, 0);

    this.player.body.createFixture({
      shape: Box(this.opts.dashSize, this.opts.dashSize),
      density: 1,
      userData: {depth: 1000, id: this.player.game.world.newId(), type: 'dashCore', scale: this.opts.scaleFactor },
    });
  }

  canDash() {
    const now = Date.now();
    return (now - this._lastDash) >= this.opts.cooldown;
  }

  applyInputs(inputs) {
    if (!inputs || !this.player || !this.player.body) return;

    // Check dash button
    const pressed = !!(inputs.actions && inputs.actions[DASH]);
    if (!pressed) return;
    if (!this.canDash()) return;

    // Determine direction according to preference:
    let dir = { x: 0, y: 0 };

    // 1) keyboard input directions (UP/DOWN/LEFT/RIGHT booleans)
    if (this.opts.directionPreference === 'input' || this.opts.directionPreference === 'input,facing') {
      const ip = inputs.actions || {};
      if (ip[UP]) dir.y -= 1;
      if (ip[DOWN]) dir.y += 1;
      if (ip[LEFT]) dir.x -= 1;
      if (ip[RIGHT]) dir.x += 1;
    }

    // 2) final fallback: body facing
    if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.y) < 1e-6) {
      return;
    }

    // Normalize (handle diagonals)
    const n = Math.hypot(dir.x, dir.y);
    if (n === 0) return;
    dir.x /= n; dir.y /= n;

    // Apply impulse
    const impulseMag = this.opts.impulse;
    this._tmp.x = dir.x * impulseMag;
    this._tmp.y = dir.y * impulseMag;

    try {
      if (typeof this.player.body.applyLinearImpulse === 'function') {
        this.player.body.applyLinearImpulse(this._tmp, this.player.body.getWorldCenter(), true);
      } else if (typeof this.player.body.applyForce === 'function') {
        this.player.body.applyForce(this._tmp, this.player.body.getWorldPoint(Vec2(0,0)));
      }
    } catch (e) {
      console.warn('Dash: failed to apply impulse', e);
    }

    this._lastDash = Date.now();

    // callback
    if (typeof this.opts.onDash === 'function') {
      try { this.opts.onDash(this.player, { dir, impulse: impulseMag }); } catch (e) {}
    }
  }

  getCooldownRemaining() {
    const elapsed = Date.now() - this._lastDash;
    return Math.max(0, this.opts.cooldown - elapsed);
  }

  onDestroy() { /* nothing */ }
}