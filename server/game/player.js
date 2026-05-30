import tryHandleMessage from "../utilities/tryHandleMessage.js";
import accounts from "../accounts-sqlite.js";
import { HoverSphere } from "./components/HoverSphere.js";
import { Sword } from "./components/Sword.js";
import { configurableInputs } from "../../shared/inputsListing.js";
import { Dash } from "./components/Dash.js";

import { addRandomGunToComponentList, BlockMinigun, BlockSniper } from "./components/BlockGuns.js";
import { SwordBig } from "./components/SwordBig.js";
import { TitaniumCore } from "./components/TitaniumCore.js";
import { componentMap, componentList } from "./componentMap.js";
import { CommandInterpretor } from "./commands.js"
function chance(chance) {
  return (Math.random() < chance);
}

export function randomComponents() {
  const components = [];

    components.push(HoverSphere);


    if (chance(0.4)) {
      if (chance(0.3)) {
        components.push(SwordBig);
        components.push(TitaniumCore);
      } else {
        components.push(Sword);
      }
    } else {
      addRandomGunToComponentList(components);
    }

    if (chance(0.5)) {
      components.push(Dash);
    }


    return components;
}

export class Player {
  constructor(ws, game, components = null) {
    // choose components (kept original logic)
    if (!components) components = randomComponents();
    this.ws = null;
    this.name = null;
    this.world = game.world;
    this.game = game;
    this.inputs = null;
    this.clientId = null;
    this.chatBanned = false;
    this._disconnectTimer = 5;
    this.commandInterpretor = new CommandInterpretor(this);

    if (ws) {
      this.attachWS(ws);
    }

    this.componentClasses = (components || []).slice();
    this.setUpComponents(this.componentClasses);

  }

  getBodyId() {
    return this.body.getUserData().id;
  }

  sendBodyId() {
    this.ws.send(JSON.stringify({ type: 'playerBodyId', id: this.getBodyId() }));
  }

  destroyComponents() {
    try {
      for (const component of this.components) {
        try {
          if (typeof component.onDestroy === 'function') component.onDestroy(this);
        } catch (e) {
          console.error('component onDestroy error during respawn', e);
        }
      }
    } catch (e) {
      console.log(e)
    }
  }

  respawn() {
    this.destroyComponents()
 
    // Recreate components and body
    try {
      this.setUpComponents(this.componentClasses || [HoverSphere, Dash]);
    } catch (e) {
      console.error('Failed to set up components during respawn', e);
    }

    this.sendBodyId();
  }

  attachWS(ws) {
    if (!ws) return;

    if (this.ws && this.ws !== ws) {
      this.detachWS();
    }

    this.ws = ws;

    try {
      if (ws.account) {
        this.name = ws.account.displayName || this.name;
        this.chatBanned = !!ws.account.chatBanned;
        this.account = ws.account;
        if (!Array.isArray(this.account.roles) && this.account.role) {
          this.account.roles = String(this.account.role).split(',').map((r) => String(r || '').trim().toLowerCase()).filter(Boolean);
        }
      }
    } catch (e) {
    }

    this._onMessage = (msg) => tryHandleMessage(msg, this.handleMessage.bind(this));
    this._onOpen = () => this.sendInit();
    this._onClose = (code, reason) => {
    };
    this._onError = (err) => {
      console.warn('Player ws error', err);
    };

    if (typeof ws.on === 'function') {
      ws.on('message', this._onMessage);
      ws.on('open', this._onOpen);
      ws.on('close', this._onClose);
      ws.on('error', this._onError);
    } else if (typeof ws.addEventListener === 'function') {
      ws.addEventListener('message', this._onMessage);
      ws.addEventListener('open', this._onOpen);
      ws.addEventListener('close', this._onClose);
      ws.addEventListener('error', this._onError);
    }

    this._wsOpenConst = (this.ws && this.ws.OPEN) || 1; // fallback
  }

