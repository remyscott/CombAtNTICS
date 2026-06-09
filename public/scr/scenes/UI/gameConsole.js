// GameConsole.js
export class GameConsole {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.opts = Object.assign({
      maxMessages: 50,
      ttl: 15000,
      spacing: 6,
      padding: 12,
      style: {},
      depth: 1000,
      forwardConsole: true,
      captureErrors: true,
      captureRejections: true,
      maxMessageLength: 800,
      prefix: '[JS]'
    }, opts);

    // attach on game for easy access
    if (this.scene && this.scene.sys && this.scene.sys.game) {
      this.scene.sys.game.console = this;
    }

    // state
    this.pool = [];
    this.active = [];
    this.pad = this.opts.padding;
    this.anchorX = (typeof opts.x === 'number') ? opts.x : this.pad;
    this.anchorY = (typeof opts.y === 'number') ? opts.y : this.pad;
    this.spacing = this.opts.spacing;
    this.maxMessages = this.opts.maxMessages;
    this.ttl = this.opts.ttl;

    // container for text
    this.container = (this.scene && this.scene.add) ? this.scene.add.container(0, 0).setDepth(this.opts.depth) : { add: () => {} };

    // style: merge user style onto defaults
    this.style = Object.assign({      fontSize: '28px',      color: '#ffffff',      backgroundColor: null,      stroke: '#000000',      strokeThickness: 2    }, opts.style || {});
    // resize handler bound
    this._onResize = this._onResize.bind(this);

    if (this.scene && this.scene.scale && typeof this.scene.scale.on === 'function') {
      this.scene.scale.on('resize', this._onResize);
    }
    if (this.scene && this.scene.sys && this.scene.sys.events) {
      this.scene.sys.events.once && this.scene.sys.events.once('ready', this._onResize);
      this.scene.sys.events.once && this.scene.sys.events.once('create', this._onResize);
    }

    // runtime logger attach
    this._detachRuntimeLogger = null;
    if (this.opts.forwardConsole || this.opts.captureErrors || this.opts.captureRejections) {
      this._detachRuntimeLogger = attachRuntimeLogger(this, {
        forwardConsole: this.opts.forwardConsole,
        captureErrors: this.opts.captureErrors,
        captureRejections: this.opts.captureRejections,
        maxMessageLength: this.opts.maxMessageLength,
        prefix: this.opts.prefix
      });
    }

