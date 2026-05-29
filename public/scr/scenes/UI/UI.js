// UI.js (barebones — no optimistic echo)
import { GameConsole } from "./gameConsole.js";

export class UI extends Phaser.Scene {
  constructor() {
    super({ key: 'UI', active: true });
    this._chatActive = false;
    this._chatBuf = '';
    this._chatRec = null;
    this._onKey = this._onKey.bind(this);
  }

  create() {
    this.input.mouse.disableContextMenu();
    this.console = new GameConsole(this);
    window.addEventListener('keydown', this._onKey, { capture: true });

    this.client = this.game.client;

    const inWorldScene = this.game.scene.getScene('InWorldObjects');
    if (inWorldScene && inWorldScene.cameras && inWorldScene.cameras.main) {
      inWorldScene.cameras.main.setZoom(localStorage.getItem('zoom') || 1) ;
    }
    this.console.style.fontSize = String(Math.round(localStorage.getItem('uiscale')*28 || 28))+ 'px';
  }

  _onKey(e) {
    if (!this._chatActive) {
      if (e.key === '/' || e.key === 'Enter') { e.preventDefault(); this._open(); }
      if (e.key === '/') this._chatBuf += e.key;
      this._update();
      return;
    }

    e.preventDefault();

    if (e.key === 'Enter') { if (this._chatBuf.trim()) this._send(this._chatBuf.trim()); this._close(); return; }
    if (e.key === 'Escape') { this._close(); return; }
    if (e.key === 'Backspace') { this._chatBuf = this._chatBuf.slice(0, -1); this._update(); return; }

    if (typeof e.key === 'string' && e.key.length === 1) {
      this._chatBuf += e.key;
      this._update();
    }
  }

  _open() {
    this._chatActive = true;
    this._chatBuf = '';
    this._chatRec = this.console.log(`> ${this._chatBuf}`, { level: 'log', ttl: 0 });
  }

  _update() {
    if (this._chatRec) this.console.updateRecord(this._chatRec, `> ${this._chatBuf}`, { ttl: 0 });
  }

  _close() {
    this._chatActive = false;
    if (this._chatRec) { this.console.updateRecord(this._chatRec, '', { ttl: 1 }); this._chatRec = null; }
    this._chatBuf = '';
  }

  // Handle local commands on client side, forward others to server
  _send(text) {
    // Check for local commands
    const parts = text.trim().split(/\s+/);
    const command = parts[0];

    if (command === '/zoom') {
      let zoomLevel = parseFloat(parts[1]);
      if (!zoomLevel) {
        zoomLevel = 1;
      }
      if (isNaN(zoomLevel) || zoomLevel <= 0) {
        this.console.log('Usage: /zoom level (e.g., /zoom 1.5)', { level: 'warn' });
        return;
      }
      try {
        localStorage.setItem('zoom', zoomLevel)
        const inWorldScene = this.game.scene.getScene('InWorldObjects');
        if (inWorldScene && inWorldScene.cameras && inWorldScene.cameras.main) {
          inWorldScene.cameras.main.setZoom(zoomLevel);
          this.console.log(`Zoom set to ${zoomLevel}x`, { level: 'info' });
        }
      } catch (err) {
        this.console.log(`Zoom failed: ${err.message}`, { level: 'error' });
      }
      return;
    }
    if (command === '/uiscale') {
      let zoomLevel = parseFloat(parts[1]);
      if (!zoomLevel) {
        zoomLevel = 1;
      }
      if (isNaN(zoomLevel) || zoomLevel <= 0) {
        this.console.log('Usage: /uiscale level (e.g., /zoom 1.5)', { level: 'warn' });
        return;
      }
      try {
        localStorage.setItem('uiscale', zoomLevel)
        this.console.style.fontSize = String(Math.round(localStorage.getItem('uiscale')*28 || 28))+ 'px';
        this.console.log(`uiscale set to ${zoomLevel}x`, { level: 'info' });

      } catch (err) {
        this.console.log(`Zoom failed: ${err.message}`, { level: 'error' });
      }
      return;
    }
    
    // Send other messages to server
    const payload = { type: 'chatMsg', msg: text };
    try {
      if (this.client && typeof this.client.sendMessage === 'function') {
        this.client.sendMessage(payload);
      } else {
        // no client available — do nothing (no local display)
      }
    } catch (err) {
      // show failure only
      this.console.log(`you: ${text} (failed)`, { level: 'error' });
    }
  }

  // Called by external code when a broadcast arrives:
  // game.scene.keys.UI.displayMessage(payload.msg, payload.nameOfSender)
  displayMessage(msg, nameOfSender, senderRoles) {
    const myName = (this && this.game && this.game.client) ? this.game.client.name : null;
    if (myName && nameOfSender === myName) {
      this.console.log([
        { text: 'you: ', color: '#78c7ff' },
        { text: msg, color: '#ffffff' }
      ]);
      return;
    }

    const roles = [];
    if (Array.isArray(senderRoles)) {
      for (const role of senderRoles) {
        if (typeof role === 'string') {
          const trimmed = role.trim().toLowerCase();
          if (trimmed) roles.push(trimmed);
        }
      }
    } else if (typeof senderRoles === 'string' && senderRoles.trim()) {
      for (const role of senderRoles.split(',')) {
        const trimmed = String(role || '').trim().toLowerCase();
        if (trimmed) roles.push(trimmed);
      }
    }

    const uniqueRoles = [...new Set(roles)];
    const segments = [];
    const roleColor = uniqueRoles.includes('admin') ? '#ff8a8a' : uniqueRoles.includes('mod') ? '#ffe599' : '#b3d9ff';
    if (uniqueRoles.length) {
      segments.push({ text: `{${uniqueRoles.join(', ')}} `, color: roleColor });
    }
    segments.push({ text: `${nameOfSender}: `, color: uniqueRoles.length ? roleColor : '#e0e0ff' });
    segments.push({ text: msg, color: '#ffffff' });
    this.console.log(segments);
  }

  destroy() {
    window.removeEventListener('keydown', this._onKey, { capture: true });
  }
}