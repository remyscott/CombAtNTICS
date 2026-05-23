import dotenv from 'dotenv';
dotenv.config();

import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import { Game } from './game/game.js';
import { httpAuthMiddleware, upgradeAuthHandler } from './auth.js';
import { authorizedUsers } from './config/authorizedusers.js';
import { maps } from './config/maps.js';
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
  if (!games.has(gameId)) {
    const newGame = new Game(map);
    games.set(gameId, newGame);
    console.log(`🎮 Created new game: ${gameId}`);
  }
  return games.get(gameId);
}

app.get("/games", (req, res) => {
  const list = [...games.entries()].map(([gameId, game]) => ({
    id: gameId,
    players: game.players.size,
    map: game.MAP_NAME
  }));
  res.json(list);
});

app.use(express.static("public"));
app.use('/shared', express.static('shared'));
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
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

  function joinGame(gameId) {
    if (ws.joinedGameId === gameId) return; // already in game

    if (ws.joinedGameId) {
      const prev = games.get(ws.joinedGameId);
      if (prev) prev.removePlayer(clientId);
      ws.joinedGameId = null;
    }

    const game = getOrCreateGame(gameId);

    game.addPlayer(ws);

    ws.joinedGameId = gameId;

    console.log(`🟢 Player joined: ${playerName} (clientId=${clientId}) -> ${gameId}`);
  }

  function leaveGame() {
    if (!ws.joinedGameId) return;
    const game = games.get(ws.joinedGameId);
    if (game) {
      game.removePlayer(clientId);
      console.log(`🔴 Player left: clientId=${clientId} -> ${ws.joinedGameId}`);
      if (game.players.size === 0) {
        game.stop();
        games.delete(ws.joinedGameId);
        console.log(`🛑 Game ${ws.joinedGameId} stopped (empty)`);
      }
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
        // client sends { type:'auth', token }
        const { token } = msg;
        if (!token) { ws.send(JSON.stringify({ type: 'auth.fail', reason: 'no token' })); break; }
        const sess = sessions.getSession(token);
        if (!sess) { ws.send(JSON.stringify({ type: 'auth.fail', reason: 'invalid_or_expired' })); break; }
        const acct = await accounts.getAccountByEmail(sess.accountEmail);
        if (!acct) { ws.send(JSON.stringify({ type: 'auth.fail', reason: 'no_account' })); break; }
        ws.account = acct;
        ws.sessionToken = token;
        ws.send(JSON.stringify({ type: 'auth.ok', account: acct, sessionToken: token, expiresAt: sess.expiresAt }));
        console.log(`🔐 Re-authenticated via token: ${acct.email} (clientId=${clientId})`);
        break;
      }

      case 'signup': {
        const { email, password, displayName } = msg;
        if (!email || !password) { ws.send(JSON.stringify({ type:'signup.fail', reason:'email and password required' })); break; }
        try {
          const acct = await accounts.createAccount(email, password, displayName);
          const sess = sessions.createSession(acct.email);
          ws.account = acct;
          ws.sessionToken = sess.token;
          ws.send(JSON.stringify({ type: 'auth.ok', account: acct, sessionToken: sess.token, expiresAt: sess.expiresAt }));
          console.log(`🔐 SignUp + session created: ${acct.email} (clientId=${clientId})`);
        } catch (err) {
          console.error('signup error', err);
          ws.send(JSON.stringify({ type:'signup.fail', reason: err.message || 'failed' }));
        }
        break;
      }

      case 'signin': {
        const { email, password } = msg;
        if (!email || !password) { ws.send(JSON.stringify({ type:'signin.fail', reason:'email and password required' })); break; }
        try {
          const acct = await accounts.authenticate(email, password);
          if (!acct) { ws.send(JSON.stringify({ type:'signin.fail', reason:'invalid credentials' })); break; }
          const sess = sessions.createSession(acct.email);
          ws.account = acct;
          ws.sessionToken = sess.token;
          ws.send(JSON.stringify({ type:'auth.ok', account: acct, sessionToken: sess.token, expiresAt: sess.expiresAt }));
          console.log(`🔐 SignIn + session created: ${acct.email} (clientId=${clientId})`);
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

      case 'join': {
        if (!ws.account) { ws.send(JSON.stringify({ type:'error', message:'please sign in' })); break; }
        await joinGame(msg.gameId);
        break;
      }

      case 'leave': {
        leaveGame();
        ws.send(JSON.stringify({ type:'leaveAck', ok: true }));
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log(`❌ WS disconnected (clientId=${clientId})`);
    // cleanup: remove player if in game
    if (ws.joinedGameId) {
      const game = games.get(ws.joinedGameId);
      if (game) {
        game.removePlayer(clientId);
        if (game.players.size === 0) {
          game.stop();
          games.delete(ws.joinedGameId);
          console.log(`🛑 Game ${ws.joinedGameId} stopped (empty)`);
        }
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WS error for client:', clientId, err);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌍 Server running on http://localhost:${PORT} (auth ${ENABLE_AUTH ? 'enabled' : 'disabled'})`));