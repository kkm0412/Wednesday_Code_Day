(() => {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");

  const startScreen = document.getElementById("start-screen");
  const joinForm = document.getElementById("join-form");
  const nicknameInput = document.getElementById("nickname-input");
  const myNameEl = document.getElementById("my-name");
  const myHpEl = document.getElementById("my-hp");
  const myCoinEl = document.getElementById("my-coin");

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
  const minigameBtn = document.getElementById("minigame-btn");

  const inviteModal = document.getElementById("invite-modal");
  const inviteText = document.getElementById("invite-text");
  const inviteAcceptBtn = document.getElementById("invite-accept");
  const inviteDeclineBtn = document.getElementById("invite-decline");

  const socket = io();

  const FIXED_DT = 1 / 60;
  const GRAVITY = 1920;
  const MOVE_ACCEL = 2700;
  const MAX_RUN_SPEED = 395;
  const GROUND_FRICTION = 13;
  const AIR_FRICTION = 2.35;

  const JUMP_IMPULSE = -830;
  const JUMP_HOLD_FORCE = 2100;
  const JUMP_HOLD_TIME = 0.18;
  const JUMP_CUT_MULTIPLIER = 0.48;

  const PROXIMITY_RADIUS = 340;
  const PORTAL_INTERACT_RADIUS = 120;
  const LOBBY_REGEN_PER_SECOND = 2.4;

  let world = {
    width: 2800,
    height: 1400,
    spawn: { x: 1400, y: 540 },
    portal: { x: 1325, y: 1180, w: 150, h: 140, target: "/dungeon" },
  };
  let platforms = buildPlatforms(world);
  let decorations = buildDecorations(world);

  let myId = null;
  let joined = false;
  let joinRequested = false;
  let inPortalRange = false;
  let contextTargetId = null;

  const player = {
    id: null,
    profileId: null,
    nickname: "",
    hp: 100,
    coin: 0,
    x: world.spawn.x,
    y: world.spawn.y,
    vx: 0,
    vy: 0,
    width: 56,
    height: 74,
    onGround: false,
    direction: 1,
    bubble: "",
    bubbleUntil: 0,
    maxHp: 100,
    regenPulse: 0,
  };

  const remotePlayers = new Map();
  const privateThreads = new Map();
  const pendingInvite = { fromId: null, fromName: "" };

  let activePrivateTargetId = null;

  const keys = {
    left: false,
    right: false,
    jumpHeld: false,
    up: false,
  };

  let jumpQueued = false;
  let jumpHolding = false;
  let jumpHoldTimer = 0;
  let jumpCutQueued = false;
  let interactQueued = false;
  let chatComposing = false;
  let pmComposing = false;

  let accum = 0;
  let prevTs = performance.now();
  let stateSendTimer = 0;

  const camera = { x: 0, y: 0 };

  function buildPlatforms(currentWorld) {
    const w = currentWorld.width;
    const h = currentWorld.height;
    const border = 84;

    return [
      { x: 0, y: h - 80, w, h: 80 },
      { x: -border, y: 0, w: border, h },
      { x: w, y: 0, w: border, h },
      { x: 0, y: -border, w, h: border },
      { x: 220, y: h - 280, w: 360, h: 26 },
      { x: 680, y: h - 380, w: 280, h: 24 },
      { x: 1040, y: h - 260, w: 340, h: 24 },
      { x: 1500, y: h - 390, w: 360, h: 24 },
      { x: 1940, y: h - 280, w: 300, h: 24 },
      { x: 2290, y: h - 450, w: 260, h: 24 },
      { x: 1110, y: h - 540, w: 560, h: 22 },
      { x: 920, y: h - 730, w: 240, h: 20 },
      { x: 1660, y: h - 730, w: 240, h: 20 },
      { x: 1320, y: h - 190, w: 160, h: 18 },
    ];
  }

  function buildDecorations(currentWorld) {
    const w = currentWorld.width;
    const h = currentWorld.height;
    return {
      farTrees: [
        { x: 210, trunkW: 170, leafR: 170 },
        { x: w * 0.5, trunkW: 150, leafR: 162 },
        { x: w - 230, trunkW: 165, leafR: 175 },
      ],
      midTrees: [
        { x: 540, trunkW: 108, canopyR: 105, branchTilt: 1 },
        { x: 1260, trunkW: 116, canopyR: 112, branchTilt: -1 },
        { x: 2080, trunkW: 102, canopyR: 96, branchTilt: 1 },
      ],
      house: {
        x: 300,
        y: h - 560,
        w: 220,
        h: 180,
      },
    };
  }

  function savePlayerProfile() {
    const payload = {
      _id: player.profileId,
      nickname: player.nickname,
      hp: Math.round(player.hp),
      coin: player.coin,
    };
    sessionStorage.setItem("player_profile", JSON.stringify(payload));
  }

  function syncPlayerStatsUi() {
    myHpEl.textContent = String(Math.round(player.hp));
    myCoinEl.textContent = String(player.coin);
  }

  function parseProfileForStorage(payload) {
    if (!payload) {
      return;
    }
    player.profileId = payload._id || player.profileId;
    player.hp = Number.isFinite(payload.hp) ? payload.hp : player.hp;
    player.maxHp = Math.max(100, Number.isFinite(payload.max_hp) ? payload.max_hp : player.maxHp);
    player.coin = Number.isFinite(payload.coin) ? payload.coin : player.coin;

    syncPlayerStatsUi();
    savePlayerProfile();
  }

  function getStoredNickname() {
    const raw = sessionStorage.getItem("player_profile");
    if (!raw) {
      return "";
    }
    try {
      const parsed = JSON.parse(raw);
      const nickname = String(parsed?.nickname || "").trim();
      return nickname.slice(0, 16);
    } catch {
      return "";
    }
  }

  function requestJoinLobby(rawNickname) {
    if (joined || joinRequested) {
      return;
    }
    const nickname = String(rawNickname || "").trim().slice(0, 16);
    if (!nickname) {
      return;
    }
    joinRequested = true;
    socket.emit("join_lobby", { nickname });
  }

  function addFeedLine(text, type = "normal") {
    const line = document.createElement("div");
    line.className = `feed-line ${type}`;
    line.textContent = text;
    lobbyFeed.appendChild(line);

    while (lobbyFeed.children.length > 90) {
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
    pmTitle.textContent = `Private Chat - ${thread.nickname}`;
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

  function showInviteModal(fromId, fromName) {
    pendingInvite.fromId = fromId;
    pendingInvite.fromName = fromName;
    inviteText.textContent = `${fromName} sent you a minigame invite.`;
    inviteModal.classList.remove("hidden");
    inviteModal.classList.add("show");
  }

  function hideInviteModal() {
    pendingInvite.fromId = null;
    pendingInvite.fromName = "";
    inviteModal.classList.remove("show");
    inviteModal.classList.add("hidden");
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
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
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

  function portalRect() {
    return {
      left: world.portal.x,
      right: world.portal.x + world.portal.w,
      top: world.portal.y,
      bottom: world.portal.y + world.portal.h,
    };
  }

  function enterDungeonFromPortal() {
    savePlayerProfile();
    window.location.assign("/dungeon");
  }

  function stepMovement(dt) {
    if (!joined) {
      return;
    }

    const intent = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    player.vx += intent * MOVE_ACCEL * dt;

    if (!intent) {
      const friction = player.onGround ? GROUND_FRICTION : AIR_FRICTION;
      player.vx *= Math.max(0, 1 - friction * dt);
      if (Math.abs(player.vx) < 2.6) {
        player.vx = 0;
      }
    }

    player.vx = clamp(player.vx, -MAX_RUN_SPEED, MAX_RUN_SPEED);
    if (Math.abs(player.vx) > 1) {
      player.direction = player.vx < 0 ? -1 : 1;
    }

    if (jumpQueued && player.onGround) {
      player.vy = JUMP_IMPULSE;
      player.onGround = false;
      jumpHolding = true;
      jumpHoldTimer = 0;
    }
    jumpQueued = false;

    if (jumpHolding && keys.jumpHeld && jumpHoldTimer < JUMP_HOLD_TIME && player.vy < 0) {
      player.vy -= JUMP_HOLD_FORCE * dt;
      jumpHoldTimer += dt;
    }

    if ((!keys.jumpHeld || jumpHoldTimer >= JUMP_HOLD_TIME) && jumpHolding) {
      jumpHolding = false;
    }

    if (jumpCutQueued && player.vy < 0) {
      player.vy *= JUMP_CUT_MULTIPLIER;
      jumpCutQueued = false;
      jumpHolding = false;
    }

    player.vy += GRAVITY * dt;
    player.vy = clamp(player.vy, -1200, 1500);

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
      player.x < -170 ||
      player.x > world.width + 170 ||
      player.y < -250 ||
      player.y > world.height + 280;

    if (escaped || player.y > world.height + 120) {
      player.x = world.spawn.x;
      player.y = world.spawn.y;
      player.vx = 0;
      player.vy = 0;
      addFeedLine("You left the safe zone, so you were moved back to the center of the lobby.", "system");
    }

    const pr = portalRect();
    const centerDx = Math.abs(player.x - (pr.left + pr.right) * 0.5);
    const centerDy = Math.abs(player.y - (pr.top + pr.bottom) * 0.5);
    inPortalRange =
      intersects(playerRect(), pr) ||
      (centerDx < PORTAL_INTERACT_RADIUS && centerDy < PORTAL_INTERACT_RADIUS * 1.15);

    if (interactQueued) {
      interactQueued = false;
      if (inPortalRange) {
        addFeedLine("Entering the dungeon.", "system");
        enterDungeonFromPortal();
        return;
      }
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
    const now = performance.now() * 0.001;
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, "#c9f2ff");
    sky.addColorStop(0.56, "#e0fbf5");
    sky.addColorStop(1, "#f9fffc");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#dffff255";
    for (let i = 0; i < 5; i += 1) {
      const x = ((i * 290) - camera.x * 0.08) % (canvas.width + 420) - 210;
      const y = 96 + i * 84;
      ctx.fillRect(x, y, 460, 1);
    }

    for (let i = 0; i < 7; i += 1) {
      const x = ((i * 260) - camera.x * 0.11) % (canvas.width + 420) - 210;
      const y = 126 + (i % 4) * 84 + Math.sin(now * 0.6 + i) * 8;
      const w = 280 + (i % 3) * 40;
      const h = 42 + (i % 2) * 9;
      drawMistRibbon(x, y, w, h, 0.18 + (i % 3) * 0.04);
    }

    ctx.fillStyle = "#ffffff96";
    for (let i = 0; i < 16; i += 1) {
      const x = ((i * 180) - camera.x * 0.14) % (canvas.width + 240) - 120;
      const y = 56 + (i % 5) * 36 + Math.sin(now * 0.9 + i * 1.2) * 3.5;
      ctx.beginPath();
      ctx.ellipse(x, y, 94 - (i % 3) * 10, 24 - (i % 2) * 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawFarForestLayer();
    drawMidForestLayer();
    drawHouseSilhouette();

    for (let i = 0; i < 20; i += 1) {
      const x = ((i * 140) - camera.x * 0.18 + now * 14 * (i % 2 ? 1 : -1)) % (canvas.width + 120) - 60;
      const y = 116 + (i % 6) * 60 + Math.sin(now * 1.5 + i) * 5;
      drawTinySparkle(x, y, 0.17 + (i % 4) * 0.05);
    }
  }

  function roundedRectPath(x, y, w, h, r) {
    const radius = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function drawMistRibbon(x, y, w, h, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, "#ffffff00");
    grad.addColorStop(0.2, "#ffffff");
    grad.addColorStop(0.8, "#ffffff");
    grad.addColorStop(1, "#ffffff00");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(x + w * 0.5, y, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTinySparkle(x, y, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#f1fff8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x + 3, y);
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x, y + 3);
    ctx.stroke();
    ctx.restore();
  }

  function drawGrassTuft(x, y, scale = 1) {
    ctx.fillStyle = "#2d7a2d";
    ctx.beginPath();
    ctx.ellipse(x - 7 * scale, y, 4.6 * scale, 8.4 * scale, -0.2, 0, Math.PI * 2);
    ctx.ellipse(x, y - 1.5 * scale, 5.2 * scale, 9.5 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 7 * scale, y, 4.4 * scale, 8.2 * scale, 0.22, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#5ab552cc";
    ctx.beginPath();
    ctx.ellipse(x - 1.5 * scale, y - 4 * scale, 3.6 * scale, 4.7 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFlower(x, y, coreColor = "#ffd557") {
    ctx.fillStyle = "#ffffffdf";
    ctx.beginPath();
    ctx.arc(x - 3, y, 2.1, 0, Math.PI * 2);
    ctx.arc(x + 3, y, 2.1, 0, Math.PI * 2);
    ctx.arc(x, y - 3, 2.1, 0, Math.PI * 2);
    ctx.arc(x, y + 3, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = coreColor;
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#2f7f36";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x, y + 9);
    ctx.stroke();
  }

  function isBoundaryCollider(plat) {
    return plat.x < 0 || plat.y < 0 || plat.x + plat.w > world.width || plat.y + plat.h > world.height;
  }

  function isGroundPlatform(plat) {
    return plat.w >= world.width - 2 && plat.y >= world.height - 100;
  }

  function drawGroundPlatform(plat) {
    const topBand = 30;
    const soilY = plat.y + topBand;

    ctx.fillStyle = "#5ab552";
    roundedRectPath(plat.x, plat.y, plat.w, topBand + 8, 12);
    ctx.fill();

    ctx.fillStyle = "#3d1f00";
    roundedRectPath(plat.x, soilY, plat.w, plat.h - topBand + 10, 8);
    ctx.fill();

    ctx.fillStyle = "#77cf64b3";
    roundedRectPath(plat.x + 6, plat.y + 4, plat.w - 12, 9, 6);
    ctx.fill();

    ctx.fillStyle = "#2f1600aa";
    for (let i = 0; i < 22; i += 1) {
      const tx = plat.x + 20 + i * ((plat.w - 40) / 22);
      const ty = soilY + 10 + (i % 3) * 12;
      ctx.fillRect(tx, ty, 4, 2);
    }

    const tuftCount = Math.floor(plat.w / 180);
    for (let i = 0; i < tuftCount; i += 1) {
      const gx = plat.x + 56 + i * 175 + ((i % 3) - 1) * 14;
      drawGrassTuft(gx, plat.y + 8, 1);
      if (i % 2 === 0) {
        drawFlower(gx + 22, plat.y + 10, i % 4 === 0 ? "#ffe44d" : "#ffd372");
      }
    }
  }

  function drawFloatingPlatform(plat) {
    const topH = Math.min(14, Math.max(10, plat.h * 0.55));
    const sideY = plat.y + topH;
    const sideH = Math.max(8, plat.h - topH);

    ctx.fillStyle = "#3d1f00";
    roundedRectPath(plat.x, sideY - 1, plat.w, sideH + 6, 8);
    ctx.fill();

    ctx.fillStyle = "#5ab552";
    roundedRectPath(plat.x, plat.y - 2, plat.w, topH + 5, 8);
    ctx.fill();

    ctx.fillStyle = "#7bd867b5";
    roundedRectPath(plat.x + 4, plat.y, plat.w - 8, 5, 4);
    ctx.fill();

    ctx.strokeStyle = "#2f1900a6";
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i += 1) {
      const sx = plat.x + 18 + i * ((plat.w - 36) / 5);
      ctx.beginPath();
      ctx.moveTo(sx, sideY + 3);
      ctx.lineTo(sx + 8, sideY + sideH - 1);
      ctx.stroke();
    }

    const tuftCount = 3 + (Math.abs(Math.floor(plat.x / 120)) % 3);
    for (let i = 0; i < tuftCount; i += 1) {
      const ratio = tuftCount === 1 ? 0.5 : i / (tuftCount - 1);
      const gx = plat.x + 22 + ratio * (plat.w - 44);
      drawGrassTuft(gx, plat.y + 3, 0.7);
    }

    if (plat.w > 240) {
      drawVineWithLeaves(plat.x + plat.w * 0.22, sideY + sideH - 1, 26, 5, plat.x * 0.01);
      drawVineWithLeaves(plat.x + plat.w * 0.68, sideY + sideH - 1, 32, -5, plat.x * 0.012);
    }
  }

  function drawPlatform(plat) {
    if (isBoundaryCollider(plat)) {
      return;
    }
    if (isGroundPlatform(plat)) {
      drawGroundPlatform(plat);
      return;
    }
    drawFloatingPlatform(plat);
  }

  function drawPortal() {
    const p = world.portal;
    const centerX = p.x + p.w * 0.5;
    const centerY = p.y + p.h * 0.5;
    const now = performance.now() * 0.001;
    const pulse = 1 + Math.sin(now * 3.2) * 0.035;

    ctx.save();
    ctx.shadowColor = "#b7e8ff";
    ctx.shadowBlur = 30;
    const glow = ctx.createRadialGradient(centerX, centerY, 16, centerX, centerY, 104 * pulse);
    glow.addColorStop(0, "#d7f2ffda");
    glow.addColorStop(0.45, "#77c8ffd1");
    glow.addColorStop(1, "#2f63c100");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, 74 * pulse, 102 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const bodyGrad = ctx.createLinearGradient(centerX, p.y + 18, centerX, p.y + p.h - 14);
    bodyGrad.addColorStop(0, "#9b59b6");
    bodyGrad.addColorStop(0.54, "#5f7fe7");
    bodyGrad.addColorStop(1, "#3498db");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, 44 * pulse, 76 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#f6e8ff88";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i += 1) {
      const ry = 66 - i * 16;
      ctx.beginPath();
      ctx.ellipse(centerX + Math.sin(now * 1.4 + i) * 4, centerY + i * 2 - 6, 28 - i * 3, ry, 0, Math.PI * 0.25, Math.PI * 0.75);
      ctx.stroke();
    }

    ctx.strokeStyle = "#dff8ff";
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, 49 * pulse, 82 * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < 15; i += 1) {
      const t = (now * 0.52 + i * 0.11) % 1;
      const alpha = Math.sin(Math.PI * t) * 0.85;
      const px = centerX + Math.sin(now * 2.1 + i * 1.34) * (18 + (1 - t) * 8);
      const py = p.y + p.h - 8 - t * 132;
      const radius = 1.8 + (i % 3) * 0.8;

      ctx.fillStyle = `rgba(223, 248, 255, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = "15px Pretendard, Noto Sans KR, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("DUNGEON", centerX, p.y - 14);
  }

  function drawFarForestLayer() {
    const baseY = canvas.height - 78;
    ctx.save();
    ctx.globalAlpha = 0.56;
    ctx.fillStyle = "#1a4a1a";
    decorations.farTrees.forEach((tree, idx) => {
      const x = tree.x - camera.x * 0.18;
      const trunkW = tree.trunkW;
      ctx.fillRect(x - trunkW * 0.5, -40, trunkW, canvas.height + 120);

      const leafY = baseY - 320 - idx * 26;
      ctx.beginPath();
      ctx.arc(x - trunkW * 0.3, leafY + 8, tree.leafR * 0.65, 0, Math.PI * 2);
      ctx.arc(x + trunkW * 0.18, leafY - 24, tree.leafR * 0.78, 0, Math.PI * 2);
      ctx.arc(x + trunkW * 0.64, leafY + 6, tree.leafR * 0.58, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#79bd7a22";
      ctx.beginPath();
      ctx.arc(x + trunkW * 0.05, leafY - 16, tree.leafR * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a4a1a";
    });
    ctx.restore();
  }

  function drawVineWithLeaves(startX, startY, length, sway, phase) {
    const cp1x = startX + sway;
    const cp1y = startY + length * 0.26;
    const cp2x = startX - sway * 0.9;
    const cp2y = startY + length * 0.74;
    const endX = startX + Math.sin(phase) * 5;
    const endY = startY + length;

    ctx.strokeStyle = "#215f21";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
    ctx.stroke();

    ctx.fillStyle = "#2d7a2d";
    for (let i = 1; i <= 4; i += 1) {
      const t = i / 5;
      const lx = startX * (1 - t) * (1 - t) * (1 - t)
        + 3 * cp1x * t * (1 - t) * (1 - t)
        + 3 * cp2x * t * t * (1 - t)
        + endX * t * t * t;
      const ly = startY * (1 - t) * (1 - t) * (1 - t)
        + 3 * cp1y * t * (1 - t) * (1 - t)
        + 3 * cp2y * t * t * (1 - t)
        + endY * t * t * t;
      ctx.beginPath();
      ctx.ellipse(lx + (i % 2 ? 3 : -3), ly, 4, 2.6, i % 2 ? 0.4 : -0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMidForestLayer() {
    const baseY = canvas.height - 78;
    const now = performance.now() * 0.001;
    ctx.save();
    ctx.globalAlpha = 0.8;
    decorations.midTrees.forEach((tree, idx) => {
      const x = tree.x - camera.x * 0.34;
      const trunkTop = baseY - 370 + idx * 14;
      const trunkW = tree.trunkW;
      ctx.fillStyle = "#245e24";
      ctx.fillRect(x - trunkW * 0.5, trunkTop, trunkW, canvas.height);
      ctx.fillStyle = "#5ab5522c";
      ctx.fillRect(x - trunkW * 0.18, trunkTop + 12, trunkW * 0.24, canvas.height);

      ctx.fillStyle = "#2d7a2d";
      ctx.beginPath();
      ctx.arc(x - 18, trunkTop + 18, tree.canopyR * 0.58, 0, Math.PI * 2);
      ctx.arc(x + 48, trunkTop + 2, tree.canopyR * 0.5, 0, Math.PI * 2);
      ctx.arc(x + 4, trunkTop - 32, tree.canopyR * 0.65, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#235923";
      for (let b = 0; b < 3; b += 1) {
        const by = trunkTop + 78 + b * 52;
        const tilt = (b % 2 === 0 ? tree.branchTilt : -tree.branchTilt) * (52 - b * 8);
        ctx.save();
        ctx.translate(x, by);
        ctx.rotate((tilt > 0 ? 1 : -1) * 0.26);
        ctx.fillRect(0, -3, Math.abs(tilt), 6);
        ctx.restore();
        drawVineWithLeaves(x + tilt * 0.66, by + 2, 88 + b * 20, tilt * 0.2, idx * 0.7 + b * 1.2 + now);
      }
    });
    ctx.restore();
  }

  function drawHouseSilhouette() {
    const house = decorations.house;
    const x = house.x - camera.x * 0.22;
    const y = house.y;
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = "#1f4028";
    ctx.shadowColor = "#ffffff66";
    ctx.shadowBlur = 12;
    roundedRectPath(x, y, house.w, house.h, 12);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 12, y);
    ctx.arc(x + house.w * 0.5, y, house.w * 0.6, Math.PI, 0, false);
    ctx.lineTo(x + house.w + 12, y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#f9f7d233";
    roundedRectPath(x + house.w * 0.42, y + house.h * 0.38, 26, 36, 5);
    ctx.fill();
    ctx.restore();
  }

  function drawDecorations() {
    const floorY = world.height - 80;
    for (let i = 0; i < 28; i += 1) {
      const gx = 70 + i * 96 + (i % 3) * 8;
      drawGrassTuft(gx, floorY + 11, 0.78 + (i % 2) * 0.1);
      if (i % 5 === 0) {
        drawFlower(gx + 14, floorY + 10, "#ffe36f");
      }
      if (i % 9 === 0) {
        drawFlower(gx - 10, floorY + 12, "#fff2a8");
      }
    }
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

  function drawOverheadBar(x, y, width, ratio, fill) {
    ctx.fillStyle = "#00000088";
    ctx.fillRect(x - width * 0.5, y, width, 8);
    ctx.fillStyle = fill;
    ctx.fillRect(x - width * 0.5 + 1, y + 1, (width - 2) * clamp(ratio, 0, 1), 6);
  }

  function getCharacterPose(entity, now) {
    const velocityX = Number(entity.vx || 0);
    const velocityY = Number(entity.vy || 0);
    const onGround = entity === player ? player.onGround : true;
    const runBlend = clamp(Math.abs(velocityX) / MAX_RUN_SPEED, 0, 1);
    const stride = Math.sin(now * 0.018 + (entity.id === myId ? 0 : 0.8)) * runBlend;
    const pose = {
      bob: onGround ? Math.abs(Math.sin(now * 0.02)) * 2.8 * runBlend : 0,
      bodyLean: clamp(velocityX / MAX_RUN_SPEED, -0.14, 0.14),
      armFront: stride * 0.9,
      armBack: -stride * 0.9,
      legFront: -stride * 1.15,
      legBack: stride * 1.15,
    };

    if (!onGround) {
      pose.bodyLean = velocityY < 0 ? -0.08 : 0.08;
      pose.armFront = 0.4;
      pose.armBack = -0.35;
      pose.legFront = -0.55;
      pose.legBack = 0.7;
    }

    return pose;
  }

  function drawPlayer(entity, isMine = false) {
    const now = performance.now();
    const pose = getCharacterPose(entity, now);
    const direction = entity.direction < 0 ? -1 : 1;
    const bodyColor = isMine ? "#2a75d5" : "#d26161";
    const accentColor = isMine ? "#5aa0ff" : "#f29a9a";

    ctx.save();
    ctx.translate(entity.x, entity.y + pose.bob);
    ctx.scale(direction, 1);

    ctx.fillStyle = "#0000001d";
    ctx.beginPath();
    ctx.ellipse(0, 18, 22, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(pose.bodyLean);

    ctx.strokeStyle = "#21365c";
    ctx.lineCap = "round";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-8, 10);
    ctx.lineTo(-12 + pose.legBack * 12, 34);
    ctx.moveTo(8, 10);
    ctx.lineTo(12 + pose.legFront * 12, 34);
    ctx.stroke();

    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.roundRect(-16, -18, 32, 36, 10);
    ctx.fill();

    ctx.lineWidth = 7;
    ctx.strokeStyle = accentColor;
    ctx.beginPath();
    ctx.moveTo(-14, -8);
    ctx.lineTo(-28, -2 + pose.armBack * 10);
    ctx.moveTo(14, -8);
    ctx.lineTo(28, -2 + pose.armFront * 12);
    ctx.stroke();

    ctx.fillStyle = "#f7ddbc";
    ctx.beginPath();
    ctx.arc(0, -34, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#0d1824";
    ctx.beginPath();
    ctx.arc(6, -34, 2.3, 0, Math.PI * 2);
    ctx.arc(-5, -34, 2.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#11315a";
    ctx.beginPath();
    ctx.arc(0, -48, 18, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = isMine ? "#dce7f7" : "#ffe5d8";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(28, -4 + pose.armFront * 12);
    ctx.lineTo(56, -22);
    ctx.stroke();

    ctx.strokeStyle = isMine ? "#f4be53" : "#f7d27c";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(26, 1 + pose.armFront * 12);
    ctx.lineTo(36, -3);
    ctx.stroke();

    ctx.restore();

    const hpRatio = Number.isFinite(entity.hp)
      ? entity.hp / Math.max(1, Number(entity.maxHp || 100))
      : 1;
    drawOverheadBar(entity.x, entity.y - 96, 72, hpRatio, isMine ? "#ff6961" : "#8edc94");

    ctx.fillStyle = "#111";
    ctx.font = "14px Pretendard, Noto Sans KR, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(entity.nickname, entity.x, entity.y - 106);

    if (entity.bubble && entity.bubbleUntil > performance.now() / 1000) {
      drawSpeechBubble(entity.bubble, entity.x, entity.y - 48);
    }
  }

  function drawWorld() {
    drawBackground();

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    drawDecorations();
    platforms.forEach((plat) => drawPlatform(plat));
    drawPortal();
    remotePlayers.forEach((p) => drawPlayer(p, false));
    drawPlayer(player, true);

    if (inPortalRange) {
      const p = world.portal;
      ctx.fillStyle = "#151b2ccf";
      ctx.fillRect(p.x - 34, p.y - 66, p.w + 68, 36);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.font = "15px Pretendard, Noto Sans KR, sans-serif";
      ctx.fillText("Press Up to enter the dungeon", p.x + p.w * 0.5, p.y - 42);
    }

    ctx.restore();

    ctx.fillStyle = "#00000082";
    ctx.fillRect(12, 12, 432, 98);
    ctx.fillStyle = "#fff";
    ctx.font = "15px Pretendard, Noto Sans KR, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Players ${remotePlayers.size + 1}`, 24, 38);
    ctx.fillText(`Position: (${Math.round(player.x)}, ${Math.round(player.y)})`, 24, 60);
    ctx.fillText(`HP ${Math.round(player.hp)} / ${player.maxHp}  |  Regen in lobby`, 24, 82);
    ctx.fillText("Move: Left / Right  Jump: Space  Chat: Enter  Portal: Up", 24, 102);
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
          hp: 100,
          maxHp: 100,
        };

        existing.nickname = entry.nickname;
        existing.x = entry.x;
        existing.y = entry.y;
        existing.vx = entry.vx;
        existing.vy = entry.vy;
        existing.direction = entry.direction || 1;
        existing.hp = Number.isFinite(entry.hp) ? entry.hp : existing.hp;
        existing.maxHp = Number.isFinite(entry.max_hp) ? entry.max_hp : existing.maxHp;
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
      if (localDist > 165) {
        continue;
      }

      const clickDist = Math.hypot(remote.x - worldPos.x, remote.y - worldPos.y);
      if (clickDist > 98) {
        continue;
      }

      if (clickDist < best) {
        best = clickDist;
        candidate = remote;
      }
    }
    return candidate;
  }

  function isTypingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  }

  function isImeComposingEnter(event, composingFlag) {
    if (event.key !== "Enter") {
      return false;
    }
    return Boolean(event.isComposing || composingFlag || event.keyCode === 229);
  }

  function stepLobbyRecovery(dt) {
    if (!joined || player.hp >= player.maxHp) {
      return;
    }

    const previousRoundedHp = Math.round(player.hp);
    player.hp = Math.min(player.maxHp, player.hp + LOBBY_REGEN_PER_SECOND * dt);
    if (Math.round(player.hp) !== previousRoundedHp) {
      syncPlayerStatsUi();
      savePlayerProfile();
    }
  }

  function step(dt) {
    stepMovement(dt);
    stepLobbyRecovery(dt);
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
    requestJoinLobby(nickname);
  });

  socket.on("joined", ({ id, world: serverWorld, snapshot, profile }) => {
    myId = id;
    joined = true;
    joinRequested = false;

    player.id = id;
    player.nickname = profile?.nickname || nicknameInput.value.trim().slice(0, 16) || "Guest";
    player.maxHp = Math.max(100, Number(profile?.max_hp || player.maxHp));
    myNameEl.textContent = player.nickname;

    if (serverWorld) {
      world = serverWorld;
      platforms = buildPlatforms(world);
      decorations = buildDecorations(world);
      player.x = world.spawn.x;
      player.y = world.spawn.y;
      player.vx = 0;
      player.vy = 0;
    }

    parseProfileForStorage(profile);

    if (snapshot) {
      updateFromSnapshot(snapshot);
    }

    startScreen.classList.remove("show");
    addFeedLine("Lobby ready. Press Enter to chat and Up at the portal to enter the dungeon.", "system");
  });

  socket.on("disconnect", () => {
    joined = false;
    joinRequested = false;
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
    addFeedLine(`${friend_nickname} is now on your friend list.`, "system");
    if (!privateThreads.has(friend_id)) {
      privateThreads.set(friend_id, { nickname: friend_nickname, messages: [] });
    }
  });

  socket.on("private_message", (msg) => {
    const partnerId = msg.from_id === myId ? msg.target_id : msg.from_id;
    const partnerName = msg.from_id === myId ? msg.target_nickname : msg.from_nickname;
    const author = msg.from_id === myId ? "Me" : msg.from_nickname;

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

  socket.on("minigame_invited", ({ from_id, from_nickname }) => {
    showInviteModal(from_id, from_nickname);
  });

  socket.on("minigame_invite_declined", ({ nickname }) => {
    addFeedLine(`${nickname} declined the minigame invite.`, "system");
  });

  socket.on("minigame_start", (payload) => {
    const sessionId = payload?.session_id || "";
    const explicitPath = payload?.game_path || "";
    sessionStorage.setItem("active_minigame_session", JSON.stringify(payload || {}));
    savePlayerProfile();
    const targetUrl = explicitPath || (sessionId ? `/game/volley?session=${encodeURIComponent(sessionId)}` : "/game/volley");
    window.location.assign(targetUrl);
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
      addFeedLine("Right-click a nearby player to open the interaction menu.", "system");
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

  minigameBtn.addEventListener("click", () => {
    if (contextTargetId) {
      socket.emit("minigame_invite", { target_id: contextTargetId });
    }
    hideContextMenu();
  });

  inviteAcceptBtn.addEventListener("click", () => {
    if (!pendingInvite.fromId) {
      return;
    }
    socket.emit("minigame_invite_response", {
      from_id: pendingInvite.fromId,
      accepted: true,
    });
    hideInviteModal();
  });

  inviteDeclineBtn.addEventListener("click", () => {
    if (!pendingInvite.fromId) {
      return;
    }
    socket.emit("minigame_invite_response", {
      from_id: pendingInvite.fromId,
      accepted: false,
    });
    hideInviteModal();
  });

  pmSendBtn.addEventListener("click", sendPrivateChat);
  pmInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    if (isImeComposingEnter(event, pmComposing)) {
      return;
    }
    event.preventDefault();
    window.setTimeout(sendPrivateChat, 0);
  });
  pmInput.addEventListener("compositionstart", () => {
    pmComposing = true;
  });
  pmInput.addEventListener("compositionend", () => {
    pmComposing = false;
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#context-menu")) {
      hideContextMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    const activeTarget = document.activeElement;
    const typing = isTypingTarget(activeTarget);
    const isSpace = event.key === " " || event.code === "Space";
    const isArrow =
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown";

    if (!typing && (isSpace || isArrow)) {
      event.preventDefault();
    }

    if (event.repeat) {
      return;
    }

    if (!typing) {
      if (event.key === "ArrowLeft") {
        keys.left = true;
      } else if (event.key === "ArrowRight") {
        keys.right = true;
      } else if (event.key === "ArrowUp") {
        keys.up = true;
        interactQueued = true;
      } else if (isSpace) {
        keys.jumpHeld = true;
        jumpQueued = true;
      }
    }

    if (!joined) {
      return;
    }

    if (event.key === "Escape") {
      chatInputWrap.classList.add("hidden");
      hideContextMenu();
      hideInviteModal();
      canvas.focus();
      return;
    }

    if (event.key === "Enter") {
      if (isImeComposingEnter(event, chatComposing || pmComposing)) {
        return;
      }
      if (activeTarget === pmInput || activeTarget === chatInput) {
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
      if (typing) {
        return;
      }
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
    } else if (event.key === "ArrowUp") {
      keys.up = false;
    } else if (event.key === " " || event.code === "Space") {
      keys.jumpHeld = false;
      if (player.vy < -80) {
        jumpCutQueued = true;
      }
    }
  });

  chatInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    if (isImeComposingEnter(event, chatComposing)) {
      return;
    }
    event.preventDefault();
    window.setTimeout(sendPublicChat, 0);
  });
  chatInput.addEventListener("compositionstart", () => {
    chatComposing = true;
  });
  chatInput.addEventListener("compositionend", () => {
    chatComposing = false;
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
        profile_id: player.profileId,
        nickname: player.nickname,
        hp: player.hp,
        coin: player.coin,
        x: Math.round(player.x),
        y: Math.round(player.y),
        vx: Math.round(player.vx),
        vy: Math.round(player.vy),
        on_ground: player.onGround,
      },
      portal: {
        in_range: inPortalRange,
        x: world.portal.x,
        y: world.portal.y,
      },
      nearby_players: nearby,
      ui: {
        public_chat_open: !chatInputWrap.classList.contains("hidden"),
        private_target: activePrivateTargetId,
        invite_modal_open: !inviteModal.classList.contains("hidden"),
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

  syncPlayerStatsUi();

  const storedNickname = getStoredNickname();
  if (storedNickname) {
    nicknameInput.value = storedNickname;
    startScreen.classList.remove("show");
    addFeedLine("Auto-joining the lobby with your saved nickname.", "system");
    requestJoinLobby(storedNickname);
  }

  requestAnimationFrame(gameLoop);
})();
