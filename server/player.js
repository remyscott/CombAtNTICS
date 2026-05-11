import parseMsg from "./parseMessage.js";
import { Vec2 } from 'planck';
import { normalize, mulScalar, length } from './vec2helpers.js'

export class Player{
  constructor(ws, name, clientId) {
    this.ws = ws;
    this.name = name;
    this.clientId = clientId;
    this.inputs = {};
    this.ws.on('message', (msg) => this.handleMessage(parseMsg(msg)));
    this.body = null;
  }

  handleMessage(msg) {
    if (msg.type === 'input') {
      this.inputs = msg.inputs;
    }

    if (msg.type === 'timeSync') {
      this.send({type: 'timeSyncResp', serverTime: Date.now(), id: msg.id});
    }
  }

  sendInit() {
    const payload = {
      type: "init",
      clientOd: this.clientId,
      name: this.name,

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

  applyForceTowardsMouse() {
    if (!this.inputs.mousePos || !this.body) return;
    const mousePos = this.inputs.mousePos;
    const pos = this.body.getPosition();
    let d = Vec2(mousePos.x - pos.x, mousePos.y - pos.y);
    
    let multiplier = 0.1/length(d);

    this.body.applyForce(mulScalar(normalize(d), 20), this.body.getWorldPoint(Vec2(0,0)));
    
    this.body.setLinearVelocity(mulScalar(this.body.getLinearVelocity(),Math.max(0,1-multiplier)));
  }
}