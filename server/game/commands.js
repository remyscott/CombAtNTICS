import { componentList, componentMap } from "./componentMap.js";

export class CommandInterpretor {
  constructor(player) {
    if (!player) throw new Error('CommandInterpretor requires a player instance');
    this.player = player;

    this.commands = {};
    for (const [k, entry] of Object.entries(commands)) {
      // shallow clone entry so we can bind safely without mutating caller's object
      this.commands[k] = {
        requiredRole: entry.requiredRole,
        description: entry.description,
        function: entry.function.bind(this),
      };
    }
  }

  // --- role helpers (static) ---
  static roleRank(r) { return ({ player: 0, mod: 1, admin: 2 }[r] ?? 0); }
  static normalizeRoleInput(raw) {
    if (Array.isArray(raw)) return raw;
    if (!raw) return ['player'];
    return String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  static highestRoleRank(roles) {
    return Math.max(0, ...CommandInterpretor.normalizeRoleInput(roles).map(CommandInterpretor.roleRank));
  }
  static hasRole(userRoles, requiredRole) {
    return CommandInterpretor.highestRoleRank(userRoles) >= CommandInterpretor.roleRank(requiredRole);
  }

  sendServerChat(msg, sender = 'SERVER') {
    try { this.player.ws?.send(JSON.stringify({ type: 'chatMsg', msg, nameOfSender: sender })); }
    catch (_) {}
  }

  resolvePlayer(identifier) {
    if (!identifier) return null;
    const key = String(identifier).trim();
    if (key === '@s' || key === '@self') return this.player;
    if (this.player.game?.players?.has && this.player.game.players.has(key)) return this.player.game.players.get(key);
    const lower = key.toLowerCase();
    for (const p of (this.player.game?.players?.values ? this.player.game.players.values() : [])) {
      if (p.account?.username?.toLowerCase() === lower) return p;
      if (p.account?.displayName?.toLowerCase() === lower) return p;
      if (p.name?.toLowerCase() === lower) return p;
    }
    return null;
  }

  interpret(inputString) {
    if (!inputString) return;

    const parts = inputString.trim().split(/\s+/);
    const commandToken = parts.shift();

    if (commandToken === '/help') {
      for (const cmdKey of Object.keys(this.commands)) {
        const entry = this.commands[cmdKey];
        if (!entry.requiredRole || CommandInterpretor.hasRole(this.player.account?.roles || ['player'], entry.requiredRole)) {
          this.sendServerChat(`${cmdKey}: ${entry.description}`);
        }
      }
      this.sendServerChat(`@s references self`);
      this.player.ws?.send(JSON.stringify({ type: 'chatMsg', msg: `/zoom /uiscale`, nameOfSender: 'CLIENT' }));
      return;
    }

    const entry = this.commands[commandToken];
    if (!entry) {
      this.sendServerChat('Unknown command. Type /help for a list of commands.');
      return;
    }

    const required = entry.requiredRole || 'player';
    if (!CommandInterpretor.hasRole(this.player.account?.roles || ['player'], required)) {
      this.sendServerChat(`Insufficient permissions to run ${commandToken} (requires ${required})`);
      return;
    }

    try {
      const result = entry.function(...parts); // already bound to `this`
      if (result && typeof result.then === 'function') {
        result.catch(err => this.sendServerChat(`Command error: ${err?.message || err}`));
      }
    } catch (err) {
      this.sendServerChat(`Command error: ${err?.message || err}`);
    }
  }
}

const leave = {
  requiredRole: 'player',
  function: function () {
    if (!this.player.game.players.has(this.player.account.username)) {
      try {
        this.player.game.broadcast({
          type: 'chatMsg',
          msg: `${this.player.name} has left the game`,
          nameOfSender: 'SERVER'
        });
      } catch (err) {
        // ignore
      }
      return;
    }
    this.player.game.removePlayer(this.player.account.username);
  },
  description: 'Leave the game and return to the lobby'
}

const commands = {
  '/banWord': {
    requiredRole: 'admin',
    function: function (...words) {
      try {
        const normalized = words
          .flatMap(w => typeof w === 'string' ? w.split(/\s+/) : [])
          .map(w => String(w).trim().toLowerCase())
          .filter(Boolean);

        if (normalized.length === 0) {
          this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Usage: /banWord word [word2 ...]', nameOfSender: 'SERVER' }));
          return;
        }

        this.player.game.chatFilter.addWords(...normalized);

        this.player.game.broadcast({
          type: 'chatMsg',
          msg: `Word(s) ${normalized.join(', ')} added to banned list by ${this.player.account?.username || this.player.name}`,
          nameOfSender: 'SERVER'
        });
      } catch (err) {
        console.error('/banWord failed', err);
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Failed to ban word: ' + (err.message || 'error'), nameOfSender: 'SERVER' }));
      }
    },
    description: 'Add word(s) to the chat filter. Usage: /banWord foo bar'
  },

  '/allowWord': {
    requiredRole: 'admin',
    function: function (...words) {
      try {
        const normalized = words
          .flatMap(w => typeof w === 'string' ? w.split(/\s+/) : [])
          .map(w => String(w).trim().toLowerCase())
          .filter(Boolean);

        if (normalized.length === 0) {
          this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Usage: /allowWord word [word2 ...]', nameOfSender: 'SERVER' }));
          return;
        }

        this.player.game.chatFilter.removeWords(...normalized);

        this.player.game.broadcast({
          type: 'chatMsg',
          msg: `Word(s) ${normalized.join(', ')} removed from banned list by ${this.player.account?.username || this.player.name}`,
          nameOfSender: 'SERVER'
        });
      } catch (err) {
        console.error('/allowWord failed', err);
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Failed to allow word: ' + (err.message || 'error'), nameOfSender: 'SERVER' }));
      }
    },
    description: 'Remove word(s) from the chat filter. Usage: /allowWord foo bar'
  },

  '/listplayers': {
    requiredRole: 'player',
    function: function () {
      const names = [...this.player.game.players.entries()]
        .map(([u, p]) => `${u}: ${p.name || p.account?.displayName || 'NoName'} [${(p.account?.roles || ['player']).join(', ')}]`)
        .join(', ');
      this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Players: ${names}`, nameOfSender: 'SERVER' }));
    },
    description: 'List players in the current game as username: displayName [roles]'
  },

  '/leave': leave,
  '/l': leave,

  '/whisper': {
    requiredRole: 'player',
    function: function (recipientId, ...messageParts) {
      const message = messageParts.join(' ');
      const target = this.resolvePlayer(recipientId);
      if (!target || !target.ws) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' }));
        return;
      }
      target.ws.send(JSON.stringify({ type: 'chatMsg', msg: `(Whisper from ${this.player.name}): ${message}`, nameOfSender: '.' }));
    },
    description: 'Send a private message to another player. Usage: /whisper username message'
  },
  '/listplayers': {
    requiredRole: 'player',
    function: function () {
      const names = [...this.player.game.players.entries()]
        .map(([u, p]) => `${u}: ${p.name || p.account?.displayName || 'NoName'} [${(p.account?.roles || ['player']).join(', ')}]`)
        .join(', ');
      this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Players: ${names}`, nameOfSender: 'SERVER' }));
    },
    description: 'List players in the current game as username: displayName [roles]'
  },

  '/kick': {
    requiredRole: 'mod',
    function: function (targetId) {
      if (!targetId) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Usage: /kick username', nameOfSender: 'SERVER' }));
        return;
      }
      const p = this.resolvePlayer(targetId);
      if (!p) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' }));
        return;
      }
      this.player.game.disconnectPlayer(p.account.username);
      this.player.game.broadcast({ type: 'chatMsg', msg: `Player ${p.account.username} was kicked by ${this.player.name}`, nameOfSender: 'SERVER' });
    },
    description: 'Disconnect a player from the game (mod+)'
  },

  '/mute': {
    requiredRole: 'mod',
    function: function (targetId) {
      const p = this.resolvePlayer(targetId);
      if (!p) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' }));
        return;
      }
      p.chatBanned = true;
      this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Player ${p.account.username} muted by ${this.player.name}`, nameOfSender: 'SERVER' }));
    },
    description: 'Mute a player (mod+)'
  },

  '/unmute': {
    requiredRole: 'mod',
    function: function (targetId) {
      const p = this.resolvePlayer(targetId);
      if (!p) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' }));
        return;
      }
      p.chatBanned = false;
      this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Player ${p.account.username} unmuted by ${this.player.name}`, nameOfSender: 'SERVER' }));
    },
    description: 'Unmute a player (mod+)'
  },

  '/ban': {
    requiredRole: 'admin',
    function: function (targetId) {
      const p = this.resolvePlayer(targetId);
      if (!p) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' }));
        return;
      }
      p.chatBanned = true;
      try { if (p.ws) p.ws.close(4003, 'banned by admin'); } catch (e) {}
      this.player.game.broadcast({ type: 'chatMsg', msg: `Player ${p.account.username} was banned by ${this.player.name}`, nameOfSender: 'SERVER' });
    },
    description: 'Ban a player (disconnect) (admin only)'
  },

  '/role': {
    requiredRole: 'admin',
    function: async function (targetId, ...newRoleParts) {
      const newRole = newRoleParts.join(' ');
      const p = this.resolvePlayer(targetId);
      if (!p || !p.account) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' }));
        return;
      }
      if (!newRole) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Usage: /role username role1,role2', nameOfSender: 'SERVER' }));
        return;
      }
      try {
        const updated = await accounts.updateRole(p.account.username, newRole);
        if (p && p.account) p.account.roles = updated.roles;
        this.player.game.broadcast({ type: 'chatMsg', msg: `Player ${p.account.username} roles set to ${updated.roles.join(', ')} by ${this.player.name}`, nameOfSender: 'SERVER' });
      } catch (err) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Failed to set roles: ${err.message}`, nameOfSender: 'SERVER' }));
      }
    },
    description: 'Set roles for a user (admin only). Example: /role username mod,player'
  },

  '/info': {
    function: function (targetId) {
      const p = this.resolvePlayer(targetId);
      const acct = p?.account || accounts.getAccountByUsername(targetId);
      if (!acct) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Account not found', nameOfSender: 'SERVER' }));
        return;
      }
      this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `User: ${acct.username}, displayName: ${acct.displayName}, roles: ${acct.roles.join(', ')}`, nameOfSender: 'SERVER' }));
    },
    description: 'Get account details of player'
  },

  '/setComps': {
    requiredRole: 'mod',
    function: function (targetId, ...componentNames) {
      const p = this.resolvePlayer(targetId);
      if (!p) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found', nameOfSender: 'SERVER' }));
        return;
      }
      if (componentNames.length === 0) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Usage: /setComponents username HoverSphere,Dash,Sword', nameOfSender: 'SERVER' }));
        return;
      }

      const componentString = componentNames.join(' ');
      const requestedNames = componentString.split(' ').map(n => n.trim()).filter(Boolean);
      const validComponents = requestedNames.filter(n => n in componentMap).map(n => componentMap[n]);

      if (validComponents.length === 0) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `No valid components. Available: ${componentList.join(', ')}`, nameOfSender: 'SERVER' }));
        return;
      }

      try {
        p.componentClasses = validComponents;
        p.respawn();
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `${p.account.username}'s components set to ${validComponents.map(c => c.name).join(', ')}`, nameOfSender: 'SERVER' }));
        p.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Your components have been changed to ${validComponents.map(c => c.name).join(', ')}`, nameOfSender: 'SERVER' }));
      } catch (err) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Failed to set components: ${err.message}`, nameOfSender: 'SERVER' }));
      }
    },
    description: 'Set components for a player (mod+). Example: /setComponents username HoverSphere,Dash,Sword'
  },

  '/spec': {
    requiredRole: 'player',
    function: function (targetId) {
      if (!targetId) targetId = '@s';
      const p = this.resolvePlayer(targetId);
      if (!p || !p.body) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Player not found or has no body', nameOfSender: 'SERVER' }));
        return;
      }
      try {
        this.player.ws.send(JSON.stringify({ type: 'cameraFocusId', id: p.getBodyId() }));
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Camera focus on ${p.name}`, nameOfSender: 'SERVER' }));
      } catch (err) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Spec failed: ${err.message}`, nameOfSender: 'SERVER' }));
      }
    },
    description: 'Focus your camera on a player. No input = @s'
  },

  '/listComps': {
    requiredRole: 'player',
    function: function () {
      const components = componentList.join(', ');
      this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Available components: ${components}`, nameOfSender: 'SERVER' }));
    },
    description: 'List all available components'
  },

  '/tp': {
    requiredRole: 'mod',
    function: function (targetId, destinationId) {
      if (!targetId || !destinationId) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Usage: /tp player destination (use @s for self)', nameOfSender: 'SERVER' }));
        return;
      }
      const p = this.resolvePlayer(targetId);
      const dest = this.resolvePlayer(destinationId);
      if (!p) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Target player not found', nameOfSender: 'SERVER' }));
        return;
      }
      if (!dest || !dest.body) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: 'Destination player not found or has no body', nameOfSender: 'SERVER' }));
        return;
      }

      try {
        if (p.body) {
          const destPos = dest.body.getPosition();
          for (const component of p.components) {
            if (component.body) {
              component.body.setPosition(destPos);
              component.body.setLinearVelocity({ x: 0, y: 0 });

            }
          }
          p.ws.send(JSON.stringify({ type: 'chatMsg', msg: `You were teleported by ${this.player.name}`, nameOfSender: 'SERVER' }));
          this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Teleported ${p.account.username} to ${dest.account.username}`, nameOfSender: 'SERVER' }));
          this.player.game.broadcast({ type: 'chatMsg', msg: `${p.account.username} was teleported to ${dest.account.username}`, nameOfSender: 'SERVER' });
        }
      } catch (err) {
        this.player.ws.send(JSON.stringify({ type: 'chatMsg', msg: `Teleport failed: ${err.message}`, nameOfSender: 'SERVER' }));
      }
    },
    description: 'Teleport a player to another player. Usage: /tp player destination (use @s for self)'
  }
};

function teleportPlayerTo() {

}