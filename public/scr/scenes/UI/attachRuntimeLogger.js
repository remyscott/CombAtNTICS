export function attachRuntimeLogger(consoleSink, opts = {}) {
  const cfg = Object.assign({
    forwardConsole: true,
    captureErrors: true,
    captureRejections: true,
    maxMessageLength: 800,
    prefix: '[JS]'
  }, opts);

  // guard
  if (!consoleSink || typeof consoleSink.log !== 'function') {
    console.warn('attachRuntimeLogger: consoleSink must implement log/info/warn/error');
    return () => {};
  }

  // marker to avoid recursing into our own forwarded logs
  const INTERNAL_FLAG = Symbol.for('__GAME_CONSOLE_INTERNAL__');

  // Helpers
  function safeTruncate(s) {
    s = String(s);
    if (s.length > cfg.maxMessageLength) {
      return s.slice(0, cfg.maxMessageLength) + '…';
    }
    return s;
  }
  function formatArgs(args) {
    try {
      return args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }).join(' ');
    } catch (e) {
      return String(args);
    }
  }

  // wrap console.* methods
  const originals = {};
  if (cfg.forwardConsole && typeof window.console === 'object') {
    ['log', 'info', 'warn', 'error'].forEach(level => {
      originals[level] = console[level].bind(console);
      console[level] = function (...args) {
        // call original first so devtools still gets logs synchronously
        try { originals[level](...args); } catch (e) { /* ignore */ }

        // don't forward internal messages we post to the sink
        if (args && args.length && args[0] && args[0][INTERNAL_FLAG]) return;

        // prepare message and forward
        const msg = safeTruncate(formatArgs(args));
        try {
          // mark wrapper messages to prevent loops
          const wrapper = { [INTERNAL_FLAG]: true, text: msg };
          // forward according to level mapping
          if (level === 'error') consoleSink.error(wrapper.text, { level: 'error' });
          else if (level === 'warn') consoleSink.warn(wrapper.text, { level: 'warn' });
          else if (level === 'info') consoleSink.info(wrapper.text, { level: 'info' });
          else consoleSink.log(wrapper.text, { level: 'log' });
        } catch (e) {
          // if sink throws, call original error to make sure errors are visible
          try { originals.error('attachRuntimeLogger: sink error', e); } catch (ee) {}
        }
      };
    });
  }

  // window.onerror
  function onErrorHandler(ev) {
    try {
      // ev is an ErrorEvent or window.onerror args depending on browser
      const errMsg = ev && ev.message ? ev.message : (ev && ev.error && ev.error.message) || String(ev);
      const source = ev && ev.filename ? `${ev.filename}:${ev.lineno || ''}` : '';
      const stack = ev && ev.error && ev.error.stack ? `\n${ev.error.stack}` : '';
      const text = safeTruncate(`${cfg.prefix} ERROR: ${errMsg} ${source}${stack}`);
      consoleSink.error(text, { level: 'error' });
    } catch (e) {
      try { originals.error && originals.error('attachRuntimeLogger onErrorHandler failed', e); } catch (ee) {}
    }
  }

  // unhandled promise rejections
  function onRejectionHandler(ev) {
    try {
      const reason = ev && ev.reason ? ev.reason : ev;
      let msg;
      if (reason instanceof Error) {
        msg = `${cfg.prefix} UNHANDLED REJECTION: ${reason.message}\n${reason.stack || ''}`;
      } else {
        msg = `${cfg.prefix} UNHANDLED REJECTION: ${safeTruncate(formatArgs([reason]))}`;
      }
      consoleSink.error(msg, { level: 'error' });
    } catch (e) {
      try { originals.error && originals.error('attachRuntimeLogger onRejectionHandler failed', e); } catch (ee) {}
    }
  }

  // subscribe
  if (cfg.captureErrors) {
    window.addEventListener('error', onErrorHandler);
    // also try the global handler for older environments
    if (typeof window.onerror === 'function') {
      const prevOnErr = window.onerror;
      window.onerror = function (msg, src, line, col, err) {
        try { onErrorHandler({ message: msg, filename: src, lineno: line, colno: col, error: err }); } catch (e) {}
        try { return prevOnErr.apply(this, arguments); } catch (e) {}
      };
    }
  }
  if (cfg.captureRejections) {
    window.addEventListener('unhandledrejection', onRejectionHandler);
  }

  // return an unsubscribe function to restore originals and remove handlers
  return function detach() {
    try {
      if (cfg.forwardConsole && typeof window.console === 'object') {
        ['log', 'info', 'warn', 'error'].forEach(level => {
          if (originals[level]) window.console[level] = originals[level];
        });
      }
    } catch (e) { /* ignore */ }

    try {
      if (cfg.captureErrors) window.removeEventListener('error', onErrorHandler);
      if (cfg.captureRejections) window.removeEventListener('unhandledrejection', onRejectionHandler);
    } catch (e) { /* ignore */ }
  };
}