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
import { Spider } from "./components/Spider.js";

function chance(chance) {
  return (Math.random() < chance);
}

export class Player {
  constructor(ws, game, components = []) {
    // choose components (kept original logic)
    if (chance(0.8)) {
      components.push(HoverSphere);
    } else {
      components.push(Spider) 
      if (chance(0.5)) {
        components.push(TitaniumCore);
      }
    }

    if (chance(0.3)) {
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
      components.push(Dash)
    }
    this.ws = null;
    this.name = null;
    this.world = game.world;
    this.game = game;
    this.inputs = null;
    this.clientId = null;
    this.chatBanned = false;
    this._disconnectTimer = 5;

    if (ws) {
      this.attachWS(ws);
    }

    this.componentClasses = (components || []).slice();
    this.setUpComponents(this.componentClasses);

  }

  // Respawn the player's physical body and components without detaching WS
  respawn() {
    try {
      // Call onDestroy for existing component instances (but keep ws/account)
      for (const component of this.components) {
        try {
          if (typeof component.onDestroy === 'function') component.onDestroy(this);
        } catch (e) {
          console.error('component onDestroy error during respawn', e);
        }
      }
    } catch (e) {
      // ignore
    }

    // Destroy existing physics body if present
    try {
      if (this.body) {
        try {
          if (this.world && typeof this.world.destroyBody === 'function') {
            this.world.destroyBody(this.body);
          } else if (this.body && typeof this.body.getWorld === 'function') {
            const w = this.body.getWorld();
            if (w && typeof w.destroyBody === 'function') w.destroyBody(this.body);
          }
        } catch (e) {
          console.warn('Failed to destroy old body during respawn', e);
        }
        this.body = null;
      }
    } catch (e) {}

    // Recreate components and body
    try {
      this.setUpComponents(this.componentClasses || [HoverSphere, Dash]);
    } catch (e) {
      console.error('Failed to set up components during respawn', e);
    }
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

    this.ws.send(JSON.stringify({ type: 'cameraFocusId', id: this.body.getUserData().id }));
  }

