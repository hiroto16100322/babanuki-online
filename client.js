const socket = io();

const modeSelect = document.getElementById("modeSelect");

let gameMode = "online";

// CPU戦用
const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

let cpuPlayerHand = [];
let cpuEnemyHand = [];
let cpuGameOver = false;
let cpuLockBoard = false;
let currentRoomId = "";
let joined = false;
let myId = "";
let lockBoard = false;
let highlightedDrawIndex = -1;

const statusEl = document.getElementById("status");
const playerCardsEl = document.getElementById("playerCards");
const enemyCardsEl = document.getElementById("enemyCards");
const restartButton = document.getElementById("restartButton");
const joinButton = document.getElementById("joinButton");
const startButton = document.getElementById("startButton");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const myNameEl = document.getElementById("myName");
const enemyNameEl = document.getElementById("enemyName");
const tequilaOverlay = document.getElementById("tequilaOverlay");
const closeTequilaButton = document.getElementById("closeTequilaButton");

socket.on("connect", () => {
  myId = socket.id;
});

socket.on("joinError", (message) => {
  alert(message);
});

socket.on("state", (state) => {
  if (modeSelect.value !== "online") return;
  render(state);
});

joinButton.addEventListener("click", () => {
  gameMode = modeSelect.value;

  if (gameMode === "cpu") {
    initCpuGame();
    return;
  }

  const name = nameInput.value.trim();
  const roomId = roomInput.value.trim();

  if (!name || !roomId) {
    alert("名前と部屋IDを入力してください");
    return;
  }

  currentRoomId = roomId;
  joined = true;
  socket.emit("joinRoom", { roomId, name });
});

startButton.addEventListener("click", () => {
  gameMode = modeSelect.value;

  if (gameMode === "cpu") {
    initCpuGame();
    return;
  }

  if (!joined || !currentRoomId) return;
  socket.emit("startGame", { roomId: currentRoomId });
});
restartButton.addEventListener("click", () => {
  gameMode = modeSelect.value;

  if (gameMode === "cpu") {
    initCpuGame();
    return;
  }

  if (!joined || !currentRoomId) return;
  socket.emit("restartGame", { roomId: currentRoomId });
});
closeTequilaButton.addEventListener("click", () => {
  hideTequilaLoseEffect();
  if (!joined || !currentRoomId) return;
  socket.emit("restartGame", { roomId: currentRoomId });
});

function showTequilaLoseEffect() {
  tequilaOverlay.classList.remove("hidden");
}

function hideTequilaLoseEffect() {
  tequilaOverlay.classList.add("hidden");
}

function getHandTargetPosition() {
  const rect = playerCardsEl.getBoundingClientRect();
  return {
    left: rect.left + rect.width / 2 - 36,
    top: rect.top + rect.height / 2 - 52
  };
}

function animateDrawToHand(clickedElement, callback) {
  const startRect = clickedElement.getBoundingClientRect();
  const target = getHandTargetPosition();

  const flyCard = document.createElement("div");
  flyCard.className = "fly-card";
  flyCard.textContent = "🂠";
  flyCard.style.left = `${startRect.left}px`;
  flyCard.style.top = `${startRect.top}px`;
  flyCard.style.transform = "scale(1) rotate(0deg)";
  document.body.appendChild(flyCard);

  requestAnimationFrame(() => {
    flyCard.style.left = `${target.left}px`;
    flyCard.style.top = `${target.top}px`;
    flyCard.style.transform = "scale(1.08) rotate(-10deg)";
  });

  setTimeout(() => {
    flyCard.remove();
    callback();
  }, 580);
}

