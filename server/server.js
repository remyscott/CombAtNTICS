import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { Game } from './game.js'
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const games = new Map();

function getOrCreateGame(gameId) {
  if (!games.has(gameId)) {
    const newGame = new Game();
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
  res.sendFile("lobby.html", { root: "public" });
});

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
    
    if (data.type === 'timeSync') {
      game.miserableBroadcastAI({type: 'timeSyncResp', serverTime: Date.now(), id: data.id});
    }
    if (data.type === 'input') {
      game.players.get(clientId).state.mousePos = data.inputs.mousePos;
    }    

  });

  ws.on('close', () => {
    console.log(`👋 ${name} left ${gameId}`);
    game.removePlayer(clientId)
    if (game.players.size === 0) {
      game.stop();
      games.delete(gameId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌍 Server running on http://localhost:${PORT}`));