  handleMessage(msg) {
    if (!msg) return;
    if (msg.type === 'chatMsg') {
      if (msg.msg.startsWith('/')) {
        this.interpretCommand(msg.msg);
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

  interpretCommand(string) {
    const roleRank = (r) => ({ player: 0, mod: 1, admin: 2 }[r] ?? 0);
    const normalizeRoleInput = (raw) => {
      if (Array.isArray(raw)) return raw;
      if (!raw) return ['player'];
      return String(raw).split(',').map((role) => String(role || '').trim().toLowerCase()).filter(Boolean);
    };
    const highestRoleRank = (roles) => Math.max(0, ...normalizeRoleInput(roles).map(roleRank));
    const hasRole = (userRoles, requiredRole) => highestRoleRank(userRoles) >= roleRank(requiredRole);
    const resolvePlayer = (identifier) => {
      if (!identifier) return null;
      const key = String(identifier).trim();
      // Support @s for self
      if (key === '@s') return this;
      if (this.game.players.has(key)) return this.game.players.get(key);
      const lower = key.toLowerCase();
      for (const player of this.game.players.values()) {
        if (player.account?.username?.toLowerCase() === lower) return player;
        if (player.account?.displayName?.toLowerCase() === lower) return player;
        if (player.name?.toLowerCase() === lower) return player;
      }
      return null;
    };

    const leave = {
      requiredRole: 'player',
      function: () => {
        if (!this.game.players.has(this.account.username)) {
          try {
            this.ws?.send(JSON.stringify({ type: 'chatMsg', msg: 'You have left the game.', nameOfSender: 'SERVER' }));
          } catch (err) {
            // ignore
          }
          return;
        }
        this.game.removePlayer(this.account.username);
      },
      description: 'Leave the game and return to the lobby'
    }

    const commands = {
      '/banWord': {
        requiredRole: 'mod+',
        function: (...words) => {
          try {
            // normalize words: split if a single string with spaces, trim and lowercase
            const normalized = words
              .flatMap(w => typeof w === 'string' ? w.split(/\s+/) : [])
              .map(w => String(w).trim().toLowerCase())
              .filter(Boolean);

            if (normalized.length === 0) {
              this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Usage: /banWord word [word2 ...]', nameOfSender: 'SERVER' }));
              return;
            }

            // call addWords with individual args (not as a single array)
            this.game.chatFilter.addWords(...normalized);

            // persist change (example: write to a JSON file of extra words)
            try {
              const fs = require('fs');
              const path = require('path');
              const DATA_FILE = path.join(process.cwd(), 'config', 'custom-badwords.json');
              let current = [];
              if (fs.existsSync(DATA_FILE)) {
                try { current = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '[]'); } catch(e){ current = []; }
              }
              // merge uniquely
              const merged = Array.from(new Set([...current.map(s => s.toLowerCase()), ...normalized]));
              fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
              fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf8');
            } catch (persistErr) {
              console.warn('Failed to persist custom badwords:', persistErr);
            }

            this.game.broadcast({
              type: 'chatMsg',
              msg: `Word(s) ${normalized.join(', ')} added to banned list by ${this.account?.username || this.name}`,
              nameOfSender: 'SERVER'
            });
          } catch (err) {
            console.error('/banWord failed', err);
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Failed to ban word: ' + (err.message || 'error'), nameOfSender: 'SERVER' }));
          }
        },
        description: 'Add word(s) to the chat filter. Usage: /banWord foo bar'
      },
      '/allowWord': {
        requiredRole: 'admin',
        function: (...words) => {
          try {
            const normalized = words
              .flatMap(w => typeof w === 'string' ? w.split(/\s+/) : [])
              .map(w => String(w).trim().toLowerCase())
              .filter(Boolean);

            if (normalized.length === 0) {
              this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Usage: /allowWord word [word2 ...]', nameOfSender: 'SERVER' }));
              return;
            }

            // removeWords expects separate args, not an array argument
            this.game.chatFilter.removeWords(...normalized);

            // update persisted custom list (remove the words)
            try {
              const fs = require('fs');
              const path = require('path');
              const DATA_FILE = path.join(process.cwd(), 'config', 'custom-badwords.json');
              if (fs.existsSync(DATA_FILE)) {
                let current = [];
                try { current = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '[]'); } catch(e) { current = []; }
                const remaining = current
                  .map(s => String(s).toLowerCase())
                  .filter(s => !normalized.includes(s));
                fs.writeFileSync(DATA_FILE, JSON.stringify(remaining, null, 2), 'utf8');
              }
            } catch (persistErr) {
              console.warn('Failed to persist custom badwords removal:', persistErr);
            }

            this.game.broadcast({
              type: 'chatMsg',
              msg: `Word(s) ${normalized.join(', ')} removed from banned list by ${this.account?.username || this.name}`,
              nameOfSender: 'SERVER'
            });
          } catch (err) {
            console.error('/allowWord failed', err);
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Failed to allow word: ' + (err.message || 'error'), nameOfSender: 'SERVER' }));
          }
        },
        description: 'Remove word(s) from the chat filter. Usage: /allowWord foo bar'
      },
      '/spawn': {
        requiredRole: 'player',
        function: () => {
          try {
            this.respawn();
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'You have been respawned.', nameOfSender: 'SERVER' }));
          } catch (err) {
            console.error('spawn command failed', err);
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Respawn failed: ' + (err.message || 'error'), nameOfSender: 'SERVER' }));
          }
         },
        description: 'delete current player and build a new one'
      },
      '/stop': {
        requiredRole: 'admin',
        function: () => {
          try {
            this.game.stop();
          } catch (err) {
            console.error('stop failed', err);
          }
         },
        description: 'end the game'
      },
      '/leave': leave,
      '/l': leave,
      '/whisper': {
        requiredRole: 'player',
        function: (recipientId, ...messageParts) => {
          const message = messageParts.join(' ');
          const target = resolvePlayer(recipientId);
          if (!target || !target.ws) {
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' }));
            return;
          }
          target.ws.send(JSON.stringify({ type: 'chatMsg', msg: `(Whisper from ${this.name}): ${message}`, nameOfSender: '.' }));
        },
        description: 'Send a private message to another player. Usage: /whisper username message',
      },
      '/listplayers': {
        requiredRole: 'player',
        function: () => {
          const names = [...this.game.players.entries()]
            .map(([u, p]) => `${u}: ${p.name || p.account?.displayName || 'NoName'} [${(p.account?.roles || ['player']).join(', ')}]`)
            .join(', ');
          this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Players: ${names}`, nameOfSender: 'SERVER' }));
        },
        description: 'List players in the current game as username: displayName [roles]'
      },
      '/kick': {
        requiredRole: 'mod',
        function: (targetId) => {
          if (!targetId) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Usage: /kick username', nameOfSender: 'SERVER' })); return; }
          const p = resolvePlayer(targetId);
          if (!p) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' })); return; }
          this.game.disconnectPlayer(p.account.username);
          this.game.broadcast({ type: 'chatMsg', msg: `Player ${p.account.username} was kicked by ${this.name}`, nameOfSender: 'SERVER' });
        },
        description: 'Disconnect a player from the game (mod+)'
      },
      '/mute': {
        requiredRole: 'mod',
        function: (targetId) => {
          const p = resolvePlayer(targetId);
          if (!p) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' })); return; }
          p.chatBanned = true;
          this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Player ${p.account.username} muted by ${this.name}`, nameOfSender: 'SERVER' }));
        },
        description: 'Mute a player (mod+)'
      },
      '/unmute': {
        requiredRole: 'mod',
        function: (targetId) => {
          const p = resolvePlayer(targetId);
          if (!p) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' })); return; }
          p.chatBanned = false;
          this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Player ${p.account.username} unmuted by ${this.name}`, nameOfSender: 'SERVER' }));
        },
        description: 'Unmute a player (mod+)'
      },
      '/ban': {
        requiredRole: 'admin',
        function: (targetId) => {
          const p = resolvePlayer(targetId);
          if (!p) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' })); return; }
          p.chatBanned = true;
          try { if (p.ws) p.ws.close(4003, 'banned by admin'); } catch (e) {}
          this.game.broadcast({ type: 'chatMsg', msg: `Player ${p.account.username} was banned by ${this.name}`, nameOfSender: 'SERVER' });
        },
        description: 'Ban a player (disconnect) (admin only)'
      },
      '/role': {
        requiredRole: 'admin',
        function: async (targetId, ...newRoleParts) => {
          const newRole = newRoleParts.join(' ');
          const p = resolvePlayer(targetId);
          if (!p || !p.account) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' })); return; }
          if (!newRole) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Usage: /role username role1,role2', nameOfSender: 'SERVER' })); return; }
          try {
            const updated = await accounts.updateRole(p.account.username, newRole);
            if (p && p.account) p.account.roles = updated.roles;
            this.game.broadcast({ type: 'chatMsg', msg: `Player ${p.account.username} roles set to ${updated.roles.join(', ')} by ${this.name}`, nameOfSender: 'SERVER' });
          } catch (err) {
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Failed to set roles: ${err.message}`, nameOfSender: 'SERVER' }));
          }
        },
        description: 'Set roles for a user (admin only). Example: /role username mod,player'
      },
      '/info': {
        function: (targetId) => {
          const p = resolvePlayer(targetId);
          const acct = p?.account || accounts.getAccountByUsername(targetId);
          if (!acct) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Account not found', nameOfSender: 'SERVER' })); return; }
          this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `User: ${acct.username}, displayName: ${acct.displayName}, roles: ${acct.roles.join(', ')}`, nameOfSender: 'SERVER' }));
        },
        description: 'Get account details of player'
      },
      '/setComps': {
        requiredRole: 'mod',
        function: (targetId, ...componentNames) => {
          const p = resolvePlayer(targetId);
          if (!p) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' })); return; }
          if (componentNames.length === 0) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Usage: /setComponents username HoverSphere,Dash,Sword', nameOfSender: 'SERVER' })); return; }
          
          const componentString = componentNames.join(' ');
          const requestedNames = componentString.split(' ').map(n => n.trim()).filter(Boolean);
          const validComponents = requestedNames.filter(n => n in componentMap).map(n => componentMap[n]);
          
          if (validComponents.length === 0) {
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `No valid components. Available: ${componentList.join(', ')}`, nameOfSender: 'SERVER' }));
            return;
          }
          
          try {
            p.componentClasses = validComponents;
            p.respawn();
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `${p.account.username}'s components set to ${validComponents.map(c => c.name).join(', ')}`, nameOfSender: 'SERVER' }));
            p.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Your components have been changed to ${validComponents.map(c => c.name).join(', ')}`, nameOfSender: 'SERVER' }));
          } catch (err) {
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Failed to set components: ${err.message}`, nameOfSender: 'SERVER' }));
          }
        },
        description: 'Set components for a player (mod+). Example: /setComponents username HoverSphere,Dash,Sword'
      },
      '/spec': {
        requiredRole: 'player',
        function: (targetId) => {
          if (!targetId) {
            targetId = '@s'
          }
          const p = resolvePlayer(targetId);
          if (!p || !p.body) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found or has no body', nameOfSender: 'SERVER' })); return; }
          try {
            this.ws.send(JSON.stringify({ type: 'cameraFocusId', id: p.body.getUserData().id }));

            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Camera focus on ${p.name}`, nameOfSender: 'SERVER' }));
          } catch (err) {
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Spec failed: ${err.message}`, nameOfSender: 'SERVER' }));
          }
        },
        description: 'Focus your camera on a player. No input = @s'
      },
      '/listComps': {
        requiredRole: 'player',
        function: () => {
          const components = componentList.join(', ');
          this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Available components: ${components}`, nameOfSender: 'SERVER' }));
        },
        description: 'List all available components'
      },
      '/tp': {
        requiredRole: 'mod',
        function: (targetId, destinationId) => {
          if (!targetId || !destinationId) {
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Usage: /tp player destination (use @s for self)', nameOfSender: 'SERVER' }));
            return;
          }
          const p = resolvePlayer(targetId);
          const dest = resolvePlayer(destinationId);
          if (!p) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Target player not found', nameOfSender: 'SERVER' })); return; }
          if (!dest || !dest.body) { this.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Destination player not found or has no body', nameOfSender: 'SERVER' })); return; }
          
          try {
            if (p.body) {
              const destPos = dest.body.getPosition();
              p.body.setPosition(destPos);
              p.body.setLinearVelocity({ x: 0, y: 0 });
              p.ws.send(JSON.stringify({ type: 'chatMsg', msg: `You were teleported by ${this.name}`, nameOfSender: 'SERVER' }));
              this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Teleported ${p.account.username} to ${dest.account.username}`, nameOfSender: 'SERVER' }));
              this.game.broadcast({ type: 'chatMsg', msg: `${p.account.username} was teleported to ${dest.account.username}`, nameOfSender: 'SERVER' });
            }
          } catch (err) {
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Teleport failed: ${err.message}`, nameOfSender: 'SERVER' }));
          }
        },
        description: 'Teleport a player to another player. Usage: /tp player destination (use @s for self)'
      }
    };

    if (!string) return;

    const parts = string.trim().split(/\s+/);
    const commandToken = parts.shift();

    if (commandToken === '/help') {
      for (const cmd in commands) {
        const entry = commands[cmd];
        if (!entry.requiredRole || hasRole(this.account?.roles || ['player'], entry.requiredRole)) {
          this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `${cmd}: ${entry.description}`, nameOfSender: 'SERVER' }));
        }
      }
      this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `@s refererences self`, nameOfSender: 'SERVER' }));
      this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `/zoom /uiscale`, nameOfSender: 'CLIENT' }));
      return;

    }

    const commandEntry = commands[commandToken];
    if (commandEntry) {
      const required = commandEntry.requiredRole || 'player';
      const userRoles = this.account?.roles || ['player'];
      if (!hasRole(userRoles, required)) {
        this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Insufficient permissions to run ${commandToken} (requires ${required})`, nameOfSender: 'SERVER' }));
        return;
      }
      try {
        const result = commandEntry.function(...parts);
        if (result && typeof result.then === 'function') {
          result.catch((err) => {
            this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Command error: ${err.message}`, nameOfSender: 'SERVER' }));
          });
        }
      } catch (err) {
        this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Command error: ${err.message}`, nameOfSender: 'SERVER' }));
      }
    } else {
      this.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Unknown command. Type /help for a list of commands.`, nameOfSender: 'SERVER' }));
    }
  }

  sendInit() {
    try {
      const payload = {
        type: "init",
        clientId: this.clientId,
        name: this.name,
        bodyId: this.body.getUserData().id
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
}