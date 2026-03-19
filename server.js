const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const rooms = {};

function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        id: `${suit}${rank}`,
        suit,
        rank,
        label: `${suit}${rank}`
      });
    }
  }
  deck.push({
    id: "JOKER",
    suit: "🃏",
    rank: "JOKER",
    label: "🃏"
  });
  return deck;
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function removePairs(hand) {
  const counts = {};
  for (const card of hand) {
    if (card.rank === "JOKER") continue;
    counts[card.rank] = (counts[card.rank] || 0) + 1;
  }

  const result = [...hand];
  const removedPairs = [];

  for (const rank in counts) {
    let pairCount = Math.floor(counts[rank] / 2);
    while (pairCount > 0) {
      const pair = [];
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i].rank === rank && pair.length < 2) {
          pair.push(result[i]);
          result.splice(i, 1);
        }
      }
      removedPairs.push(pair);
      pairCount--;
    }
  }

  return { newHand: result, removedPairs };
}

function describePairs(removedPairs) {
  if (removedPairs.length === 0) return "";
  return removedPairs.map(pair => pair.map(card => card.label).join(" と ")).join(" / ");
}

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      players: {},
      order: [],
      started: false,
      finished: false,
      turnPlayerId: null,
      loserId: null,
      message: ""
    };
  }
  return rooms[roomId];
}

function buildState(room, socketId) {
  const me = room.players[socketId] || null;
  const opponentId = room.order.find(id => id !== socketId);
  const opponent = opponentId ? room.players[opponentId] : null;

  return {
    roomId: room.id,
    started: room.started,
    finished: room.finished,
    loserId: room.loserId,
    turnPlayerId: room.turnPlayerId,
    message: room.message,
    me: me
      ? {
          id: me.id,
          name: me.name,
          hand: me.hand
        }
      : null,
    opponent: opponent
      ? {
          id: opponent.id,
          name: opponent.name,
          handCount: opponent.hand.length
        }
      : null
  };
}

function emitRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  for (const playerId of room.order) {
    const socket = io.sockets.sockets.get(playerId);
    if (socket) {
      socket.emit("state", buildState(room, playerId));
    }
  }
}

function resetRoomGameState(room) {
  room.started = false;
  room.finished = false;
  room.turnPlayerId = null;
  room.loserId = null;
}

function startGame(room) {
  const ids = room.order.filter(id => room.players[id]);
  if (ids.length !== 2) return false;

  const deck = shuffle(createDeck());

  room.players[ids[0]].hand = [];
  room.players[ids[1]].hand = [];

  deck.forEach((card, index) => {
    room.players[ids[index % 2]].hand.push(card);
  });

  room.players[ids[0]].hand = removePairs(room.players[ids[0]].hand).newHand;
  room.players[ids[1]].hand = removePairs(room.players[ids[1]].hand).newHand;

  room.started = true;
  room.finished = false;
  room.loserId = null;
  room.turnPlayerId = ids[0];
  room.message = "ゲーム開始";

  return true;
}

function checkWinner(room) {
  const ids = room.order.filter(id => room.players[id]);
  if (ids.length !== 2) return false;

  const a = room.players[ids[0]];
  const b = room.players[ids[1]];

  if (a.hand.length === 0 && b.hand.length > 0) {
    room.finished = true;
    room.loserId = b.id;
    room.message = `${b.name} がババを持って負けました`;
    return true;
  }

  if (b.hand.length === 0 && a.hand.length > 0) {
    room.finished = true;
    room.loserId = a.id;
    room.message = `${a.name} がババを持って負けました`;
    return true;
  }

  return false;
}

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ roomId, name }) => {
    if (!roomId || !name) return;

    const room = getRoom(roomId);

    if (room.order.length >= 2) {
      socket.emit("joinError", "この部屋は満員です");
      return;
    }

    room.players[socket.id] = {
      id: socket.id,
      name,
      hand: []
    };
    room.order.push(socket.id);

    socket.join(roomId);

    if (room.order.length === 1) {
      room.message = "対戦相手を待っています";
    } else if (room.order.length === 2) {
      room.message = "2人そろいました。開始してください";
    }

    emitRoom(roomId);
  });

  socket.on("startGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.order.length !== 2) return;

    startGame(room);
    emitRoom(roomId);
  });

  socket.on("restartGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.order.length !== 2) return;

    startGame(room);
    emitRoom(roomId);
  });

  socket.on("drawCard", ({ roomId, index }) => {
    const room = rooms[roomId];
    if (!room || !room.started || room.finished) return;
    if (room.turnPlayerId !== socket.id) return;

    const current = room.players[socket.id];
    const opponentId = room.order.find(id => id !== socket.id);
    const opponent = room.players[opponentId];

    if (!current || !opponent) return;
    if (index < 0 || index >= opponent.hand.length) return;

    const drawn = opponent.hand.splice(index, 1)[0];
    current.hand.push(drawn);

    const result = removePairs(current.hand);
    current.hand = result.newHand;

    if (result.removedPairs.length > 0) {
      room.message = `${current.name} は ${drawn.label} を引き、ペアを捨てました: ${describePairs(result.removedPairs)}`;
    } else {
      room.message = `${current.name} は ${drawn.label} を引きました`;
    }

    if (checkWinner(room)) {
      emitRoom(roomId);
      return;
    }

    room.turnPlayerId = opponentId;
    emitRoom(roomId);
  });

  socket.on("disconnect", () => {
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      if (!room.players[socket.id]) continue;

      delete room.players[socket.id];
      room.order = room.order.filter(id => id !== socket.id);

      if (room.order.length === 0) {
        delete rooms[roomId];
      } else {
        resetRoomGameState(room);
        room.message = "相手が退出しました";
        emitRoom(roomId);
      }
      break;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});