    // initial layout & notify
    this._onResize();
    console.log('Console initiated');
  }

  /* ---------- layout & sizing ---------- */

  _onResize() {
    // compute usable width/height with multiple fallbacks
    const scale = this.scene && this.scene.scale;
    let width = 800, height = 600;

    if (scale && scale.displaySize && scale.displaySize.width && scale.displaySize.height) {
      width = scale.displaySize.width;
      height = scale.displaySize.height;
    } else if (scale && typeof scale.width === 'number' && typeof scale.height === 'number') {
      width = scale.width;
      height = scale.height;
    } else if (this.scene && this.scene.sys && this.scene.sys.canvas) {
      width = this.scene.sys.canvas.width;
      height = this.scene.sys.canvas.height;
    } else if (this.scene && this.scene.sys && this.scene.sys.game && this.scene.sys.game.config) {
      width = this.scene.sys.game.config.width || width;
      height = this.scene.sys.game.config.height || height;
    }

    this.gameWidth = width;
    this.gameHeight = height;
    this._layoutMessages();
  }

  _layoutMessages() {
    const pad = this.pad;
    const spacing = this.spacing;
    const gh = (typeof this.gameHeight === 'number') ? this.gameHeight : (this.scene && this.scene.sys && this.scene.sys.game.config.height) || 600;

    let totalHeight = 0;
    for (let i = 0; i < this.active.length; i++) {
      const rec = this.active[i];
      const recHeight = rec.elements.reduce((max, text) => Math.max(max, text.height || 0), 0);
      totalHeight += recHeight;
      if (i < this.active.length - 1) totalHeight += spacing;
    }

    let y = gh - pad - totalHeight;
    const x = (typeof this.anchorX === 'number') ? this.anchorX : pad;

    for (let i = 0; i < this.active.length; i++) {
      const rec = this.active[i];
      const recHeight = rec.elements.reduce((max, text) => Math.max(max, text.height || 0), 0);
      let offsetX = x;
      for (const text of rec.elements) {
        text.setOrigin(0, 0);
        text.setPosition(Math.round(offsetX), Math.round(y + Math.max(0, (recHeight - (text.height || 0)) / 2)));
        text.setAlpha(1);
        offsetX += text.width || 0;
      }
      y += recHeight + spacing;
    }
  }

  /* ---------- pooling ---------- */

  _acquireText() {
    let text = this.pool.pop();
    if (!text) {
      // use setStyle-friendly API depending on Phaser version
      text = this.scene.add.text(0, 0, '', this.style).setOrigin(0, 0);
    } else {
      // apply style & make visible again
      try { text.setStyle && text.setStyle(this.style); } catch (e) {}
      text.setVisible && text.setVisible(true);
    }
    this.container.add && this.container.add(text);
    return text;
  }

  _releaseText(text) {
    try {
      text.setVisible && text.setVisible(false);
      text.setText && text.setText('');
      this.container.remove && this.container.remove(text);
      this.pool.push(text);
    } catch (e) { /* ignore */ }
  }

  /* ---------- message splitting utility ---------- */

  _splitSegmentForWidth(segment, availableWidth) {
    if (!segment || !segment.text) return [segment];

    const tempText = this.scene.add.text(0, 0, '', Object.assign({}, this.style, segment.style || {}));
    tempText.setText(String(segment.text));

    if (tempText.width <= availableWidth) {
      tempText.destroy();
      return [segment];
    }

    const words = String(segment.text).split(' ');
    const result = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? currentLine + ' ' + word : word;
      tempText.setText(testLine);

      if (tempText.width <= availableWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          result.push({ text: currentLine, color: segment.color, style: segment.style });
        }
        currentLine = word;
      }
    }

    if (currentLine) {
      result.push({ text: currentLine, color: segment.color, style: segment.style });
    }

    tempText.destroy();
    return result;
  }

  /* ---------- public API ---------- */

  log(message, { level = 'log', ttl } = {}) {
    const lifetime = (typeof ttl === 'number') ? (ttl === 0 ? Infinity : ttl) : this.ttl;
    const availableWidth = Math.max(100, (typeof this.gameWidth === 'number' ? this.gameWidth : 800) - 2 * this.pad);
    const segmentColor = (level === 'error') ? '#ff6666' :
                         (level === 'warn')  ? '#ffcc66' :
                         (level === 'info')  ? '#3be025' : '#ffffff';

    const segments = Array.isArray(message) ? message : [{ text: String(message), color: segmentColor }];
    
    // Split each segment if it would exceed available width
    const splitSegments = [];
    for (const segment of segments) {
      const color = segment.color || segmentColor;
      const withColor = { ...segment, color };
      splitSegments.push(...this._splitSegmentForWidth(withColor, availableWidth));
    }

    // Create a separate record for each split segment (each becomes a console line)
    const records = [];
    for (const segment of splitSegments) {
      if (this.active.length >= this.maxMessages) {
        const oldest = this.active.shift();
        if (oldest && oldest.timer) {
          clearTimeout(oldest.timer);
          oldest.timer = null;
        }
        if (oldest && oldest.elements) {
          for (const element of oldest.elements) this._releaseText(element);
        }
      }

      const text = this._acquireText();
      const style = Object.assign({}, this.style, segment.style || {});
      const color = segment.color || style.color || segmentColor;
      try {
        text.setStyle && text.setStyle(style);
      } catch (e) { /* ignore style errors */ }
      try {
        if (typeof text.setColor === 'function') text.setColor(color);
        else text.setStyle && text.setStyle({ fill: color });
      } catch (e) {}
      text.setText && text.setText(String(segment.text || ''));

      const rec = {
        elements: [text],
        level,
        expiresAt: (lifetime === Infinity) ? Infinity : (Date.now() + lifetime),
        timer: null
      };

      this.active.push(rec);
      records.push(rec);

      if (lifetime !== Infinity) {
        rec.timer = setTimeout(() => { this._removeRecord(rec); }, Math.max(0, lifetime));
      } else {
        rec.timer = null;
      }
    }

    this._layoutMessages();
    return records.length > 0 ? records[records.length - 1] : null;
  }

  info(msg, opts) { return this.log(msg, Object.assign({ level: 'info' }, opts)); }
  warn(msg, opts) { return this.log(msg, Object.assign({ level: 'warn' }, opts)); }
  error(msg, opts) { return this.log(msg, Object.assign({ level: 'error' }, opts)); }

  _removeRecord(rec) {
    const idx = this.active.indexOf(rec);
    if (idx === -1) return;
    if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
    this.active.splice(idx, 1);
    if (rec.elements) {
      for (const element of rec.elements) this._releaseText(element);
    }
    this._layoutMessages();
  }

  updateRecord(rec, text, { level, ttl } = {}) {
    if (!rec || !rec.elements || rec.elements.length !== 1) return;
    const element = rec.elements[0];
    element.setText(String(text));
    if (level) {
      rec.level = level;
      const color = (level === 'error') ? '#ff6666' : (level === 'warn') ? '#ffcc66' : (level === 'info') ? '#3be025' : '#ffffff';
      try {
        if (typeof element.setColor === 'function') element.setColor(color);
        else element.setStyle && element.setStyle({ fill: color });
      } catch (e) {}
    }

    if (typeof ttl === 'number') {
      if (rec.timer) clearTimeout(rec.timer);
      if (ttl > 0) {
        rec.expiresAt = Date.now() + ttl;
        rec.timer = setTimeout(() => this._removeRecord(rec), ttl);
      } else {
        rec.expiresAt = Infinity;
        rec.timer = null;
      }
    }

    this._layoutMessages();
  }

  clear() {
    for (const rec of this.active) {
      clearTimeout(rec.timer);
      if (rec.elements) {
        for (const element of rec.elements) this._releaseText(element);
      }
    }
    this.active.length = 0;
  }

  /* ---------- lifecycle ---------- */

  destroy() {
    // detach runtime logger and restore console
    if (this._detachRuntimeLogger) {
      try { this._detachRuntimeLogger(); } catch (e) {}
      this._detachRuntimeLogger = null;
    }

    // unsubscribe resize listener
    if (this.scene && this.scene.scale && typeof this.scene.scale.off === 'function') {
      this.scene.scale.off('resize', this._onResize);
    }

    this.clear();
    for (const t of this.pool) {
      try { t.destroy && t.destroy(); } catch (e) {}
    }
    this.pool.length = 0;
    try { this.container && this.container.destroy && this.container.destroy(); } catch (e) {}
  }
}