  detachWS() {
    if (!this.ws) return;

    try {
      if (typeof this.ws.removeListener === 'function') {
        if (this._onMessage) this.ws.removeListener('message', this._onMessage);
        if (this._onOpen) this.ws.removeListener('open', this._onOpen);
        if (this._onClose) this.ws.removeListener('close', this._onClose);
        if (this._onError) this.ws.removeListener('error', this._onError);
        if (typeof this.ws.removeAllListeners === 'function') {
        }
      } else if (typeof this.ws.removeEventListener === 'function') {
        if (this._onMessage) this.ws.removeEventListener('message', this._onMessage);
        if (this._onOpen) this.ws.removeEventListener('open', this._onOpen);
        if (this._onClose) this.ws.removeEventListener('close', this._onClose);
        if (this._onError) this.ws.removeEventListener('error', this._onError);
      }

      const OPEN = this.ws.OPEN ?? 1;
      const CLOSING = this.ws.CLOSING ?? 2;
      const CLOSED = this.ws.CLOSED ?? 3;

      if (this.ws.readyState === OPEN) {
        try {
          this.ws.close(1000, 'server disconnect');
        } catch (e) {
          // ignore
        }

        const FORCE_TIMEOUT = 2000;
        const wsRef = this.ws;
        const force = setTimeout(() => {
          try {
            if (wsRef && wsRef.terminate) wsRef.terminate();
          } catch (e) {}
        }, FORCE_TIMEOUT);

        if (typeof this.ws.once === 'function') {
          this.ws.once('close', () => clearTimeout(force));
        } else if (typeof this.ws.addEventListener === 'function') {
          const onClose = () => {
            clearTimeout(force);
            try { this.ws.removeEventListener('close', onClose); } catch (e) {}
          };
          this.ws.addEventListener('close', onClose);
        }
      } else if (this.ws.readyState === CLOSING) {
        setTimeout(() => {
          try { if (this.ws && this.ws.terminate) this.ws.terminate(); } catch (e) {}
        }, 2000);
      } else if (this.ws.readyState === CLOSED) {
        // already closed
      } else {
        try { if (this.ws.terminate) this.ws.terminate(); } catch (e) {}
      }
    } catch (e) {
      console.error('Error while detaching websocket for player', e);
      try { if (this.ws && this.ws.terminate) this.ws.terminate(); } catch (e2) {}
    } finally {
      this._onMessage = null;
      this._onOpen = null;
      this._onClose = null;
      this._onError = null;
      this.ws = null;
    }
  }

  setUpComponents(components) {
    this.body = this.world.createBody({
      type: "dynamic",
      position: { x: 0, y: 0 },
      userData: { owner: this }
    });

    this.components = [];
    for (const component of components) {
      this.components.push(new component(this));
    }

    const fixture = this.body.getFixtureList();
    if (fixture) fixture.setUserData({...fixture.getUserData(), name: this.name})
    this.world.registerBody(this.body);

    const mainGravityScale = this.body.getGravityScale();
    for (const component of this.components) {
      if (component.body) component.body.setGravityScale(mainGravityScale);
    }
  }

  handleMessage(msg) {
    if (!msg) return;
    if (msg.type === 'chatMsg') {
      if (msg.msg.startsWith('/')) {
        this.commandInterpretor.interpret(msg.msg);
        return;
      }
      if (this.chatBanned) return;

      this.game.onClientChat({ type: 'chatMsg', msg: msg.msg, nameOfSender: this.name, senderRoles: this.account.roles }, this.account.username);
    } else if (msg.type === 'input') {
      this.inputs = msg.inputs;
    } else if (msg.type === 'timeSync') {
      this.ws.send(JSON.stringify({ type: 'timeSyncResp', serverTime: Date.now(), id: msg.id }));
    } else if (msg.type === 'metadataRequest') {
      this.ws.send(JSON.stringify({ type: 'metadataResponse', metadata: this.world.metadata }));
    }
    
  }

  

  sendInit() {
    try {
      const payload = {
        type: "init",
        clientId: this.clientId,
        name: this.name,
        bodyId: this.getBodyId()
      };
      this.ws.send(JSON.stringify(payload));
    } catch (e) {
      // body or userData missing; ignore
    }
  }

  getSnapshot() {
    try {
      const meta = this.body.getUserData();
      const pos = this.body.getPosition();
      const angle = this.body.getAngle();
      const { owner, ...withoutOwner } = meta;
      return {
        state: {
          id: meta.id,
          state: {
            pos,
            angle
          },
        },
        metadata: { name: this.name, ...withoutOwner }
      };
    } catch (e) {
      return null;
    }
  }

  update() {
    if (!this.ws) {
      this._disconnectTimer -= 1/60;
      if (this._disconnectTimer <= 0) {
        this.game.removePlayer(this.account.username);
      }
    } else {
      this._disconnectTimer = 5;
    }
  
    for (const component of this.components) {
      if (typeof component.update === 'function') {
        component.update();
      }
    }
  }

  applyInputs() {
    if (this.inputs && this.inputs.actions && this.inputs.default) {
      for (const component of this.components) {
        if (typeof component.applyInputs === 'function') {
          component.applyInputs(this.inputs);
        }
      }
    }
  }

  destroy() {
    try {
      for (const component of this.components) {
        if (typeof component.onDestroy === 'function') {
          component.onDestroy(this);
        }
      }
    } catch (e) {
      console.error('Error during player component cleanup', e);
    } finally {
      this.components = [];
    }

    this.detachWS();
  }

  die() {
    this.respawn();
  }
}