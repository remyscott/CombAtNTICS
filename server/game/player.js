import tryHandleMessage from "../utilities/tryHandleMessage.js";
import { BouncySphere } from "./components/BouncySphere.js";
import { HoverSphere } from "./components/HoverSphere.js";
import { Sword } from "./components/Sword.js";

export class Player {
  constructor(ws, name, clientId, world, components = [HoverSphere, Sword]) {
    this.ws = ws;
    this.name = name;
    this.clientId = clientId;
    this.world = world;

    this.inputs = {};
    this.ws.on('message', (msg) => tryHandleMessage(msg, this.handleMessage.bind(this)));
    this.setUpComponents(components);
  }

  setUpComponents(components) {
    this.components = [];
    for (const component of components) {
      this.components.push(new component(this));
    }
  }

  handleMessage(msg) {
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
    for (const component of this.components) {
      if (typeof component.onDestroy === 'function') {
        component.onDestroy(this);
      }
    }
    this.components = [];
  }
}