function renderPlayerCards(hand) {
  playerCardsEl.innerHTML = "";

  const spread = 42;
  const rotateStep = 8;
  const center = (hand.length - 1) / 2;

  hand.forEach((card, index) => {
    const cardEl = document.createElement("div");
    cardEl.className = "card";

    if (card.suit === "♥" || card.suit === "♦") {
      cardEl.classList.add("red");
    }

    if (index === highlightedDrawIndex) {
      cardEl.classList.add("highlight-draw");
    }

    cardEl.textContent = card.label;

    const offset = (index - center) * spread;
    const angle = (index - center) * rotateStep;
    const lift = -Math.abs(index - center) * 2;

    cardEl.style.transform =
      `translateX(${offset}px) translateY(${lift}px) rotate(${angle}deg)`;

    playerCardsEl.appendChild(cardEl);
  });
}

function renderEnemyCards(state) {
  enemyCardsEl.innerHTML = "";

  if (!state.opponent) return;

  const isMyTurn = state.turnPlayerId === myId;
  const clickable = state.started && !state.finished && isMyTurn && !lockBoard;

  for (let i = 0; i < state.opponent.handCount; i++) {
    const cardEl = document.createElement("div");
    cardEl.className = "card back";
    cardEl.textContent = "🂠";

    if (!clickable) {
      cardEl.classList.add("disabled");
    } else {
      cardEl.addEventListener("click", () => {
        if (lockBoard) return;
        lockBoard = true;
        statusEl.textContent = "カードを引いています...";

        animateDrawToHand(cardEl, () => {
          socket.emit("drawCard", {
            roomId: state.roomId,
            index: i
          });

          setTimeout(() => {
            lockBoard = false;
          }, 250);
        });
      });
    }

    enemyCardsEl.appendChild(cardEl);
  }
}

function renderStatus(state) {
  if (!state.me) {
    statusEl.textContent = "部屋に入ってください。";
    return;
  }

  if (!state.opponent) {
    statusEl.textContent = "対戦相手を待っています。";
    return;
  }

  if (!state.started) {
    statusEl.textContent = state.message || "開始待ちです。";
    return;
  }

  if (state.finished) {
    if (state.loserId === myId) {
      statusEl.textContent = "😢 あなたの負け…";
      showTequilaLoseEffect();
    } else {
      statusEl.textContent = "🎉 あなたの勝ち！";
      hideTequilaLoseEffect();
    }
    return;
  }

  hideTequilaLoseEffect();

  if (state.turnPlayerId === myId) {
    statusEl.textContent = state.message
      ? `あなたのターンです。相手の青いカードをクリックしてください。 / ${state.message}`
      : "あなたのターンです。相手の青いカードをクリックしてください。";
  } else {
    statusEl.textContent = state.message
      ? `相手のターンです。 / ${state.message}`
      : "相手のターンです。";
  }
}

function render(state) {
  myNameEl.textContent = state.me ? state.me.name : "あなた";
  enemyNameEl.textContent = state.opponent ? state.opponent.name : "相手";

  renderStatus(state);
  renderPlayerCards(state.me ? state.me.hand : []);
  renderEnemyCards(state);
}
const bgm = document.getElementById("bgm");
const bgmToggleBtn = document.getElementById("bgmToggle");

function updateBgmButton() {
  if (!bgm || !bgmToggleBtn) return;
  bgmToggleBtn.textContent = bgm.paused ? "🔇 BGM OFF" : "🔊 BGM ON";
}

bgm.volume = 0.25;

bgmToggleBtn.addEventListener("click", async () => {
  try {
    if (bgm.paused) {
      await bgm.play();
    } else {
      bgm.pause();
    }
    updateBgmButton();
  } catch (error) {
    console.error("BGM error:", error);
  }
});

updateBgmButton();
function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank, label: `${suit}${rank}` });
    }
  }
  deck.push({ suit: "🃏", rank: "JOKER", label: "🃏" });
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

