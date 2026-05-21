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

    // delegate sending to game.client
    this.client = (this && this.game && this.game.client) ? this.game.client : null;
  }

  _onKey(e) {
    if (!this._chatActive) {
      if (e.key === '/' || e.key === 'Enter') { e.preventDefault(); this._open(); }
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

  // Delegate sending to game.client.sendMessage(payload). Do NOT display the message locally here.
  _send(text) {
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
  displayMessage(msg, nameOfSender) {
    const myName = (this && this.game && this.game.client) ? this.game.client.name : null;
    if (myName && nameOfSender === myName) {
      this.console.log(`you: ${msg}`);
    } else {
      this.console.log(`${nameOfSender}: ${msg}`);
    }
  }

  destroy() {
    window.removeEventListener('keydown', this._onKey, { capture: true });
  }
}