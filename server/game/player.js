import tryHandleMessage from "../utilities/tryHandleMessage.js";
import { BouncySphere } from "./components/BouncySphere.js";
import { HoverSphere } from "./components/HoverSphere.js";
import { Sword } from "./components/Sword.js";
import { BlockLauncher } from "./components/BlockLauncher.js";

export class Player {
  constructor(ws, name, clientId, game, components = [HoverSphere]) {
    if (Math.random()>0.5) {
      components.push(Sword);
    }
    else {
      components.push(BlockLauncher)
    }
    this.ws = ws;
    this.name = name;
    this.clientId = clientId;
    this.world = game.world;
    this.game = game;
    this.inputs = {};
    this.ws.on('message', (msg) => tryHandleMessage(msg, this.handleMessage.bind(this)));
    this.setUpComponents(components);
    this.chatBanned = false;
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

    const mainGravityScale = this.body.getGravityScale();
    for (const component of this.components) {
      if (component.body) component.body.setGravityScale(mainGravityScale);
    }
  }

  handleMessage(msg) {
    if (msg.type === 'chatMsg') {
      if(this.chatBanned) return;
      this.game.onClientChat({type: 'chatMsg', msg: msg.msg, nameOfSender: this.name}, this.clientId)
    }
    if (msg.type === 'input') {
      this.inputs = msg.inputs;
    }
    if (msg.type === 'timeSync') {
      this.send({type: 'timeSyncResp', serverTime: Date.now(), id: msg.id});
    }
    if (msg.type === 'metadataRequest') {
      this.send({type: 'metadataResponse', metadata: this.world.objectMetadata});
    }
  }

  sendInit() {
    const payload = {
      type: "init",
      clientId: this.clientId,
      name: this.name,
      bodyId: this.body.getUserData().id
    };
    this.send(payload);
  }

  send(msg) {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  getSnapshot() {
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
      metadata: {name: this.name, ...withoutOwner}
    }
  }

  applyInputs() { 
    for (const component of this.components) {
      if (typeof component.applyInputs === 'function') {
        component.applyInputs(this.inputs);
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

    if (!this.ws) return;

    try {
      if (typeof this.ws.removeAllListeners === 'function') {
        this.ws.removeAllListeners('message');
        this.ws.removeAllListeners('error');
        this.ws.removeAllListeners('close');
      }

      const OPEN = this.ws.OPEN;  
      const CLOSING = this.ws.CLOSING ?? 2;
      const CLOSED = this.ws.CLOSED ?? 3;

      if (this.ws.readyState === OPEN) {
        try {
          this.ws.close(1000, 'server disconnect'); // normal closure
        } catch (e) {
        }

        const FORCE_TIMEOUT = 2000; // ms
        const wsRef = this.ws;
        const force = setTimeout(() => {
          try {
            if (wsRef && wsRef.terminate) wsRef.terminate();
          } catch (e) { /* ignore */ }
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
      } else {
        try { if (this.ws.terminate) this.ws.terminate(); } catch (e) {}
      }
    } catch (e) {
      console.error('Error while shutting down websocket for player', e);
      try { if (this.ws && this.ws.terminate) this.ws.terminate(); } catch (e2) {}
    } finally {
      this.ws = null;
    }
  }
}