function initCpuGame() {
  cpuGameOver = false;
  cpuLockBoard = false;
  highlightedDrawIndex = -1;
  hideTequilaLoseEffect();

  do {
    const deck = shuffle(createDeck());
    cpuPlayerHand = [];
    cpuEnemyHand = [];

    deck.forEach((card, index) => {
      if (index % 2 === 0) {
        cpuPlayerHand.push(card);
      } else {
        cpuEnemyHand.push(card);
      }
    });

    cpuPlayerHand = removePairs(cpuPlayerHand).newHand;
    cpuEnemyHand = removePairs(cpuEnemyHand).newHand;
  } while (cpuPlayerHand.length === 0 || cpuEnemyHand.length === 0);

  myNameEl.textContent = nameInput.value.trim() || "あなた";
  enemyNameEl.textContent = "コンピューター";
  statusEl.textContent = "あなたのターンです。コンピューターの青いカードをクリックしてください。";

  renderCpuGame();
}

function renderCpuGame() {
  renderPlayerCards(cpuPlayerHand);

  enemyCardsEl.innerHTML = "";
  cpuEnemyHand.forEach((_, index) => {
    const cardEl = document.createElement("div");
    cardEl.className = "card back";
    cardEl.textContent = "🂠";

    if (!cpuLockBoard && !cpuGameOver) {
      cardEl.addEventListener("click", () => playerDrawCpu(index, cardEl));
    } else {
      cardEl.classList.add("disabled");
    }

    enemyCardsEl.appendChild(cardEl);
  });
}

function checkCpuWinner() {
  if (cpuGameOver) return true;

  if (cpuPlayerHand.length === 0) {
    statusEl.textContent = "🎉 あなたの勝ち！";
    cpuGameOver = true;
    cpuLockBoard = true;
    return true;
  }

  if (cpuEnemyHand.length === 0) {
    statusEl.textContent = "😢 あなたの負け…";
    cpuGameOver = true;
    cpuLockBoard = true;
    showTequilaLoseEffect();
    return true;
  }

  return false;
}

function playerDrawCpu(index, clickedElement) {
  if (cpuGameOver || cpuLockBoard) return;
  if (index < 0 || index >= cpuEnemyHand.length) return;

  cpuLockBoard = true;
  const drawn = cpuEnemyHand[index];
  statusEl.textContent = "カードを引いています...";

  animateDrawToHand(clickedElement, () => {
    cpuEnemyHand.splice(index, 1);
    cpuPlayerHand.push(drawn);
    highlightedDrawIndex = cpuPlayerHand.length - 1;
    renderCpuGame();

    statusEl.textContent = `あなたは ${drawn.label} を引きました`;

    setTimeout(() => {
      highlightedDrawIndex = -1;

      const result = removePairs(cpuPlayerHand);
      cpuPlayerHand = result.newHand;
      renderCpuGame();

      if (result.removedPairs.length > 0) {
        statusEl.textContent = `あなたはペアを捨てました: ${describePairs(result.removedPairs)}`;
      } else {
        statusEl.textContent = `あなたは ${drawn.label} を引きました。ペアはできませんでした。`;
      }

      if (checkCpuWinner()) return;
      setTimeout(enemyTurnCpu, 900);
    }, 800);
  });
}

function enemyTurnCpu() {
  if (cpuGameOver) return;
  if (cpuPlayerHand.length === 0) return;

  const index = Math.floor(Math.random() * cpuPlayerHand.length);
  const drawn = cpuPlayerHand.splice(index, 1)[0];
  cpuEnemyHand.push(drawn);
  renderCpuGame();

  statusEl.textContent = "🤖 コンピューターがあなたのカードを1枚引きました";

  setTimeout(() => {
    const result = removePairs(cpuEnemyHand);
    cpuEnemyHand = result.newHand;
    renderCpuGame();

    if (result.removedPairs.length > 0) {
      statusEl.textContent = "🤖 コンピューターはペアを捨てました。あなたのターンです。";
    } else {
      statusEl.textContent = "🤖 コンピューターはペアを作れませんでした。あなたのターンです。";
    }

    if (checkCpuWinner()) return;

    cpuLockBoard = false;
    renderCpuGame();
  }, 800);
}
