export class GameConsole {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.maxMessages = opts.maxMessages || 10;
    this.ttl = typeof opts.ttl === 'number' ? opts.ttl : 5000;
    this.spacing = opts.spacing || 6;
    this.pool = []; // reusable text objects
    this.active = []; // active message records
    this.container = scene.add.container(0, 0);

    // anchor in top-right by default
    const width = scene.sys.game.config.width;
    const pad = opts.padding || 12;
    this.anchorX = (typeof opts.x === 'number') ? opts.x : width - pad;
    this.anchorY = (typeof opts.y === 'number') ? opts.y : pad;
    this.container.setDepth(1000); // ensure on top

    // default style
    this.style = Object.assign({
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: null,
      stroke: null,
      strokeThickness: 0
    }, opts.style || {});
  }

  _acquireText() {
    let text = this.pool.pop();
    if (!text) {
      text = this.scene.add.text(0, 0, '', this.style).setOrigin(1, 0); // origin right/top
    } else {
      text.setStyle(this.style).setVisible(true);
    }
    this.container.add(text);
    return text;
  }

  _releaseText(text) {
    text.setVisible(false);
    text.setText('');
    this.container.remove(text);
    this.pool.push(text);
  }

  log(message, { level = 'log', ttl } = {}) {
    const lifetime = (typeof ttl === 'number') ? ttl : this.ttl;

    // clamp active messages
    if (this.active.length >= this.maxMessages) {
      // remove the oldest immediately
      const oldest = this.active.shift();
      clearTimeout(oldest.timer);
      this._releaseText(oldest.text);
      this._layoutMessages(); // update positions after removing oldest
    }

    const text = this._acquireText();
    const color = (level === 'error') ? '#ff6666' : (level === 'warn') ? '#ffcc66' : (level === 'info') ? '#66ccff' : '#ffffff';
    text.setColor(color);
    text.setText(String(message));

    this.active.push({ text, level, expiresAt: Date.now() + lifetime, timer: null });

    this._layoutMessages();

    // finalize after ttl (no fade)
    const rec = this.active[this.active.length - 1];
    rec.timer = setTimeout(() => {
      this._removeRecord(rec);
    }, lifetime);

    return rec;
  }

  info(msg, opts) { return this.log(msg, Object.assign({ level: 'info' }, opts)); }
  warn(msg, opts) { return this.log(msg, Object.assign({ level: 'warn' }, opts)); }
  error(msg, opts) { return this.log(msg, Object.assign({ level: 'error' }, opts)); }

  _removeRecord(rec) {
    const idx = this.active.indexOf(rec);
    if (idx === -1) return;

    // Clear any pending timer for this record
    if (rec.timer) {
      clearTimeout(rec.timer);
      rec.timer = null;
    }

    // Remove the record and immediately release its text object
    this.active.splice(idx, 1);
    this._releaseText(rec.text);

    // Re-layout remaining messages so those below shift up immediately
    this._layoutMessages();
  }

  _layoutMessages() {
    let y = this.anchorY;
    for (let i = 0; i < this.active.length; i++) {
      const rec = this.active[i];
      const t = rec.text;
      // position top-right anchored at anchorX (x), y increasing downward
      t.setPosition(this.anchorX, y);
      t.setAlpha(1);
      y += t.height + this.spacing;
    }
  }

  clear() {
    for (const rec of this.active) {
      clearTimeout(rec.timer);
      this._releaseText(rec.text);
    }
    this.active.length = 0;
  }

  destroy() {
    this.clear();
    for (const t of this.pool) {
      t.destroy();
    }
    this.pool.length = 0;
    this.container.destroy();
  }
}