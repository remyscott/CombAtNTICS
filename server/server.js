// server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import { Game } from './game.js';
import { httpAuthMiddleware, upgradeAuthHandler } from './auth.js';
import { authorizedUsers } from './authorizedusers.js';
import { maps } from './maps.js';
const app = express();
const server = http.createServer(app);


const ENABLE_AUTH = process.env.ENABLE_AUTH === 'true';
const usersObj = ENABLE_AUTH ? authorizedUsers : null;

app.use(httpAuthMiddleware(usersObj, { realm: 'Game Demo' }));

const wss = new WebSocketServer({ noServer: true });

const games = new Map();

function getOrCreateGame(gameId, map = maps.map1) {
  if (!games.has(gameId)) {
    const newGame = new Game(map);
    games.set(gameId, newGame);
    console.log(`🎮 Created new game: ${gameId}`);
  }
  return games.get(gameId);
}

/* your routes unchanged */
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
  res.sendFile("lobby.html", { root: "public" });
});

const upgradeHandler = upgradeAuthHandler(usersObj, wss, { realm: 'Game Demo' });
server.on('upgrade', upgradeHandler);

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const gameId = url.searchParams.get('game');
  const name = url.searchParams.get('name') || "MysteriousBro";

  const clientId = crypto.randomUUID();
  const game = getOrCreateGame(gameId);

  game.addPlayer(clientId, name, ws);

  console.log(`🆕 Player joined: ${name} in ${gameId}`);

  ws.on('message', (raw) => {
    if (!raw) return;

    let data;
    try {
      data = JSON.parse(raw);
    } catch(e) {
      console.warn('⚠️ Bad WS message:', raw);
      return;
    }
  });

  ws.on('close', () => {
    console.log(`👋 ${name} left ${gameId}`);
    game.removePlayer(clientId);
    if (game.players.size === 0) {
      game.stop();
      games.delete(gameId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌍 Server running on http://localhost:${PORT} (auth ${ENABLE_AUTH ? 'enabled' : 'disabled'})`));