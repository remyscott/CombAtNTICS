// phaserInputAdapter.js
export class PhaserInputAdapter {
  constructor(scene, initialBindings = {}) {
    this.scene = scene;
    // action -> code (KeyboardEvent.code or 'Mouse0'..'MouseN')
    this.bindings = { ...initialBindings };

    // runtime pressed set of codes (e.g., 'KeyA', 'ArrowUp', 'Mouse0')
    this._pressedCodes = new Set();

    // store handlers so we can remove them on destroy
    this._handlers = {
      keydown: this._onKeyDown.bind(this),
      keyup: this._onKeyUp.bind(this),
      pointerdown: this._onPointerDown.bind(this),
      pointerup: this._onPointerUp.bind(this),
      blur: this._onBlur.bind(this)
    };

    // Keyboard via Phaser KeyboardPlugin events
    this.scene.input.keyboard.on('keydown', this._handlers.keydown);
    this.scene.input.keyboard.on('keyup', this._handlers.keyup);

    // Pointer events for mouse buttons; Phaser normalizes pointer.button (0,1,2)
    this.scene.input.on('pointerdown', this._handlers.pointerdown);
    this.scene.input.on('pointerup', this._handlers.pointerup);

    // Clear on window blur
    window.addEventListener('blur', this._handlers.blur);
  }

  destroy() {
    // remove listeners
    try {
      this.scene.input.keyboard.off('keydown', this._handlers.keydown);
      this.scene.input.keyboard.off('keyup', this._handlers.keyup);
      this.scene.input.off('pointerdown', this._handlers.pointerdown);
      this.scene.input.off('pointerup', this._handlers.pointerup);
    } catch (e) {
      // ignore if scene already destroyed
    }
    window.removeEventListener('blur', this._handlers.blur);
    this._pressedCodes.clear();
  }

  updateBindings(newBindings) {
    this.bindings = { ...newBindings };
  }

  // Returns true if the action's bound code is currently held down (keyboard or mouse)
  isActionDown(action) {
    const code = this.bindings[action];
    if (!code) return false;
    return this._pressedCodes.has(code);
  }

  // Convenience: call handler when action becomes pressed.
  // Handler receives (action, eventLike) where eventLike is the original event or a small object for mouse.
  // Returns a teardown function.
  onActionDown(action, handler) {
    // support both keyboard and mouse by listening to both event sources
    const wrappedKey = (phaserEv) => {
      const ev = phaserEv.event ?? phaserEv;
      if (ev && ev.code === this.bindings[action]) handler(action, ev);
    };
    const wrappedPointer = (pointer) => {
      // Phaser Pointer has .button for the button number when pointerdown fired
      const mouseCode = `Mouse${pointer.button}`;
      if (mouseCode === this.bindings[action]) {
        // create a small event-like object
        handler(action, { type: 'pointer', button: pointer.button, pointer });
      }
    };

    this.scene.input.keyboard.on('keydown', wrappedKey);
    this.scene.input.on('pointerdown', wrappedPointer);

    // return teardown
    return () => {
      this.scene.input.keyboard.off('keydown', wrappedKey);
      this.scene.input.off('pointerdown', wrappedPointer);
    };
  }

  // --- Internal handlers -------------------------------------------------

  _onKeyDown(phaserKeyboardEvent) {
    const ev = phaserKeyboardEvent.event ?? phaserKeyboardEvent;
    if (!ev || !ev.code) return;
    this._pressedCodes.add(ev.code);
  }

  _onKeyUp(phaserKeyboardEvent) {
    const ev = phaserKeyboardEvent.event ?? phaserKeyboardEvent;
    if (!ev || !ev.code) return;
    this._pressedCodes.delete(ev.code);
  }

  _onPointerDown(pointer) {
    // pointer.button: 0 = left, 1 = middle, 2 = right
    // Some Phaser builds provide pointer.event with original DOM MouseEvent as well.
    const btn = pointer.button ?? (pointer.event && pointer.event.button);
    if (typeof btn !== 'number') return;
    this._pressedCodes.add(`Mouse${btn}`);
  }

  _onPointerUp(pointer) {
    const btn = pointer.button ?? (pointer.event && pointer.event.button);
    if (typeof btn !== 'number') return;
    this._pressedCodes.delete(`Mouse${btn}`);
  }

  _onBlur() {
    this._pressedCodes.clear();
  }
}