/* ---------- runtime logger helper (internal) ---------- */

function attachRuntimeLogger(consoleSink, opts = {}) {
  const cfg = Object.assign({
    forwardConsole: true,
    captureErrors: true,
    captureRejections: true,
    maxMessageLength: 800,
    prefix: '[JS]'
  }, opts);

  if (!consoleSink || typeof consoleSink.log !== 'function') {
    console.warn('attachRuntimeLogger: consoleSink must implement log/info/warn/error');
    return () => {};
  }

  const INTERNAL_FLAG = Symbol.for('__GAME_CONSOLE_INTERNAL__');

  function safeTruncate(s) {
    s = String(s);
    if (s.length > cfg.maxMessageLength) return s.slice(0, cfg.maxMessageLength) + '…';
    return s;
  }

  function formatArgs(args) {
    try {
      return args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }).join(' ');
    } catch (e) { return String(args); }
  }

  // wrap console methods
  const originals = {};
  if (cfg.forwardConsole && typeof window.console === 'object') {
    ['log', 'info', 'warn', 'error'].forEach(level => {
      originals[level] = console[level].bind(console);
      console[level] = function (...args) {
        try { originals[level](...args); } catch (e) {}
        if (args && args[0] && args[0][INTERNAL_FLAG]) return;
        const msg = safeTruncate(formatArgs(args));
        try {
          const wrapper = { [INTERNAL_FLAG]: true, text: msg };
          if (level === 'error') consoleSink.error(wrapper.text, { level: 'error' });
          else if (level === 'warn') consoleSink.warn(wrapper.text, { level: 'warn' });
          else if (level === 'info') consoleSink.info(wrapper.text, { level: 'info' });
          else {}; //dont copy logs //consoleSink.log(wrapper.text, { level: 'log' });
        } catch (e) {
          try { originals.error && originals.error('attachRuntimeLogger: sink error', e); } catch (ee) {}
        }
      };
    });
  }

  // error / rejection handlers
  function onErrorHandler(ev) {
    try {
      const errMsg = ev && ev.message ? ev.message : (ev && ev.error && ev.error.message) || String(ev);
      const source = ev && ev.filename ? `${ev.filename}:${ev.lineno || ''}` : '';
      const stack = ev && ev.error && ev.error.stack ? `\n${ev.error.stack}` : '';
      const text = safeTruncate(`${cfg.prefix} ERROR: ${errMsg} ${source}${stack}`);
      consoleSink.error(text, { level: 'error' });
    } catch (e) {
      try { originals.error && originals.error('attachRuntimeLogger onErrorHandler failed', e); } catch (ee) {}
    }
  }

  function onRejectionHandler(ev) {
    try {
      const reason = ev && ev.reason ? ev.reason : ev;
      let msg;
      if (reason instanceof Error) msg = `${cfg.prefix} UNHANDLED REJECTION: ${reason.message}\n${reason.stack || ''}`;
      else msg = `${cfg.prefix} UNHANDLED REJECTION: ${safeTruncate(formatArgs([reason]))}`;
      consoleSink.error(msg, { level: 'error' });
    } catch (e) {
      try { originals.error && originals.error('attachRuntimeLogger onRejectionHandler failed', e); } catch (ee) {}
    }
  }

  if (cfg.captureErrors) {
    window.addEventListener('error', onErrorHandler);
    // preserve old onerror if present
    if (typeof window.onerror === 'function') {
      const prev = window.onerror;
      window.onerror = function (msg, src, line, col, err) {
        try { onErrorHandler({ message: msg, filename: src, lineno: line, colno: col, error: err }); } catch (e) {}
        try { return prev.apply(this, arguments); } catch (e) {}
      };
    }
  }

  if (cfg.captureRejections) {
    window.addEventListener('unhandledrejection', onRejectionHandler);
  }

  // detach function restores original state
  return function detach() {
    try {
      if (cfg.forwardConsole && typeof window.console === 'object') {
        ['log', 'info', 'warn', 'error'].forEach(level => {
          if (originals[level]) window.console[level] = originals[level];
        });
      }
    } catch (e) {}
    try {
      if (cfg.captureErrors) window.removeEventListener('error', onErrorHandler);
      if (cfg.captureRejections) window.removeEventListener('unhandledrejection', onRejectionHandler);
    } catch (e) {}
  };
}