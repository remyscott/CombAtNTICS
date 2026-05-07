export class GameConsole {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.maxMessages = opts.maxMessages || 30;
    this.ttl = typeof opts.ttl === 'number' ? opts.ttl : 5000;
    this.spacing = opts.spacing || 6;
    this.pool = []; // reusable text objects
    this.active = []; // active message records
    this.container = scene.add.container(0, 0);

    const pad = opts.padding || 12;
    this.pad = pad;
    this.anchorX = (typeof opts.x === 'number') ? opts.x : pad;
    this.anchorY = (typeof opts.y === 'number') ? opts.y : pad;

    this.container.setDepth(1000);

    this.style = Object.assign({
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: null,
      stroke: null,
      strokeThickness: 0
    }, opts.style || {});

    this._onResize = this._onResize.bind(this);
    if (this.scene && this.scene.scale && typeof this.scene.scale.on === 'function') {
      this.scene.scale.on('resize', this._onResize);
    }

    if (this.scene && this.scene.sys && this.scene.sys.events) {
      this.scene.sys.events.once('ready', this._onResize);
      // Some Phaser setups use 'create' instead of 'ready'
      this.scene.sys.events.once('create', this._onResize);
    }

    this._onResize();
    this.log('Console initiated')
  }

  _onResize() {
    const scale = this.scene && this.scene.scale;
    let width, height;

    if (scale && scale.displaySize && scale.displaySize.width && scale.displaySize.height) {
      width = scale.displaySize.width;
      height = scale.displaySize.height;
    } else if (scale && typeof scale.width === 'number' && typeof scale.height === 'number') {
      width = scale.width;
      height = scale.height;
    } else {
      width = this.scene.sys.game.config.width || 800;
      height = this.scene.sys.game.config.height || 600;
    }

    this.gameWidth = width;
    this.gameHeight = height;

    this._layoutMessages();
  }

  _acquireText() {
    let text = this.pool.pop();
    if (!text) {
      // origin left/top so we can position with x = pad and y = computed top
      text = this.scene.add.text(0, 0, '', this.style).setOrigin(0, 0);
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
    const color = (level === 'error') ? '#ff6666' : (level === 'warn') ? '#ffcc66' : (level === 'info') ? '#3be025' : '#ffffff';
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

    // Re-layout remaining messages so those below shift up immediately (preserves order)
    this._layoutMessages();
  }

  _layoutMessages() {
    // Desired group order (top -> bottom): log, warn, info, error
    const groupOrder = ['log', 'warn', 'info', 'error'];

    const groups = {};
    for (const level of groupOrder) groups[level] = [];
    for (const rec of this.active) {
      const lvl = rec.level || 'log';
      if (!groups[lvl]) groups[lvl] = [];
      groups[lvl].push(rec);
    }

    const ordered = [];
    for (const level of groupOrder) {
      ordered.push(...groups[level]);
    }

    const pad = this.pad || 12;
    const spacing = this.spacing;
    const gh = (typeof this.gameHeight === 'number') ? this.gameHeight : (this.scene.sys.game.config.height || 600);

    let totalHeight = 0;
    for (let i = 0; i < ordered.length; i++) {
      totalHeight += ordered[i].text.height;
      if (i < ordered.length - 1) totalHeight += spacing;
    }

    let y = gh - pad - totalHeight;
    const x = (typeof this.anchorX === 'number') ? this.anchorX : pad;

    for (let i = 0; i < ordered.length; i++) {
      const rec = ordered[i];
      const t = rec.text;
      t.setOrigin(0, 0);
      t.setPosition(x, Math.round(y));
      t.setAlpha(1);
      y += t.height + spacing;
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
    // unsubscribe resize listener
    if (this.scene && this.scene.scale && typeof this.scene.scale.off === 'function') {
      this.scene.scale.off('resize', this._onResize);
    }
    this.clear();
    for (const t of this.pool) {
      t.destroy();
    }
    this.pool.length = 0;
    this.container.destroy();
  }
}