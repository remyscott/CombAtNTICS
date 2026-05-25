import dotenv from 'dotenv';
dotenv.config();

import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import { Game } from './game/game.js';
import { httpAuthMiddleware, upgradeAuthHandler } from './auth.js';
import { authorizedUsers } from './config/authorizedusers.js';
import { maps, makeCrystalMap } from './config/maps.js';
import accounts from './accounts-sqlite.js';
import sessions from './sessions.js'
const app = express();
const server = http.createServer(app);


const ENABLE_AUTH = process.env.ENABLE_AUTH === 'true';
const usersObj = ENABLE_AUTH ? authorizedUsers : null;

app.use(httpAuthMiddleware(usersObj, { realm: 'Game Demo' }));

const wss = new WebSocketServer({ noServer: true });

const games = new Map();

function getOrCreateGame(gameId, map = maps[Math.floor(Math.random()*maps.length)]) {
  if (Math.random() < 0.3) map = makeCrystalMap();
  if (!games.has(gameId)) {
    const game = new Game(map, gameId, (id) => {
      games.delete(id);
      console.log(`🛑 Game ${id} stopped (removed from registry)`);
    });
    games.set(gameId, game);
    console.log(`🎮 Created new game: ${gameId}`);
  }
  return games.get(gameId);
}

app.get("/games", (req, res) => {
  const list = [...games.entries()].map(([gameId, game]) => ({
    id: gameId,
    players: game.players.size,
    map: game.map.name
  }));
  res.json(list);
});

app.use(express.static("public"));
app.use('/shared', express.static('shared'));
app.get("/", (req, res) => {
  res.sendFile("login.html", { root: "public" });
});

const upgradeHandler = upgradeAuthHandler(usersObj, wss, { realm: 'Game Demo' });
server.on('upgrade', upgradeHandler);





