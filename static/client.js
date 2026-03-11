(() => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");

  const startScreen = document.getElementById("start-screen");
  const joinForm = document.getElementById("join-form");
  const nicknameInput = document.getElementById("nickname-input");
  const myNameEl = document.getElementById("my-name");

  const chatInputWrap = document.getElementById("chat-input-wrap");
  const chatInput = document.getElementById("chat-input");
  const lobbyFeed = document.getElementById("lobby-feed");

  const privateChatEl = document.getElementById("private-chat");
  const pmTitle = document.getElementById("pm-title");
  const pmFeed = document.getElementById("pm-feed");
  const pmInput = document.getElementById("pm-input");
  const pmSendBtn = document.getElementById("pm-send");

  const contextMenu = document.getElementById("context-menu");
  const friendBtn = document.getElementById("friend-btn");
  const pmBtn = document.getElementById("pm-btn");

  const socket = io();

  const FIXED_DT = 1 / 60;
  const GRAVITY = 1850;
  const MOVE_ACCEL = 2600;
  const MAX_RUN_SPEED = 380;
  const GROUND_FRICTION = 12;
  const AIR_FRICTION = 2.3;
  const JUMP_VELOCITY = -760;
  const PROXIMITY_RADIUS = 340;

  let world = { width: 2600, height: 1300, spawn: { x: 1300, y: 500 } };
  let platforms = buildPlatforms(world);
  let myId = null;
  let joined = false;

  const player = {
    id: null,
    nickname: "",
    x: world.spawn.x,
    y: world.spawn.y,
    vx: 0,
    vy: 0,
    width: 52,
    height: 68,
    onGround: false,
    direction: 1,
    bubble: "",
    bubbleUntil: 0,
  };

  const remotePlayers = new Map();
  const privateThreads = new Map();
  let activePrivateTargetId = null;

  const keys = {
    left: false,
    right: false,
    jumpHeld: false,
  };
  let jumpQueued = false;

  let accum = 0;
  let prevTs = performance.now();
  let stateSendTimer = 0;

  const camera = { x: 0, y: 0 };
  let contextTargetId = null;

  function buildPlatforms(currentWorld) {
    const w = currentWorld.width;
    const h = currentWorld.height;
    const border = 80;

    return [
      { x: 0, y: h - 80, w, h: 80 },
      { x: -border, y: 0, w: border, h },
      { x: w, y: 0, w: border, h },
      { x: 0, y: -border, w, h: border },
      { x: 180, y: h - 250, w: 360, h: 26 },
      { x: 610, y: h - 360, w: 290, h: 24 },
      { x: 990, y: h - 230, w: 310, h: 24 },
      { x: 1380, y: h - 370, w: 330, h: 24 },
      { x: 1810, y: h - 260, w: 310, h: 24 },
      { x: 2180, y: h - 420, w: 240, h: 24 },
      { x: 1060, y: h - 520, w: 520, h: 22 },
      { x: 900, y: h - 700, w: 250, h: 20 },
      { x: 1450, y: h - 680, w: 250, h: 20 },
    ];
  }

  function addFeedLine(text, type = "normal") {
    const line = document.createElement("div");
    line.className = `feed-line ${type}`;
    line.textContent = text;
    lobbyFeed.appendChild(line);
    while (lobbyFeed.children.length > 80) {
      lobbyFeed.removeChild(lobbyFeed.firstChild);
    }
    lobbyFeed.scrollTop = lobbyFeed.scrollHeight;
  }

  function addPrivateLine(targetId, linePayload) {
    if (!privateThreads.has(targetId)) {
      privateThreads.set(targetId, { nickname: linePayload.partnerNickname, messages: [] });
    }
    const thread = privateThreads.get(targetId);
    if (linePayload.partnerNickname) {
      thread.nickname = linePayload.partnerNickname;
    }
    thread.messages.push(linePayload);
    while (thread.messages.length > 100) {
      thread.messages.shift();
    }

    if (activePrivateTargetId === targetId) {
      renderPrivateChat();
    }
  }

  function renderPrivateChat() {
    if (!activePrivateTargetId || !privateThreads.has(activePrivateTargetId)) {
      privateChatEl.classList.add("hidden");
      return;
    }

    const thread = privateThreads.get(activePrivateTargetId);
    privateChatEl.classList.remove("hidden");
    pmTitle.textContent = `1:1 대화 - ${thread.nickname}`;
    pmFeed.innerHTML = "";

    thread.messages.forEach((msg) => {
      const line = document.createElement("div");
      line.className = "feed-line private";
      line.textContent = `${msg.author}: ${msg.text}`;
      pmFeed.appendChild(line);
    });
    pmFeed.scrollTop = pmFeed.scrollHeight;
  }

  function openPrivateChat(targetId, nickname) {
    if (!privateThreads.has(targetId)) {
      privateThreads.set(targetId, { nickname, messages: [] });
    }
    activePrivateTargetId = targetId;
    renderPrivateChat();
    pmInput.focus();
  }

  function hideContextMenu() {
    contextMenu.classList.add("hidden");
    contextTargetId = null;
  }

  function showContextMenu(targetId, x, y) {
    contextTargetId = targetId;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove("hidden");
  }

  function worldFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * canvas.width;
    const sy = ((clientY - rect.top) / rect.height) * canvas.height;
    return {
      x: sx + camera.x,
      y: sy + camera.y,
      sx,
      sy,
    };
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function intersects(a, b) {
    return (
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top
    );
  }

  function playerRect(px = player.x, py = player.y) {
    const hw = player.width * 0.5;
    const hh = player.height * 0.5;
    return {
      left: px - hw,
      right: px + hw,
      top: py - hh,
      bottom: py + hh,
      hw,
      hh,
    };
  }

  function stepMovement(dt) {
    if (!joined) {
      return;
    }

    const intent = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    player.vx += intent * MOVE_ACCEL * dt;

    if (!intent) {
      const friction = player.onGround ? GROUND_FRICTION : AIR_FRICTION;
      const decay = Math.max(0, 1 - friction * dt);
      player.vx *= decay;
      if (Math.abs(player.vx) < 2.6) {
        player.vx = 0;
      }
    }

    player.vx = clamp(player.vx, -MAX_RUN_SPEED, MAX_RUN_SPEED);
    if (Math.abs(player.vx) > 1) {
      player.direction = player.vx < 0 ? -1 : 1;
    }

    if (jumpQueued && player.onGround) {
      player.vy = JUMP_VELOCITY;
      player.onGround = false;
    }
    jumpQueued = false;

    player.vy += GRAVITY * dt;
    player.vy = clamp(player.vy, -1000, 1400);

    player.x += player.vx * dt;
    let rect = playerRect(player.x, player.y);
    for (const plat of platforms) {
      const platRect = {
        left: plat.x,
        right: plat.x + plat.w,
        top: plat.y,
        bottom: plat.y + plat.h,
      };
      if (!intersects(rect, platRect)) {
        continue;
      }
      if (player.vx > 0) {
        player.x = platRect.left - rect.hw;
      } else if (player.vx < 0) {
        player.x = platRect.right + rect.hw;
      }
      player.vx = 0;
      rect = playerRect(player.x, player.y);
    }

    player.y += player.vy * dt;
    rect = playerRect(player.x, player.y);
    player.onGround = false;
    for (const plat of platforms) {
      const platRect = {
        left: plat.x,
        right: plat.x + plat.w,
        top: plat.y,
        bottom: plat.y + plat.h,
      };
      if (!intersects(rect, platRect)) {
        continue;
      }
      if (player.vy > 0) {
        player.y = platRect.top - rect.hh;
        player.vy = 0;
        player.onGround = true;
      } else if (player.vy < 0) {
        player.y = platRect.bottom + rect.hh;
        player.vy = 0;
      }
      rect = playerRect(player.x, player.y);
    }

    player.x = clamp(player.x, rect.hw, world.width - rect.hw);
    if (player.y < rect.hh) {
      player.y = rect.hh;
      player.vy = 0;
    }

    const escaped =
      player.x < -150 ||
      player.x > world.width + 150 ||
      player.y < -250 ||
      player.y > world.height + 250;

    if (escaped || player.y > world.height + 120) {
      player.x = world.spawn.x;
      player.y = world.spawn.y;
      player.vx = 0;
      player.vy = 0;
      addFeedLine("로비 바깥으로 벗어나 중앙으로 복귀했습니다.", "system");
    }

    camera.x = clamp(player.x - canvas.width * 0.5, 0, world.width - canvas.width);
    camera.y = clamp(player.y - canvas.height * 0.5, 0, world.height - canvas.height);

    stateSendTimer += dt;
    if (stateSendTimer > 0.05) {
      stateSendTimer = 0;
      socket.emit("player_state", {
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        direction: player.direction,
      });
    }
  }

  function drawBackground() {
    const grd = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grd.addColorStop(0, "#bfe8ff");
    grd.addColorStop(1, "#6ac59b");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#ffffff80";
    for (let i = 0; i < 8; i += 1) {
      const x = ((i * 170) - camera.x * 0.2) % (canvas.width + 200) - 100;
      const y = 80 + (i % 3) * 48;
      ctx.beginPath();
      ctx.ellipse(x, y, 65, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#8fc59d";
    for (let i = 0; i < 6; i += 1) {
      const w = 250;
      const x = ((i * 300) - camera.x * 0.34) % (canvas.width + 330) - 120;
      const y = canvas.height - 190 - (i % 2) * 45;
      ctx.beginPath();
      ctx.moveTo(x, canvas.height);
      ctx.lineTo(x + w * 0.5, y);
      ctx.lineTo(x + w, canvas.height);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPlatform(plat) {
    ctx.fillStyle = "#5e4f3e";
    ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
    ctx.fillStyle = "#77b86e";
    ctx.fillRect(plat.x, plat.y, plat.w, Math.min(11, plat.h));
  }

  function drawSpeechBubble(text, x, y) {
    const padding = 8;
    ctx.font = "14px Pretendard, Noto Sans KR, sans-serif";
    const textW = ctx.measureText(text).width;
    const width = textW + padding * 2;
    const height = 28;
    const bx = x - width * 0.5;
    const by = y - 54;

    ctx.fillStyle = "#ffffffea";
    ctx.strokeStyle = "#27304350";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, width, height, 8);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - 6, by + height);
    ctx.lineTo(x + 6, by + height);
    ctx.lineTo(x, by + height + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#111";
    ctx.textAlign = "center";
    ctx.fillText(text, x, by + 19);
  }

  function drawPlayer(entity, isMine = false) {
    const w = player.width;
    const h = player.height;
    const x = entity.x - w * 0.5;
    const y = entity.y - h * 0.5;

    ctx.fillStyle = isMine ? "#2564c7" : "#d14e4e";
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = "#fbe6c7";
    ctx.fillRect(x + 12, y + 10, w - 24, 22);

    ctx.fillStyle = "#111";
    ctx.font = "14px Pretendard, Noto Sans KR, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(entity.nickname, entity.x, y - 10);

    if (entity.bubble && entity.bubbleUntil > performance.now() / 1000) {
      drawSpeechBubble(entity.bubble, entity.x, y - 2);
    }

    ctx.fillStyle = "#0d1824";
    const eyeOffset = entity.direction < 0 ? -8 : 8;
    ctx.beginPath();
    ctx.arc(entity.x + eyeOffset, y + 24, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWorld() {
    drawBackground();

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    platforms.forEach((plat) => drawPlatform(plat));
    remotePlayers.forEach((p) => drawPlayer(p, false));
    drawPlayer(player, true);

    ctx.restore();

    ctx.fillStyle = "#00000080";
    ctx.fillRect(12, 12, 338, 78);
    ctx.fillStyle = "#fff";
    ctx.font = "15px Pretendard, Noto Sans KR, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`플레이어 수: ${remotePlayers.size + 1}`, 24, 38);
    ctx.fillText(`좌표: (${Math.round(player.x)}, ${Math.round(player.y)})`, 24, 60);
    ctx.fillText("방향키 좌우 / 스페이스 점프 / Enter 로비 채팅", 24, 82);
  }

  function updateFromSnapshot(snapshot) {
    const seen = new Set();
    const nowPerf = performance.now() / 1000;

    snapshot.players.forEach((entry) => {
      if (entry.id === myId) {
        const dx = Math.abs(entry.x - player.x);
        const dy = Math.abs(entry.y - player.y);
        if (dx > 140 || dy > 140) {
          player.x = entry.x;
          player.y = entry.y;
          player.vx = entry.vx;
          player.vy = entry.vy;
        }
        player.bubble = entry.bubble || "";
        player.bubbleUntil = entry.bubble_until || 0;
      } else {
        const existing = remotePlayers.get(entry.id) || {
          id: entry.id,
          nickname: entry.nickname,
          x: entry.x,
          y: entry.y,
          vx: entry.vx,
          vy: entry.vy,
          direction: entry.direction,
          bubble: "",
          bubbleUntil: 0,
        };

        existing.nickname = entry.nickname;
        existing.x = entry.x;
        existing.y = entry.y;
        existing.vx = entry.vx;
        existing.vy = entry.vy;
        existing.direction = entry.direction || 1;
        existing.bubble = entry.bubble || "";
        existing.bubbleUntil = entry.bubble_until || 0;
        remotePlayers.set(entry.id, existing);
      }
      seen.add(entry.id);
    });

    for (const id of remotePlayers.keys()) {
      if (!seen.has(id)) {
        remotePlayers.delete(id);
      }
    }

    remotePlayers.forEach((p) => {
      if (p.bubble && p.bubbleUntil < nowPerf) {
        p.bubble = "";
      }
    });
  }

  function sendPublicChat() {
    const text = chatInput.value.trim();
    if (!text) {
      chatInputWrap.classList.add("hidden");
      chatInput.value = "";
      return;
    }

    socket.emit("public_chat", { text });
    chatInput.value = "";
    chatInputWrap.classList.add("hidden");
    canvas.focus();
  }

  function sendPrivateChat() {
    const text = pmInput.value.trim();
    if (!text || !activePrivateTargetId) {
      return;
    }
    socket.emit("private_message", {
      target_id: activePrivateTargetId,
      text,
    });
    pmInput.value = "";
  }

  function findContextTarget(worldPos) {
    let candidate = null;
    let best = Number.POSITIVE_INFINITY;

    for (const remote of remotePlayers.values()) {
      const localDist = Math.hypot(remote.x - player.x, remote.y - player.y);
      if (localDist > 155) {
        continue;
      }
      const clickDist = Math.hypot(remote.x - worldPos.x, remote.y - worldPos.y);
      if (clickDist > 95) {
        continue;
      }
      if (clickDist < best) {
        best = clickDist;
        candidate = remote;
      }
    }
    return candidate;
  }

  function step(dt) {
    stepMovement(dt);
  }

  function render() {
    drawWorld();
  }

  function gameLoop(now) {
    const delta = Math.min(0.05, (now - prevTs) / 1000);
    prevTs = now;
    accum += delta;
    while (accum >= FIXED_DT) {
      step(FIXED_DT);
      accum -= FIXED_DT;
    }
    render();
    requestAnimationFrame(gameLoop);
  }

  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const nickname = nicknameInput.value.trim();
    if (!nickname) {
      nicknameInput.focus();
      return;
    }
    socket.emit("join_lobby", { nickname });
  });

  socket.on("joined", ({ id, world: serverWorld, snapshot }) => {
    myId = id;
    joined = true;
    player.id = id;
    player.nickname = nicknameInput.value.trim().slice(0, 16) || "Guest";
    myNameEl.textContent = player.nickname;

    if (serverWorld) {
      world = serverWorld;
      platforms = buildPlatforms(world);
      player.x = world.spawn.x;
      player.y = world.spawn.y;
      player.vx = 0;
      player.vy = 0;
    }

    if (snapshot) {
      updateFromSnapshot(snapshot);
    }

    startScreen.classList.remove("show");
    addFeedLine("로비 입장 완료. Enter를 눌러 채팅을 시작하세요.", "system");
  });

  socket.on("state_snapshot", (snapshot) => {
    if (!joined) {
      return;
    }
    updateFromSnapshot(snapshot);
  });

  socket.on("system_notice", ({ message }) => {
    addFeedLine(message, "system");
  });

  socket.on("player_left", ({ id }) => {
    remotePlayers.delete(id);
  });

  socket.on("public_chat", (payload) => {
    const now = performance.now() / 1000;
    if (payload.from_id === myId) {
      player.bubble = payload.text;
      player.bubbleUntil = now + 5.5;
      addFeedLine(`${payload.nickname}: ${payload.text}`);
      return;
    }

    const remote = remotePlayers.get(payload.from_id);
    if (remote) {
      remote.bubble = payload.text;
      remote.bubbleUntil = now + 5.5;
    }

    if (Math.hypot(payload.x - player.x, payload.y - player.y) <= PROXIMITY_RADIUS) {
      addFeedLine(`${payload.nickname}: ${payload.text}`);
    }
  });

  socket.on("friend_added", ({ friend_id, friend_nickname }) => {
    addFeedLine(`${friend_nickname} 님과 친구가 되었습니다.`, "system");
    if (!privateThreads.has(friend_id)) {
      privateThreads.set(friend_id, { nickname: friend_nickname, messages: [] });
    }
  });

  socket.on("private_message", (msg) => {
    const partnerId = msg.from_id === myId ? msg.target_id : msg.from_id;
    const partnerName = msg.from_id === myId ? msg.target_nickname : msg.from_nickname;
    const author = msg.from_id === myId ? "나" : msg.from_nickname;
    addPrivateLine(partnerId, {
      author,
      text: msg.text,
      partnerNickname: partnerName,
    });

    if (activePrivateTargetId === null) {
      activePrivateTargetId = partnerId;
    }
    renderPrivateChat();
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!joined) {
      return;
    }

    const worldPos = worldFromClient(event.clientX, event.clientY);
    const target = findContextTarget(worldPos);

    if (!target) {
      hideContextMenu();
      addFeedLine("플레이어 가까이에서 우클릭하면 상호작용할 수 있습니다.", "system");
      return;
    }

    showContextMenu(target.id, worldPos.sx + 8, worldPos.sy + 8);
  });

  friendBtn.addEventListener("click", () => {
    if (contextTargetId) {
      socket.emit("friend_request", { target_id: contextTargetId });
    }
    hideContextMenu();
  });

  pmBtn.addEventListener("click", () => {
    if (!contextTargetId) {
      return;
    }
    const target = remotePlayers.get(contextTargetId);
    if (target) {
      openPrivateChat(target.id, target.nickname);
    }
    hideContextMenu();
  });

  pmSendBtn.addEventListener("click", sendPrivateChat);
  pmInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      sendPrivateChat();
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#context-menu")) {
      hideContextMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }

    if (event.key === "ArrowLeft") {
      keys.left = true;
    } else if (event.key === "ArrowRight") {
      keys.right = true;
    } else if (event.key === " " || event.code === "Space") {
      keys.jumpHeld = true;
      jumpQueued = true;
      event.preventDefault();
    }

    if (!joined) {
      return;
    }

    if (event.key === "Escape") {
      chatInputWrap.classList.add("hidden");
      hideContextMenu();
      canvas.focus();
      return;
    }

    if (event.key === "Enter") {
      if (document.activeElement === pmInput) {
        return;
      }
      if (chatInputWrap.classList.contains("hidden")) {
        chatInputWrap.classList.remove("hidden");
        chatInput.focus();
      } else {
        sendPublicChat();
      }
    }

    if (event.key.toLowerCase() === "f") {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        canvas.requestFullscreen().catch(() => {});
      }
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.key === "ArrowLeft") {
      keys.left = false;
    } else if (event.key === "ArrowRight") {
      keys.right = false;
    } else if (event.key === " " || event.code === "Space") {
      keys.jumpHeld = false;
    }
  });

  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      sendPublicChat();
    }
  });

  window.render_game_to_text = () => {
    const nearby = [];
    remotePlayers.forEach((p) => {
      const d = Math.hypot(p.x - player.x, p.y - player.y);
      if (d <= PROXIMITY_RADIUS) {
        nearby.push({ id: p.id, nickname: p.nickname, x: Math.round(p.x), y: Math.round(p.y) });
      }
    });

    return JSON.stringify({
      mode: joined ? "lobby" : "start",
      coordinate_system: "origin=(top-left), +x=right, +y=down",
      me: {
        id: myId,
        nickname: player.nickname,
        x: Math.round(player.x),
        y: Math.round(player.y),
        vx: Math.round(player.vx),
        vy: Math.round(player.vy),
        on_ground: player.onGround,
      },
      nearby_players: nearby,
      ui: {
        public_chat_open: !chatInputWrap.classList.contains("hidden"),
        private_target: activePrivateTargetId,
      },
      counts: {
        total_players: remotePlayers.size + (joined ? 1 : 0),
        platforms: platforms.length,
      },
    });
  };

  window.advanceTime = (ms) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      step(FIXED_DT);
    }
    render();
  };

  requestAnimationFrame(gameLoop);
})();
