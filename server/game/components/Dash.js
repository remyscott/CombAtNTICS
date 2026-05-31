// components/Dash.js
import { Vec2, Box } from 'planck';
import { length, normalize } from '../../utilities/vec2helpers.js';
import { configurableInputs } from '../../../shared/inputsListing.js';

const { DASH } = configurableInputs;

export class Dash {
  /**
   * player: the Player instance (must have .body, .game)
   * opts:
   *   impulse: magnitude of impulse applied (default 12)
   *   cooldown: ms between uses (default 1000)
   *   maxSpeed: optional max linear speed after dash (default 20)
   *   directionPreference: 'mouse'|'input'|'facing' (default 'mouse')
   *   onDash: optional callback (player, info)
   */
  constructor(player, opts = {}) {
    const sf = player.sf || 1;
    this.player = player;
    this.opts = Object.assign({
      impulse: 24*sf*sf,
      cooldown: 1000,
      directionPreference: 'mouse', // 'mouse' preferred, then 'input', then 'facing'
      onDash: null
    }, opts);

    this._lastDash = 0;
    this._tmp = Vec2(0, 0);

    this.player.body.createFixture({
      shape: Box(0.2*sf, 0.2*sf),
      density: 1,
      userData: {depth: 1000, id: this.player.game.world.newId(), type: 'dashCore', scale: sf },
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

    // 1) mouse-relative if requested and available
    if (this.opts.directionPreference === 'mouse' || this.opts.directionPreference === 'mouse,input') {
      const m = inputs.default && inputs.default.mousePosRel;
      if (m && typeof m.x === 'number' && typeof m.y === 'number') {
        // mousePosRel is expected to be vector from player to mouse in *world* or normalized screen space.
        dir.x = m.x;
        dir.y = m.y;
      }
    }

    // 2) fallback: keyboard input directions
    if ((Math.abs(dir.x) < 1e-6 && Math.abs(dir.y) < 1e-6) && (this.opts.directionPreference === 'input' || this.opts.directionPreference === 'mouse,input')) {
      const ip = inputs.actions || {};
      if (ip.UP) dir.y -= 1;
      if (ip.DOWN) dir.y += 1;
      if (ip.LEFT) dir.x -= 1;
      if (ip.RIGHT) dir.x += 1;
    }

    // 3) final fallback: body facing
    if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.y) < 1e-6) {
      const angle = (this.player.body.getAngle && this.player.body.getAngle()) || 0;
      dir.x = Math.cos(angle);
      dir.y = Math.sin(angle);
    }

    // Normalize
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

    // Clamp speed if needed
    if (this.opts.maxSpeed) {
      try {
        const vel = this.player.body.getLinearVelocity();
        const speed = Math.hypot(vel.x, vel.y);
        if (speed > this.opts.maxSpeed) {
          const scale = this.opts.maxSpeed / (speed || 1);
          this.player.body.setLinearVelocity({ x: vel.x * scale, y: vel.y * scale });
        }
      } catch (e) {}
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