wss.on('connection', (ws, req) => {
  const clientId = crypto.randomUUID();
  ws.clientId = clientId;
  ws.account = null;
  ws.sessionToken = null;
  ws.joinedGameId = null;

  console.log(`🔌 WS connected (clientId=${clientId})`);

  function assertLoggedIn() {
    if (!ws.account) { ws.send(JSON.stringify({ type:'error', message:'please sign in' })); return false; }
    return true;
  }

  // Helper: check if a given session token is already used by another live client
  function isTokenInUse(token) {
    if (!token) return false;
    for (const client of wss.clients) {
      if (client === ws) continue; // skip self
      if (client.readyState === client.OPEN && client.sessionToken === token) {
        return true;
      }
    }
    return false;
  }

  // Helper: close other sockets for the same account username (force-logout older sessions)
  function closeOtherSocketsForUsername(accountUsername, keepToken) {
    for (const client of wss.clients) {
      if (client === ws) continue;
      if (client.readyState !== client.OPEN) continue;
      // if client.account exists and matches username, and its sessionToken differs from keepToken, close it
      try {
        const clientUsername = client.account && client.account.username;
        if (clientUsername && clientUsername === accountUsername) {
          // Optionally notify the client
          try { client.send(JSON.stringify({ type: 'session.invalidated', reason: 'new_session' })); } catch (e) {}
          try { client.close(4000, 'session invalidated by new login'); } catch (e) {}
          console.log(`🔒 Closed previous socket for ${accountUsername}`);
        }
      } catch (e) {
        // ignore
      }
    }
  }

  async function joinGame(gameId) {
    if (!assertLoggedIn()) {
      ws.send(JSON.stringify({ type: 'joinAck', ok: false, reason: 'not_logged_in', gameId: gameId || null }));
      return;
    }
    if (!gameId) {
      ws.send(JSON.stringify({ type: 'joinAck', ok: false, reason: 'no_gameId', gameId: null }));
      return;
    }
    try {
      if (ws.joinedGameId === gameId) {
        ws.send(JSON.stringify({ type: 'joinAck', ok: true, gameId, clientId }));
        return;
      }
      if (ws.joinedGameId) {
        const prev = games.get(ws.joinedGameId);
        if (prev) prev.disconnectPlayer(ws.account.username);
        ws.joinedGameId = null;
      }
      const game = getOrCreateGame(gameId);
      game.addPlayer(ws);
      ws.joinedGameId = gameId;
      ws.send(JSON.stringify({ type: 'joinAck', ok: true, gameId, clientId }));
      console.log(`🟢 Player joined: ${ws.account.username} -> ${gameId}`);
    } catch (err) {
      console.error('joinGame error', err);
      ws.send(JSON.stringify({ type: 'joinAck', ok: false, reason: 'internal_error', gameId: gameId || null }));
    }
  }

  function leaveGame() {
    if (!ws.joinedGameId) return;
    const game = games.get(ws.joinedGameId);
    if (game) {
      game.disconnectPlayer(ws.account.username);
    }
    ws.joinedGameId = null;
  }

  ws.on('message', async (raw) => {
    if (!raw) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.warn('⚠️ Bad WS message (not JSON):', raw);
      ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }));
      return;
    }

    switch (msg.type) {

      case 'auth': {
        const { token } = msg;
        if (!token) { ws.send(JSON.stringify({ type: 'auth.fail', reason: 'no token' })); break; }

        // Reject if the same token is already attached to another open connection
        if (isTokenInUse(token)) {
          ws.send(JSON.stringify({ type: 'auth.fail', reason: 'this account already has an active session . Logging in again will invalidate that session, and allow you to join' }));
          console.log(`⛔ Rejected auth for token (already in use) clientId=${clientId}`);
          break;
        }

        const sess = sessions.getSession(token);
        if (!sess) { ws.send(JSON.stringify({ type: 'auth.fail', reason: 'invalid_or_expired' })); break; }

          const acct = await accounts.getAccountByUsername(sess.accountUsername);
        if (!acct) { ws.send(JSON.stringify({ type: 'auth.fail', reason: 'no_account' })); break; }

        // OK - attach account and token
        ws.account = acct;
        ws.sessionToken = token;

        // Because we enforce single-session-per-username, when a new session is created on signin/signup
        // we close older sockets; but also ensure here that no other live socket is using the same account username.
        // (This is redundant with the isTokenInUse check above, but we'll be safe.)
        for (const client of wss.clients) {
          if (client !== ws && client.readyState === client.OPEN && client.sessionToken === token) {
            // Shouldn't happen (caught above) but if it does, close the other client
            try { client.send(JSON.stringify({ type: 'session.invalidated', reason: 'duplicate' })); } catch(e){}
            try { client.close(4000, 'duplicate session'); } catch(e){}
          }
        }

        ws.send(JSON.stringify({ type: 'auth.ok', account: acct, sessionToken: token, expiresAt: sess.expiresAt }));
        console.log(`🔐 Re-authenticated via token: ${acct.username} (clientId=${clientId})`);
        break;
      }

      case 'signup': {
        const { username, password, displayName } = msg;
        if (!username || !password) { ws.send(JSON.stringify({ type:'signup.fail', reason:'username and password required' })); break; }
        try {
          const acct = await accounts.createAccount(username, password, displayName);
          // create a new session and invalidate previous sessions in DB
          const sess = sessions.createSession(acct.username);

          // Close other live sockets for this account username so the new session is the only live one
          closeOtherSocketsForUsername(acct.username, sess.token);

          // attach to this ws
          ws.account = acct;
          ws.sessionToken = sess.token;
          ws.send(JSON.stringify({ type: 'auth.ok', account: acct, sessionToken: sess.token, expiresAt: sess.expiresAt }));
          console.log(`🔐 SignUp + session created: ${acct.username} (clientId=${clientId})`);
        } catch (err) {
          console.error('signup error', err);
          ws.send(JSON.stringify({ type:'signup.fail', reason: err.message || 'failed' }));
        }
        break;
      }

      case 'signin': {
        const { username, password } = msg;
        if (!username || !password) { ws.send(JSON.stringify({ type:'signin.fail', reason:'username and password required' })); break; }
        try {
          const acct = await accounts.authenticate(username, password);
          if (!acct) { ws.send(JSON.stringify({ type:'signin.fail', reason:'invalid credentials' })); break; }

          // create fresh session (this deletes previous sessions in DB)
          const sess = sessions.createSession(acct.username);

          // close other live sockets for this account username so new session is sole live connection
          closeOtherSocketsForUsername(acct.username, sess.token);

          ws.account = acct;
          ws.sessionToken = sess.token;
          ws.send(JSON.stringify({ type:'auth.ok', account: acct, sessionToken: sess.token, expiresAt: sess.expiresAt }));
          console.log(`🔐 SignIn + session created: ${acct.username} (clientId=${clientId})`);
        } catch (err) {
          console.error('signin error', err);
          ws.send(JSON.stringify({ type:'signin.fail', reason: err.message || 'failed' }));
        }
        break;
      }

      case 'logout': {
        const token = msg.token || ws.sessionToken;
        if (token) sessions.deleteSession(token);
        ws.account = null;
        ws.sessionToken = null;
        ws.send(JSON.stringify({ type:'logout.ok' }));
        break;
      }

      case 'updateDisplayName': {
        if (!assertLoggedIn()) break;
        try {
          const display = String(msg.displayName || '').slice(0,25);
          const updated = await accounts.updateDisplayName(ws.account.username, display);
          // update in-memory account and inform client
          ws.account.displayName = updated.displayName;
          ws.send(JSON.stringify({ type: 'updateDisplayName.ok', displayName: updated.displayName }));
        } catch (err) {
          console.error('updateDisplayName error', err);
          ws.send(JSON.stringify({ type: 'updateDisplayName.fail', reason: err.message || 'failed' }));
        }
        break;
      }

      case 'join': {
        await joinGame(msg.gameId);
        break;
      }

      case 'saveKeybinds': {
        if (!assertLoggedIn()) break;
        try {
          const keybinds = msg.keybinds || {};
          const updated = await accounts.updateKeybinds(ws.account.username, keybinds);
          // reflect in-memory account
          if (ws.account) ws.account.keybinds = updated.keybinds;
          ws.send(JSON.stringify({ type: 'saveKeybinds.ok', keybinds: updated.keybinds }));
        } catch (err) {
          console.error('saveKeybinds error', err);
          ws.send(JSON.stringify({ type: 'saveKeybinds.fail', reason: err.message || 'failed' }));
        }
        break;
      }

      case 'loadKeybinds': {
        if (!assertLoggedIn()) break;
        try {
          const acct = await accounts.getAccountByUsername(ws.account.username);
          ws.send(JSON.stringify({ type: 'loadKeybinds.ok', keybinds: acct.keybinds || {} }));
        } catch (err) {
          console.error('loadKeybinds error', err);
          ws.send(JSON.stringify({ type: 'loadKeybinds.fail', reason: err.message || 'failed' }));
        }
        break;
      }

      case 'leave': {
        leaveGame();
        ws.send(JSON.stringify({ type:'leaveAck', ok: true }));
        break;
      }

      default:
        ws.send(JSON.stringify({ type:'error', message:'unknown message type' }));
        break;
    }
  });

  ws.on('close', () => {
    console.log(`❌ WS disconnected (clientId=${clientId})`);
    leaveGame();
  });

  ws.on('error', (err) => {
    console.error('WS error for client:', clientId, err);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌍 Server running on http://localhost:${PORT} (auth ${ENABLE_AUTH ? 'enabled' : 'disabled'})`));