(() => {
  const canvas = document.getElementById("dungeon-canvas");
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const nameEl = document.getElementById("dungeon-name");
  const hpEl = document.getElementById("dungeon-hp");
  const coinEl = document.getElementById("dungeon-coin");
  const feedEl = document.getElementById("dungeon-feed");
  const statusEl = document.getElementById("dungeon-status");
  const monsterListEl = document.getElementById("dungeon-monster-list");
  const hudHpFill = document.getElementById("hud-hp-fill");
  const hudHpText = document.getElementById("hud-hp-text");
  const hudActionFill = document.getElementById("hud-action-fill");
  const hudActionText = document.getElementById("hud-action-text");
  const hudCoinCount = document.getElementById("hud-coin-count");
  const portalPrompt = document.getElementById("portal-prompt");
  const pickupPrompt = document.getElementById("pickup-prompt");
  const attackZBtn = document.getElementById("attack-z-btn");
  const attackXBtn = document.getElementById("attack-x-btn");
  const attackCBtn = document.getElementById("attack-c-btn");
  const pickupBtn = document.getElementById("pickup-btn");

  const socket = typeof window.io === "function" ? window.io() : null;
  const params = new URLSearchParams(window.location.search);
  const dungeonId = (params.get("dungeon") || "default_dungeon").trim().toLowerCase() || "default_dungeon";

  let storedProfile = { _id: "guest", nickname: "Guest", hp: 100, coin: 0 };
  try {
    const profileRaw = sessionStorage.getItem("player_profile");
    if (profileRaw) {
      storedProfile = { ...storedProfile, ...JSON.parse(profileRaw) };
    }
  } catch (error) {
    console.warn("Failed to load player profile.", error);
  }

  const profile = {
    _id: String(storedProfile._id || "guest"),
    nickname: String(storedProfile.nickname || "Guest"),
    hp: Number(storedProfile.hp || 100),
    coin: Number(storedProfile.coin || 0),
  };

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
  const PICKUP_RADIUS = 96;
  const PLAYER_RESPAWN_TIME = 2.2;

  const ATTACKS = {
    KeyZ: { label: "Slash", type: "melee", damage: 18, cooldown: 0.34, duration: 0.24, hitStart: 0.05, hitEnd: 0.15, range: 92, height: 74, color: "#ffd66e" },
    KeyX: { label: "Burst", type: "projectile", damage: 14, cooldown: 0.5, duration: 0.32, hitStart: 0.08, hitEnd: 0.08, projectileSpeed: 760, projectileLife: 0.9, color: "#7fe7ff" },
    KeyC: { label: "Drive", type: "dash", damage: 28, cooldown: 0.82, duration: 0.34, hitStart: 0.03, hitEnd: 0.18, range: 112, height: 84, dashSpeed: 610, color: "#ff9d8f" },
  };

  const FALLBACK_MONSTERS = [
    { monster_id: "mint-slime-001", template_id: "mint_slime", name: "Mint Slime", sprite_hint: "slime", x: 560, y: 1320, spawn_x: 560, spawn_y: 1320, hp: 36, max_hp: 36, level: 1, theme: "cute_forest", move_range: 88, respawn_delay: 8 },
    { monster_id: "pom-mushroom-001", template_id: "pom_mushroom", name: "Pom Mushroom", sprite_hint: "mushroom", x: 1010, y: 1320, spawn_x: 1010, spawn_y: 1320, hp: 45, max_hp: 45, level: 2, theme: "cute_forest", move_range: 74, respawn_delay: 8 },
    { monster_id: "cloud-pupu-001", template_id: "cloud_pupu", name: "Cloud Pupu", sprite_hint: "puff", x: 1500, y: 940, spawn_x: 1500, spawn_y: 940, hp: 52, max_hp: 52, level: 3, theme: "dreamy_cloud", move_range: 110, respawn_delay: 8 },
    { monster_id: "honey-sprout-001", template_id: "honey_sprout", name: "Honey Sprout", sprite_hint: "sprout", x: 1880, y: 1320, spawn_x: 1880, spawn_y: 1320, hp: 58, max_hp: 58, level: 3, theme: "flower_garden", move_range: 96, respawn_delay: 8 },
    { monster_id: "acorn-bat-001", template_id: "acorn_bat", name: "Acorn Bat", sprite_hint: "bat", x: 2320, y: 900, spawn_x: 2320, spawn_y: 900, hp: 72, max_hp: 72, level: 4, theme: "twilight_cute", move_range: 132, respawn_delay: 8 },
  ];

  const MONSTER_NAMES = {
    mint_slime: "Mint Slime",
    pom_mushroom: "Pom Mushroom",
    cloud_pupu: "Cloud Pupu",
    honey_sprout: "Honey Sprout",
    acorn_bat: "Acorn Bat",
  };

  const world = {
    width: 2800,
    height: 1400,
    spawn: { x: 420, y: 520 },
    returnPortal: { x: 180, y: 1172, w: 120, h: 148, target: "/" },
    id: dungeonId,
  };

  let platforms = [];

  function rebuildPlatforms() {
    platforms = [
      { x: 0, y: world.height - 80, w: world.width, h: 80 },
      { x: -84, y: 0, w: 84, h: world.height },
      { x: world.width, y: 0, w: 84, h: world.height },
      { x: 200, y: world.height - 280, w: 300, h: 24 },
      { x: 620, y: world.height - 390, w: 260, h: 22 },
      { x: 980, y: world.height - 320, w: 260, h: 24 },
      { x: 1340, y: world.height - 460, w: 280, h: 22 },
      { x: 1760, y: world.height - 360, w: 260, h: 22 },
      { x: 2140, y: world.height - 460, w: 280, h: 22 },
      { x: 980, y: world.height - 640, w: 560, h: 20 },
    ];
  }

  rebuildPlatforms();

  const player = {
    x: world.spawn.x,
    y: world.spawn.y,
    vx: 0,
    vy: 0,
    width: 56,
    height: 74,
    onGround: false,
    direction: 1,
    hp: Math.max(1, profile.hp),
    maxHp: Math.max(100, profile.hp),
    coin: Math.max(0, profile.coin),
    invulnTimer: 0,
    hitFlash: 0,
    deadTimer: 0,
    attack: null,
    attackCooldownTimer: 0,
    attackCooldownMax: 0.001,
  };

  const camera = { x: 0, y: 0 };
  const keys = { left: false, right: false, jumpHeld: false, up: false };
  const monsters = [];
  const projectiles = [];
  const attackEffects = [];
  const floatingTexts = [];
  const coinDrops = [];
  const actionLog = [];

  let dungeonKeywords = null;
  let connectionState = socket ? "connecting" : "offline";
  let jumpQueued = false;
  let jumpHolding = false;
  let jumpHoldTimer = 0;
  let jumpCutQueued = false;
  let accum = 0;
  let prevTs = performance.now();
  let fallbackTimer = null;
  let controlHintCooldown = 0;
  let inReturnPortalRange = false;
  let interactQueued = false;

  function addFeed(text, kind = "system") {
    if (!feedEl) {
      return;
    }

    const line = document.createElement("div");
    line.className = `feed-line ${kind}`;
    line.textContent = text;
    feedEl.appendChild(line);

    while (feedEl.children.length > 70) {
      feedEl.removeChild(feedEl.firstChild);
    }
    feedEl.scrollTop = feedEl.scrollHeight;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function saveProfile() {
    profile.hp = Math.round(player.hp);
    profile.coin = player.coin;
    sessionStorage.setItem("player_profile", JSON.stringify({ _id: profile._id, nickname: profile.nickname, hp: Math.round(player.hp), coin: player.coin }));
  }

  function updateHud() {
    const hpRatio = clamp(player.hp / Math.max(1, player.maxHp), 0, 1);
    const actionRatio = player.attackCooldownTimer > 0 ? 1 - player.attackCooldownTimer / Math.max(0.001, player.attackCooldownMax) : 1;
    nameEl.textContent = profile.nickname;
    hpEl.textContent = String(Math.round(player.hp));
    coinEl.textContent = String(player.coin);
    hudHpText.textContent = `${Math.round(player.hp)} / ${player.maxHp}`;
    hudHpFill.style.width = `${hpRatio * 100}%`;
    hudActionFill.style.width = `${clamp(actionRatio, 0, 1) * 100}%`;
    hudActionText.textContent = player.attack ? ATTACKS[player.attack.key].label : actionRatio >= 0.999 ? "Ready" : "Charging";
    hudCoinCount.textContent = `x ${player.coin}`;
  }

  function getNearbyCoins() {
    return coinDrops.filter((coin) => coin.pickDelay <= 0 && Math.hypot(coin.x - player.x, coin.y - player.y) <= PICKUP_RADIUS);
  }

  function updatePickupPrompt() {
    if (!pickupPrompt) {
      return;
    }
    const nearby = getNearbyCoins();
    if (!nearby.length || player.deadTimer > 0) {
      pickupPrompt.classList.add("hidden");
      return;
    }
    pickupPrompt.textContent = `Press E to pick up coins (${nearby.length})`;
    pickupPrompt.classList.remove("hidden");
  }

  function updatePortalPrompt() {
    if (!portalPrompt) {
      return;
    }

    if (!inReturnPortalRange || player.deadTimer > 0) {
      portalPrompt.classList.add("hidden");
      return;
    }

    portalPrompt.textContent = "Press Up to return to lobby";
    portalPrompt.classList.remove("hidden");
  }

  function returnPortalRect() {
    return {
      left: world.returnPortal.x,
      right: world.returnPortal.x + world.returnPortal.w,
      top: world.returnPortal.y,
      bottom: world.returnPortal.y + world.returnPortal.h,
    };
  }

  function enterLobbyFromPortal() {
    saveProfile();
    window.location.assign(world.returnPortal.target || "/");
  }
  function makeCard(title, lines, className) {
    const card = document.createElement("div");
    card.className = className;
    const heading = document.createElement("strong");
    heading.textContent = title;
    card.appendChild(heading);
    lines.forEach((text) => {
      const line = document.createElement("span");
      line.textContent = text;
      card.appendChild(line);
    });
    return card;
  }

  function renderStatus() {
    if (!statusEl) {
      return;
    }
    statusEl.innerHTML = "";
    const aliveCount = monsters.filter((monster) => !monster.dead).length;
    [
      makeCard("Dungeon", [world.id, `Connection: ${connectionState}`], "status-pill"),
      makeCard("Player", [`HP ${Math.round(player.hp)} / ${player.maxHp}`, `Coins ${player.coin}`], "status-pill"),
      makeCard("Combat", [`Alive monsters ${aliveCount}`, `Ground coins ${coinDrops.length}`], "status-pill"),
      makeCard("Controls", ["Move: Left / Right", "Jump: Space", "Attack: Z / X / C", "Pick up: E", "Return portal: Up"], "status-pill"),
    ].forEach((card) => statusEl.appendChild(card));
  }

  function getNearestMonster() {
    let candidate = null;
    let best = Number.POSITIVE_INFINITY;
    monsters.forEach((monster) => {
      if (monster.dead) {
        return;
      }
      const distance = Math.hypot(monster.x - player.x, monster.y - player.y);
      if (distance < best) {
        best = distance;
        candidate = monster;
      }
    });
    return candidate;
  }

  function renderMonsterList() {
    if (!monsterListEl) {
      return;
    }
    monsterListEl.innerHTML = "";
    const targetId = getNearestMonster()?.monster_id || null;
    monsters.forEach((monster) => {
      const palette = monsterPalette(monster.template_id);
      const card = document.createElement("div");
      const cardClasses = ["monster-card"];
      if (monster.dead) {
        cardClasses.push("is-dead");
      }
      if (monster.monster_id === targetId) {
        cardClasses.push("is-target");
      }
      card.className = cardClasses.join(" ");
      const swatch = document.createElement("div");
      swatch.className = "monster-swatch";
      swatch.style.background = palette.primary;
      const body = makeCard(monster.name, [`Lv.${monster.level}  HP ${Math.max(0, Math.round(monster.hp))}/${monster.maxHp}`, monster.dead ? `Respawn ${monster.respawnTimer.toFixed(1)}s` : `Range ${Math.round(monster.move_range)}`, monster.dead ? "Status: Down" : monster.state === "chase" ? "Status: Aggro" : "Status: Patrol"], "");
      card.appendChild(swatch);
      card.appendChild(body);
      monsterListEl.appendChild(card);
    });
  }

  function playerRect(px = player.x, py = player.y) {
    const hw = player.width * 0.5;
    const hh = player.height * 0.5;
    return { left: px - hw, right: px + hw, top: py - hh, bottom: py + hh, hw, hh };
  }

  function intersects(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function syncWorld(nextWorld) {
    if (!nextWorld) {
      return;
    }
    world.width = Number(nextWorld.width || world.width);
    world.height = Number(nextWorld.height || world.height);
    world.spawn = { x: Number((nextWorld.spawn || {}).x || world.spawn.x), y: Number((nextWorld.spawn || {}).y || world.spawn.y) };
    world.returnPortal = {
      x: Number((nextWorld.returnPortal || {}).x || world.returnPortal.x),
      y: Number((nextWorld.returnPortal || {}).y || world.returnPortal.y),
      w: Number((nextWorld.returnPortal || {}).w || world.returnPortal.w),
      h: Number((nextWorld.returnPortal || {}).h || world.returnPortal.h),
      target: String((nextWorld.returnPortal || {}).target || world.returnPortal.target),
    };
    world.id = String(nextWorld.id || world.id || dungeonId);
    rebuildPlatforms();
  }

  function monsterPalette(templateId) {
    switch (templateId) {
      case "mint_slime": return { primary: "#79e2b3", secondary: "#c8ffe5", accent: "#2c8a67" };
      case "pom_mushroom": return { primary: "#f48ca9", secondary: "#ffe5ee", accent: "#9a3d58" };
      case "cloud_pupu": return { primary: "#c8d8ff", secondary: "#ffffff", accent: "#6d81c8" };
      case "honey_sprout": return { primary: "#ffd764", secondary: "#fff0b9", accent: "#a67d17" };
      case "acorn_bat": return { primary: "#9f88d8", secondary: "#e5dcff", accent: "#564182" };
      default: return { primary: "#b9d0ea", secondary: "#f4f8ff", accent: "#5d738d" };
    }
  }

  function normalizeMonsterName(monster) {
    const raw = String(monster.name || "").trim();
    return !raw || raw.includes("?") ? MONSTER_NAMES[monster.template_id] || "Dungeon Monster" : raw;
  }

  function makeMonster(monster) {
    return {
      monster_id: String(monster.monster_id || `monster-${Date.now()}-${Math.random()}`),
      template_id: String(monster.template_id || "unknown"),
      name: normalizeMonsterName(monster),
      theme: String(monster.theme || "cute_side_scroll"),
      sprite_hint: String(monster.sprite_hint || "round"),
      x: Number(monster.x || 0),
      y: Number(monster.y || 0),
      spawn_x: Number(monster.spawn_x || monster.x || 0),
      spawn_y: Number(monster.spawn_y || monster.y || 0),
      hp: Number(monster.hp || 1),
      maxHp: Number(monster.max_hp || monster.hp || 1),
      level: Number(monster.level || 1),
      state: "idle",
      move_range: Number(monster.move_range || 90),
      respawn_delay: Number(monster.respawn_delay || 8),
      width: 58,
      height: 44,
      hurtTimer: 0,
      dead: false,
      respawnTimer: 0,
      contactCooldown: 0,
      velocityX: 0,
      patrolDir: Math.random() < 0.5 ? -1 : 1,
      bobSeed: Math.random() * Math.PI * 2,
      attackPower: 9 + Number(monster.level || 1) * 2,
      moveSpeed: 56 + Number(monster.level || 1) * 8,
    };
  }

  function bootstrapFallbackMonsters() {
    if (monsters.length) {
      return;
    }
    applyMonsterSnapshot({ monsters: FALLBACK_MONSTERS }, true);
    addFeed("Local monster set loaded.");
  }

  function applyMonsterSnapshot(snapshot, reset = false) {
    const incoming = Array.isArray((snapshot || {}).monsters) ? snapshot.monsters : [];
    if (reset) {
      monsters.length = 0;
    }
    incoming.forEach((monsterData) => {
      let monster = monsters.find((entry) => entry.monster_id === String(monsterData.monster_id || ""));
      if (!monster) {
        monsters.push(makeMonster(monsterData));
        return;
      }
      monster.template_id = String(monsterData.template_id || monster.template_id);
      monster.name = normalizeMonsterName(monsterData);
      monster.theme = String(monsterData.theme || monster.theme);
      monster.sprite_hint = String(monsterData.sprite_hint || monster.sprite_hint);
      monster.spawn_x = Number(monsterData.spawn_x || monster.spawn_x);
      monster.spawn_y = Number(monsterData.spawn_y || monster.spawn_y);
      monster.move_range = Number(monsterData.move_range || monster.move_range);
      monster.respawn_delay = Number(monsterData.respawn_delay || monster.respawn_delay);
      monster.level = Number(monsterData.level || monster.level);
      monster.maxHp = Number(monsterData.max_hp || monster.maxHp);
      if (reset) {
        monster.x = Number(monsterData.x || monster.x);
        monster.y = Number(monsterData.y || monster.y);
        monster.hp = Number(monsterData.hp || monster.maxHp);
        monster.dead = false;
        monster.respawnTimer = 0;
        monster.state = "idle";
      }
    });
    renderStatus();
    renderMonsterList();
  }

  function spawnFloatingText(text, x, y, color) {
    floatingTexts.push({ text, x, y, color, life: 0.9, maxLife: 0.9, velocityY: -48 });
  }

  function spawnAttackEffect(type, x, y, direction, color, size = 72) {
    attackEffects.push({ type, x, y, direction, color, size, life: 0.22, maxLife: 0.22 });
  }

  function spawnProjectile(attack) {
    projectiles.push({ x: player.x + attack.direction * 32, y: player.y - 8, vx: attack.direction * attack.projectileSpeed, radius: 12, damage: attack.damage, life: attack.projectileLife, maxLife: attack.projectileLife, color: attack.color });
    spawnAttackEffect("burst", player.x + attack.direction * 18, player.y - 10, attack.direction, attack.color, 44);
  }

  function nearestPlatformY(x, currentY, nextY, radius) {
    let landingY = null;
    for (const plat of platforms) {
      if (x + radius < plat.x || x - radius > plat.x + plat.w) {
        continue;
      }
      if (currentY + radius <= plat.y + 1 && nextY + radius >= plat.y && (landingY === null || plat.y < landingY)) {
        landingY = plat.y;
      }
    }
    return landingY;
  }

  function spawnCoins(monster) {
    const count = 3 + monster.level + Math.floor(Math.random() * 3);
    for (let index = 0; index < count; index += 1) {
      const spread = (index - (count - 1) * 0.5) * 26;
      coinDrops.push({ id: `${monster.monster_id}-${Date.now()}-${index}`, x: monster.x + spread * 0.25, y: monster.y - 14, vx: spread + (Math.random() - 0.5) * 90, vy: -260 - Math.random() * 180, radius: 12, rotation: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 11, grounded: false, pickDelay: 0.35, value: 1 });
    }
  }

  function killMonster(monster) {
    if (monster.dead) {
      return;
    }
    monster.dead = true;
    monster.state = "dead";
    monster.respawnTimer = monster.respawn_delay;
    monster.velocityX = 0;
    spawnAttackEffect("burst", monster.x, monster.y - 18, player.direction, "#ffe7a3", 88);
    spawnFloatingText("KO", monster.x, monster.y - 78, "#ffe89b");
    spawnCoins(monster);
    addFeed(`${monster.name} dropped coins.`);
    renderStatus();
    renderMonsterList();
  }

  function damageMonster(monster, damage, color) {
    if (monster.dead) {
      return;
    }
    monster.hp = Math.max(0, monster.hp - damage);
    monster.hurtTimer = 0.18;
    monster.velocityX += player.direction * 85;
    spawnFloatingText(`-${damage}`, monster.x, monster.y - 74, color || "#ffd0c8");
    if (monster.hp <= 0) {
      killMonster(monster);
    } else {
      renderMonsterList();
    }
  }

  function damagePlayer(amount, sourceName) {
    if (player.invulnTimer > 0 || player.deadTimer > 0) {
      return;
    }
    player.hp = Math.max(0, player.hp - amount);
    player.invulnTimer = 0.8;
    player.hitFlash = 0.16;
    spawnFloatingText(`-${amount}`, player.x, player.y - 96, "#ffb6aa");
    addFeed(`${sourceName} hit you for ${amount}.`);
    if (player.hp <= 0) {
      player.deadTimer = PLAYER_RESPAWN_TIME;
      player.attack = null;
      player.vx = 0;
      player.vy = 0;
      addFeed("You were knocked out. Respawning...");
    }
    updateHud();
    updatePortalPrompt();
    saveProfile();
    renderStatus();
  }

  function respawnPlayer() {
    player.x = world.spawn.x;
    player.y = world.spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.hp = player.maxHp;
    player.deadTimer = 0;
    player.invulnTimer = 1;
    player.attack = null;
    player.attackCooldownTimer = 0;
    addFeed("Respawn complete.");
    updateHud();
    saveProfile();
    renderStatus();
  }

  function collectCoins() {
    if (player.deadTimer > 0) {
      return;
    }
    const nearby = getNearbyCoins();
    if (!nearby.length) {
      if (controlHintCooldown <= 0) {
        addFeed("No coins nearby.");
        controlHintCooldown = 0.8;
      }
      return;
    }
    let gained = 0;
    nearby.forEach((coin) => {
      gained += coin.value;
      spawnFloatingText(`+${coin.value}`, coin.x, coin.y - 18, "#ffe07a");
      spawnAttackEffect("spark", coin.x, coin.y, 1, "#ffd54d", 28);
    });
    for (let index = coinDrops.length - 1; index >= 0; index -= 1) {
      if (nearby.includes(coinDrops[index])) {
        coinDrops.splice(index, 1);
      }
    }
    player.coin += gained;
    addFeed(`Picked up ${gained} coin${gained > 1 ? "s" : ""}.`);
    updateHud();
    updatePortalPrompt();
    updatePickupPrompt();
    saveProfile();
    renderStatus();
  }

  function tryAttack(actionKey) {
    const config = ATTACKS[actionKey];
    if (!config || player.deadTimer > 0 || player.attackCooldownTimer > 0.02) {
      return;
    }
    player.attack = { ...config, key: actionKey, elapsed: 0, direction: player.direction, hitIds: new Set(), projectileSpawned: false, effectSpawned: false };
    player.attackCooldownTimer = config.cooldown;
    player.attackCooldownMax = config.cooldown;
    actionLog.push({ key: actionKey, at: Date.now() });
    while (actionLog.length > 12) {
      actionLog.shift();
    }
    updateHud();
  }

  function stepMovement(dt) {
    const intent = player.deadTimer > 0 ? 0 : (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    player.vx += intent * MOVE_ACCEL * dt;
    if (!intent) {
      const friction = player.onGround ? GROUND_FRICTION : AIR_FRICTION;
      player.vx *= Math.max(0, 1 - friction * dt);
      if (Math.abs(player.vx) < 2.6) {
        player.vx = 0;
      }
    }
    if (player.attack && player.attack.type === "dash" && player.attack.elapsed < 0.18) {
      player.vx = player.attack.direction * player.attack.dashSpeed;
    }
    player.vx = clamp(player.vx, -MAX_RUN_SPEED, MAX_RUN_SPEED);
    if (Math.abs(player.vx) > 1) {
      player.direction = player.vx < 0 ? -1 : 1;
    }
    if (jumpQueued && player.onGround && player.deadTimer <= 0) {
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
      const platRect = { left: plat.x, right: plat.x + plat.w, top: plat.y, bottom: plat.y + plat.h };
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
      const platRect = { left: plat.x, right: plat.x + plat.w, top: plat.y, bottom: plat.y + plat.h };
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
    if (player.y > world.height + 220) {
      player.x = world.spawn.x;
      player.y = world.spawn.y;
      player.vx = 0;
      player.vy = 0;
      addFeed("Fell out of the map. Returned to spawn.");
    }

    const portal = returnPortalRect();
    const portalCenterX = (portal.left + portal.right) * 0.5;
    const portalCenterY = (portal.top + portal.bottom) * 0.5;
    inReturnPortalRange =
      intersects(playerRect(), portal) ||
      (Math.abs(player.x - portalCenterX) < 104 && Math.abs(player.y - portalCenterY) < 122);

    if (interactQueued) {
      interactQueued = false;
      if (inReturnPortalRange) {
        addFeed("Returning to lobby through the portal.");
        enterLobbyFromPortal();
        return;
      }
    }

    camera.x = clamp(player.x - canvas.width * 0.5, 0, Math.max(0, world.width - canvas.width));
    camera.y = clamp(player.y - canvas.height * 0.5, 0, Math.max(0, world.height - canvas.height));
  }

  function resolveMeleeAttack(attack) {
    monsters.forEach((monster) => {
      if (monster.dead || attack.hitIds.has(monster.monster_id)) {
        return;
      }
      const dx = monster.x - player.x;
      const dy = Math.abs((monster.y - 18) - (player.y - 12));
      if (attack.direction * dx <= -12 || Math.abs(dx) > attack.range || dy > attack.height) {
        return;
      }
      attack.hitIds.add(monster.monster_id);
      damageMonster(monster, attack.damage, attack.color);
    });
  }

  function updateAttack(dt) {
    if (player.attackCooldownTimer > 0) {
      player.attackCooldownTimer = Math.max(0, player.attackCooldownTimer - dt);
    }
    if (!player.attack) {
      return;
    }
    const attack = player.attack;
    attack.elapsed += dt;
    if (!attack.effectSpawned && attack.elapsed >= attack.hitStart) {
      attack.effectSpawned = true;
      spawnAttackEffect(attack.type === "projectile" ? "burst" : attack.type === "dash" ? "dash" : "slash", player.x + attack.direction * 54, player.y - 12, attack.direction, attack.color, attack.type === "dash" ? 108 : 84);
    }
    if (attack.type === "projectile" && !attack.projectileSpawned && attack.elapsed >= attack.hitStart) {
      attack.projectileSpawned = true;
      spawnProjectile(attack);
    }
    if (attack.type !== "projectile" && attack.elapsed >= attack.hitStart && attack.elapsed <= attack.hitEnd) {
      resolveMeleeAttack(attack);
    }
    if (attack.elapsed >= attack.duration) {
      player.attack = null;
    }
  }

  function updateProjectiles(dt) {
    for (let index = projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = projectiles[index];
      projectile.x += projectile.vx * dt;
      projectile.life -= dt;
      let hitMonster = null;
      monsters.forEach((monster) => {
        if (hitMonster || monster.dead) {
          return;
        }
        if (Math.hypot(projectile.x - monster.x, projectile.y - (monster.y - 18)) <= monster.width * 0.52) {
          hitMonster = monster;
        }
      });
      if (hitMonster) {
        damageMonster(hitMonster, projectile.damage, projectile.color);
        spawnAttackEffect("burst", projectile.x, projectile.y, Math.sign(projectile.vx) || 1, projectile.color, 54);
        projectiles.splice(index, 1);
        continue;
      }
      if (projectile.life <= 0 || projectile.x < -40 || projectile.x > world.width + 40) {
        projectiles.splice(index, 1);
      }
    }
  }

  function updateAttackEffects(dt) {
    for (let index = attackEffects.length - 1; index >= 0; index -= 1) {
      const effect = attackEffects[index];
      effect.life -= dt;
      if (effect.life <= 0) {
        attackEffects.splice(index, 1);
      }
    }
  }

  function updateFloatingTexts(dt) {
    for (let index = floatingTexts.length - 1; index >= 0; index -= 1) {
      const text = floatingTexts[index];
      text.life -= dt;
      text.y += text.velocityY * dt;
      if (text.life <= 0) {
        floatingTexts.splice(index, 1);
      }
    }
  }

  function updateCoins(dt) {
    for (let index = coinDrops.length - 1; index >= 0; index -= 1) {
      const coin = coinDrops[index];
      coin.pickDelay -= dt;
      coin.rotation += coin.spin * dt;
      if (!coin.grounded) {
        coin.vy += GRAVITY * 0.9 * dt;
        const nextX = coin.x + coin.vx * dt;
        const nextY = coin.y + coin.vy * dt;
        const landingY = nearestPlatformY(nextX, coin.y, nextY, coin.radius);
        coin.x = clamp(nextX, coin.radius, world.width - coin.radius);
        if (landingY !== null) {
          coin.y = landingY - coin.radius;
          coin.vy *= -0.28;
          coin.vx *= 0.72;
          if (Math.abs(coin.vy) < 40) {
            coin.vy = 0;
            coin.grounded = true;
          }
        } else {
          coin.y = nextY;
        }
        if (coin.y > world.height + 120) {
          coinDrops.splice(index, 1);
        }
      } else {
        coin.vx *= Math.max(0, 1 - dt * 7);
      }
    }
  }

  function updateMonsters(dt, now) {
    monsters.forEach((monster) => {
      if (monster.hurtTimer > 0) {
        monster.hurtTimer = Math.max(0, monster.hurtTimer - dt);
      }
      if (monster.contactCooldown > 0) {
        monster.contactCooldown = Math.max(0, monster.contactCooldown - dt);
      }
      if (monster.dead) {
        monster.respawnTimer -= dt;
        if (monster.respawnTimer <= 0) {
          monster.dead = false;
          monster.hp = monster.maxHp;
          monster.x = monster.spawn_x;
          monster.y = monster.spawn_y;
          monster.state = "idle";
          monster.velocityX = 0;
          addFeed(`${monster.name} respawned.`);
          renderMonsterList();
          renderStatus();
        }
        return;
      }
      const dx = player.x - monster.x;
      const dy = player.y - monster.y;
      const absDx = Math.abs(dx);
      const chaseRange = 180 + monster.level * 26;
      const leashLeft = monster.spawn_x - monster.move_range;
      const leashRight = monster.spawn_x + monster.move_range;
      if (absDx < chaseRange && Math.abs(dy) < 120 && player.deadTimer <= 0) {
        monster.state = "chase";
        monster.velocityX += Math.sign(dx || 1) * monster.moveSpeed * dt * 2.4;
      } else {
        monster.state = "idle";
        monster.velocityX += monster.patrolDir * monster.moveSpeed * dt * 0.8;
        if (monster.x <= leashLeft + 10) {
          monster.patrolDir = 1;
        } else if (monster.x >= leashRight - 10) {
          monster.patrolDir = -1;
        } else if (Math.sin(now * 0.0012 + monster.bobSeed) > 0.999) {
          monster.patrolDir *= -1;
        }
      }
      monster.velocityX *= Math.max(0, 1 - dt * 4.2);
      monster.velocityX = clamp(monster.velocityX, -monster.moveSpeed, monster.moveSpeed);
      monster.x = clamp(monster.x + monster.velocityX * dt, leashLeft, leashRight);
      if (Math.hypot(monster.x - player.x, monster.y - player.y) < 62 && monster.contactCooldown <= 0) {
        monster.contactCooldown = 1.1;
        damagePlayer(monster.attackPower, monster.name);
      }
    });
  }

  function updatePlayerState(dt) {
    if (player.invulnTimer > 0) {
      player.invulnTimer = Math.max(0, player.invulnTimer - dt);
    }
    if (player.hitFlash > 0) {
      player.hitFlash = Math.max(0, player.hitFlash - dt);
    }
    if (player.deadTimer > 0) {
      player.deadTimer = Math.max(0, player.deadTimer - dt);
      if (player.deadTimer <= 0) {
        respawnPlayer();
      }
    }
    if (controlHintCooldown > 0) {
      controlHintCooldown = Math.max(0, controlHintCooldown - dt);
    }
  }

  function seededNoise(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  function drawSmokeShape(x, y, sx, sy, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#0f2d3b";
    ctx.beginPath();
    ctx.ellipse(x, y, sx, sy, 0.1, 0, Math.PI * 2);
    ctx.ellipse(x - sx * 0.55, y + sy * 0.08, sx * 0.66, sy * 0.52, -0.18, 0, Math.PI * 2);
    ctx.ellipse(x + sx * 0.52, y - sy * 0.1, sx * 0.7, sy * 0.55, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBackgroundSmoke() {
    for (let i = 0; i < 14; i += 1) {
      const x = ((i * 210) - camera.x * 0.16) % (canvas.width + 400) - 200;
      const y = 70 + (i % 5) * 115 + (i % 2) * 18;
      drawSmokeShape(x, y, 96 + (i % 3) * 24, 34 + (i % 4) * 8, 0.22);
    }
    for (let i = 0; i < 11; i += 1) {
      const x = ((i * 260) - camera.x * 0.23) % (canvas.width + 480) - 240;
      const y = 98 + (i % 4) * 132;
      drawSmokeShape(x, y, 128 + (i % 3) * 20, 46 + (i % 2) * 14, 0.18);
    }
  }

  function drawFarPillars() {
    ctx.save();
    ctx.globalAlpha = 0.4;
    for (let i = 0; i < 8; i += 1) {
      const worldX = 120 + i * 400;
      const x = worldX - camera.x * 0.2;
      const width = 40;
      const capWidth = width + 20;
      ctx.fillStyle = "#9aa0a6";
      ctx.fillRect(x, -30, width, canvas.height + 60);
      ctx.fillStyle = "#7f8791";
      ctx.fillRect(x - 10, -22, capWidth, 16);
      ctx.fillRect(x - 10, canvas.height - 10, capWidth, 18);
    }
    ctx.restore();
  }

  function drawMidPillars() {
    ctx.save();
    ctx.globalAlpha = 0.7;
    for (let i = 0; i < 7; i += 1) {
      const worldX = 40 + i * 470;
      const x = worldX - camera.x * 0.36;
      const width = 60;
      const capWidth = width + 20;
      ctx.fillStyle = "#94a1ad";
      ctx.fillRect(x, -26, width, canvas.height + 52);
      ctx.fillStyle = "#7a8792";
      ctx.fillRect(x - 10, -18, capWidth, 20);
      ctx.fillRect(x - 10, canvas.height - 12, capWidth, 22);

      ctx.fillStyle = "#55595f";
      for (let s = 0; s < 3; s += 1) {
        const sx = x + 10 + s * 16;
        ctx.fillRect(sx, 0, 3, canvas.height);
      }
    }
    ctx.restore();
  }

  function drawTopLeftLight() {
    const glow = ctx.createRadialGradient(80, 70, 10, 80, 70, 360);
    glow.addColorStop(0, "rgba(255,255,255,0.28)");
    glow.addColorStop(0.35, "rgba(128,216,255,0.22)");
    glow.addColorStop(1, "rgba(128,216,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 520, 420);
  }

  function drawBackground() {
    ctx.fillStyle = "#05080f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawBackgroundSmoke();
    drawFarPillars();
    drawMidPillars();
    drawTopLeftLight();
  }

  function isBoundaryPlatform(plat) {
    return plat.x < 0 || plat.y < 0 || plat.x + plat.w > world.width || plat.y + plat.h > world.height;
  }

  function isGroundPlatform(plat) {
    return plat.w >= world.width - 2 && plat.y >= world.height - 100;
  }

  function drawCrystalTop(plat, baseY, seedOffset) {
    const step = 20;
    for (let x = 0; x <= plat.w + step; x += step) {
      const idx = x / step;
      const n = seededNoise(seedOffset + idx * 0.73);
      const h = 15 + n * 20;
      const color = idx % 2 === 0 ? "#4fc3f7" : "#0d47a1";
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(plat.x + x, baseY);
      ctx.lineTo(plat.x + x + step * 0.5, baseY - h);
      ctx.lineTo(plat.x + x + step, baseY);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "#80d8ff";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(plat.x + x + step * 0.5, baseY - h);
      ctx.lineTo(plat.x + x + step, baseY);
      ctx.stroke();
    }
  }

  function drawFloorCrystals(plat) {
    for (let i = 0; i < 36; i += 1) {
      const n = seededNoise(plat.x * 0.01 + i * 1.27);
      const x = plat.x + 24 + i * ((plat.w - 48) / 35);
      const h = 8 + n * 16;
      ctx.fillStyle = i % 2 === 0 ? "#4fc3f7" : "#0d47a1";
      ctx.beginPath();
      ctx.moveTo(x - 5, plat.y + 8);
      ctx.lineTo(x, plat.y + 8 - h);
      ctx.lineTo(x + 5, plat.y + 8);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPlatformBody(plat) {
    const topY = plat.y + 4;
    const topH = 12;
    const sideThickness = isGroundPlatform(plat) ? Math.max(plat.h - topH, 36) : 25;

    const bodyGradient = ctx.createLinearGradient(plat.x, topY, plat.x, topY + sideThickness + 20);
    bodyGradient.addColorStop(0, "#283593");
    bodyGradient.addColorStop(0.55, "#1a237e");
    bodyGradient.addColorStop(1, "#0a0e2a");

    ctx.fillStyle = bodyGradient;
    ctx.fillRect(plat.x, topY, plat.w, sideThickness);
    ctx.fillStyle = "#0a0e2a";
    ctx.fillRect(plat.x, topY + sideThickness, plat.w, Math.max(0, plat.h - sideThickness + 10));

    ctx.strokeStyle = "#80d8ff";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(plat.x + 0.5, topY + 0.5, plat.w - 1, sideThickness - 1);

    drawCrystalTop(plat, topY, plat.x * 0.07 + plat.y * 0.003);
  }

  function drawPlatforms() {
    platforms.forEach((plat) => {
      if (isBoundaryPlatform(plat)) {
        return;
      }
      drawPlatformBody(plat);
      if (isGroundPlatform(plat)) {
        ctx.fillStyle = "#0d1b4a";
        ctx.fillRect(plat.x, plat.y + 34, plat.w, Math.max(0, plat.h - 20));
        drawFloorCrystals(plat);
      }
    });
  }

  function drawAncientWheel(x, y, radius) {
    ctx.save();
    ctx.strokeStyle = "#9aa0a6";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(x, y, radius, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.68, Math.PI, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - radius, y);
    ctx.lineTo(x + radius, y);
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x, y);
    ctx.moveTo(x - radius * 0.72, y - radius * 0.72);
    ctx.lineTo(x + radius * 0.72, y);
    ctx.moveTo(x + radius * 0.72, y - radius * 0.72);
    ctx.lineTo(x - radius * 0.72, y);
    ctx.stroke();

    ctx.fillStyle = "#607d8b";
    ctx.fillRect(x - radius * 0.4, y, 14, 70);
    ctx.fillRect(x + radius * 0.26, y, 14, 70);
    ctx.restore();
  }

  function drawLadder(x, topY, bottomY) {
    ctx.save();
    ctx.strokeStyle = "#c9a84c";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, bottomY);
    ctx.moveTo(x + 32, topY);
    ctx.lineTo(x + 32, bottomY);
    ctx.stroke();

    ctx.lineWidth = 3;
    const rungCount = 8;
    for (let i = 0; i < rungCount; i += 1) {
      const y = topY + (i * (bottomY - topY)) / (rungCount - 1);
      ctx.beginPath();
      ctx.moveTo(x + 1, y);
      ctx.lineTo(x + 31, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawReturnPortal(now) {
    const portal = world.returnPortal;
    const centerX = portal.x + portal.w * 0.5;
    const centerY = portal.y + portal.h * 0.5;
    const pulse = 1 + Math.sin(now * 0.002) * 0.04;

    const glow = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, 110 * pulse);
    glow.addColorStop(0, "rgba(0, 188, 212, 0.45)");
    glow.addColorStop(0.5, "rgba(0, 96, 100, 0.3)");
    glow.addColorStop(1, "rgba(0, 96, 100, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, 84 * pulse, 108 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();

    const bodyGrad = ctx.createLinearGradient(centerX, centerY - 88, centerX, centerY + 88);
    bodyGrad.addColorStop(0, "#00bcd4");
    bodyGrad.addColorStop(1, "#006064");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, 50 * pulse, 78 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#80d8ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, 56 * pulse, 84 * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < 8; i += 1) {
      const angle = now * 0.0012 + (i * Math.PI * 2) / 8;
      const orbit = 72;
      const sx = centerX + Math.cos(angle) * orbit;
      const sy = centerY + Math.sin(angle) * (orbit * 0.62);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(angle + Math.PI * 0.5);
      ctx.fillStyle = i % 2 === 0 ? "#4fc3f7" : "#80d8ff";
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(7, 7);
      ctx.lineTo(-7, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = "#d9fcff";
    ctx.textAlign = "center";
    ctx.font = "bold 14px Pretendard, Noto Sans KR, sans-serif";
    ctx.fillText("LOBBY", centerX, centerY - 95);
  }

  function drawDungeonStructures(now) {
    drawAncientWheel(1420, world.height - 640, 90);
    drawAncientWheel(1940, world.height - 640, 90);
    drawLadder(120, world.height - 660, world.height - 94);
    drawReturnPortal(now);
  }
  function drawAttackEffects() {
    attackEffects.forEach((effect) => {
      const alpha = clamp(effect.life / effect.maxLife, 0, 1);
      ctx.save();
      ctx.translate(effect.x, effect.y);
      ctx.scale(effect.direction, 1);
      ctx.strokeStyle = `${effect.color}${alpha < 0.5 ? "aa" : ""}`;
      ctx.fillStyle = `${effect.color}33`;
      ctx.lineWidth = 8 * alpha + 2;
      if (effect.type === "slash") {
        ctx.beginPath();
        ctx.arc(0, 0, effect.size * 0.52, -0.9, 0.9);
        ctx.stroke();
      } else if (effect.type === "dash") {
        ctx.beginPath();
        ctx.moveTo(-effect.size * 0.2, -12);
        ctx.lineTo(effect.size * 0.8, -3);
        ctx.lineTo(-effect.size * 0.2, 12);
        ctx.closePath();
        ctx.fill();
      } else if (effect.type === "spark") {
        ctx.beginPath();
        ctx.arc(0, 0, effect.size * alpha * 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, effect.size * (1 - alpha * 0.45), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function drawProjectiles() {
    projectiles.forEach((projectile) => {
      const trail = clamp(projectile.life / projectile.maxLife, 0, 1);
      ctx.save();
      ctx.translate(projectile.x, projectile.y);
      ctx.fillStyle = projectile.color;
      ctx.beginPath();
      ctx.arc(0, 0, projectile.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffffaa";
      ctx.beginPath();
      ctx.arc(-projectile.radius * 0.25, -projectile.radius * 0.25, projectile.radius * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `${projectile.color}44`;
      ctx.fillRect(-projectile.radius * 3.4 * trail, -4, projectile.radius * 3.2 * trail, 8);
      ctx.restore();
    });
  }

  function drawCoins(now) {
    coinDrops.forEach((coin, index) => {
      const bob = coin.grounded ? Math.sin(now * 0.004 + index) * 2.5 : 0;
      ctx.save();
      ctx.translate(coin.x, coin.y + bob);
      ctx.rotate(coin.rotation);
      ctx.fillStyle = "#b78418";
      ctx.beginPath();
      ctx.ellipse(0, 0, coin.radius, coin.radius * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffd24f";
      ctx.beginPath();
      ctx.ellipse(0, -1, coin.radius - 2, coin.radius * 0.66, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff2b7";
      ctx.fillRect(-2, -coin.radius * 0.45, 4, coin.radius * 0.9);
      ctx.restore();
    });
  }

  function drawFloatingTexts() {
    floatingTexts.forEach((text) => {
      const alpha = clamp(text.life / text.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = text.color;
      ctx.font = "bold 18px Pretendard, Noto Sans KR, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(text.text, text.x, text.y);
      ctx.restore();
    });
  }

  function drawOverheadBar(x, y, width, ratio, fill) {
    ctx.fillStyle = "#00000088";
    ctx.fillRect(x - width * 0.5, y, width, 8);
    ctx.fillStyle = fill;
    ctx.fillRect(x - width * 0.5 + 1, y + 1, (width - 2) * ratio, 6);
  }

  function drawMonster(monster, index, now) {
    if (monster.dead) {
      return;
    }
    const palette = monsterPalette(monster.template_id);
    const bounce = Math.sin(now * 0.0035 + index * 1.17 + monster.bobSeed) * 3.2;
    const baseX = monster.x;
    const baseY = monster.y + bounce;
    ctx.save();
    ctx.translate(baseX, baseY);
    ctx.fillStyle = "#00000018";
    ctx.beginPath();
    ctx.ellipse(0, 12, 24, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    if (monster.hurtTimer > 0) {
      ctx.translate(Math.sin(now * 0.05) * 3, 0);
    }
    if (monster.sprite_hint === "slime") {
      ctx.fillStyle = palette.primary;
      ctx.beginPath();
      ctx.moveTo(-24, 2);
      ctx.quadraticCurveTo(-28, -38, 0, -46);
      ctx.quadraticCurveTo(28, -38, 24, 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = palette.secondary;
      ctx.beginPath();
      ctx.ellipse(0, -18, 14, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (monster.sprite_hint === "mushroom") {
      ctx.fillStyle = palette.secondary;
      ctx.fillRect(-11, -28, 22, 30);
      ctx.fillStyle = palette.primary;
      ctx.beginPath();
      ctx.arc(0, -30, 28, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffffcc";
      ctx.beginPath();
      ctx.arc(-8, -35, 5, 0, Math.PI * 2);
      ctx.arc(9, -38, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (monster.sprite_hint === "puff") {
      ctx.fillStyle = palette.primary;
      ctx.beginPath();
      ctx.arc(-14, -20, 16, 0, Math.PI * 2);
      ctx.arc(2, -26, 18, 0, Math.PI * 2);
      ctx.arc(19, -18, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = palette.secondary;
      ctx.beginPath();
      ctx.arc(0, -22, 12, 0, Math.PI * 2);
      ctx.fill();
    } else if (monster.sprite_hint === "sprout") {
      ctx.fillStyle = palette.primary;
      ctx.beginPath();
      ctx.ellipse(0, -18, 22, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#74bf61";
      ctx.beginPath();
      ctx.ellipse(-8, -46, 8, 14, -0.6, 0, Math.PI * 2);
      ctx.ellipse(10, -46, 8, 14, 0.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (monster.sprite_hint === "bat") {
      ctx.fillStyle = palette.primary;
      ctx.beginPath();
      ctx.moveTo(-26, -16);
      ctx.quadraticCurveTo(-42, -34, -16, -30);
      ctx.quadraticCurveTo(-2, -24, 0, -12);
      ctx.quadraticCurveTo(2, -24, 16, -30);
      ctx.quadraticCurveTo(42, -34, 26, -16);
      ctx.quadraticCurveTo(16, 2, 0, 0);
      ctx.quadraticCurveTo(-16, 2, -26, -16);
      ctx.fill();
      ctx.fillStyle = palette.secondary;
      ctx.beginPath();
      ctx.arc(0, -14, 10, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = palette.primary;
      ctx.beginPath();
      ctx.ellipse(0, -18, 24, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.arc(-7, -20, 2.6, 0, Math.PI * 2);
    ctx.arc(7, -20, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawOverheadBar(monster.x, monster.y - 76, 60, clamp(monster.hp / Math.max(1, monster.maxHp), 0, 1), "#7cf0a1");
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "13px Pretendard, Noto Sans KR, sans-serif";
    ctx.fillText(monster.name, monster.x, monster.y - 86);
  }

  function getPlayerPose(now) {
    const runBlend = clamp(Math.abs(player.vx) / MAX_RUN_SPEED, 0, 1);
    const stride = Math.sin(now * 0.018) * runBlend;
    const pose = { bob: player.onGround ? Math.abs(Math.sin(now * 0.02)) * 2.8 * runBlend : 0, bodyLean: clamp(player.vx / MAX_RUN_SPEED, -0.14, 0.14), armFront: stride * 0.9, armBack: -stride * 0.9, legFront: -stride * 1.15, legBack: stride * 1.15, weaponReach: 0.34, weaponType: "sword", eyeSquint: false };
    if (!player.onGround) {
      pose.bodyLean = player.vy < 0 ? -0.08 : 0.08;
      pose.armFront = 0.4;
      pose.armBack = -0.35;
      pose.legFront = -0.55;
      pose.legBack = 0.7;
    }
    if (player.attack) {
      const progress = clamp(player.attack.elapsed / player.attack.duration, 0, 1);
      if (player.attack.type === "melee") {
        pose.armFront = -1.2 + progress * 2.1;
        pose.armBack = -0.2;
        pose.bodyLean = 0.16;
        pose.weaponReach = 0.9;
        pose.weaponType = "sword";
      } else if (player.attack.type === "projectile") {
        pose.armFront = -0.6 + progress * 0.6;
        pose.armBack = 0.25;
        pose.bodyLean = 0.05;
        pose.weaponReach = 0.65;
        pose.weaponType = "staff";
      } else {
        pose.armFront = 0.9;
        pose.armBack = -0.7;
        pose.legFront = -0.2;
        pose.legBack = 0.4;
        pose.bodyLean = 0.24;
        pose.weaponReach = 1.15;
        pose.weaponType = "spear";
      }
      pose.eyeSquint = true;
    }
    if (player.deadTimer > 0) {
      pose.bodyLean = 0.22;
      pose.armFront = 1.0;
      pose.armBack = 0.6;
      pose.legFront = 0.3;
      pose.legBack = 0.15;
      pose.eyeSquint = true;
    }
    return pose;
  }

  function drawPlayer(now) {
    const pose = getPlayerPose(now);
    ctx.save();
    ctx.translate(player.x, player.y + pose.bob);
    ctx.scale(player.direction, 1);
    ctx.fillStyle = "#0000001d";
    ctx.beginPath();
    ctx.ellipse(0, 18, 22, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    if (player.hitFlash > 0 && Math.sin(now * 0.08) > 0) {
      ctx.translate(3, 0);
    }
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
    ctx.fillStyle = player.deadTimer > 0 ? "#64748b" : "#2a75d5";
    ctx.beginPath();
    ctx.roundRect(-16, -18, 32, 36, 10);
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = player.deadTimer > 0 ? "#7c8ba1" : "#5aa0ff";
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
    const eyeY = pose.eyeSquint ? -36 : -34;
    if (pose.eyeSquint) {
      ctx.fillRect(3, eyeY, 5, 2);
      ctx.fillRect(-8, eyeY, 5, 2);
    } else {
      ctx.beginPath();
      ctx.arc(6, eyeY, 2.3, 0, Math.PI * 2);
      ctx.arc(-5, eyeY, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#11315a";
    ctx.beginPath();
    ctx.arc(0, -48, 18, Math.PI, Math.PI * 2);
    ctx.fill();
    if (pose.weaponType === "sword") {
      ctx.strokeStyle = "#dce7f7";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(28, -2 + pose.armFront * 12);
      ctx.lineTo(56 + pose.weaponReach * 8, -22);
      ctx.stroke();
      ctx.strokeStyle = "#f4be53";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(26, 1 + pose.armFront * 12);
      ctx.lineTo(36, -3);
      ctx.stroke();
    } else if (pose.weaponType === "staff") {
      ctx.strokeStyle = "#dcb1ff";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(26, -6 + pose.armFront * 10);
      ctx.lineTo(46, -26);
      ctx.stroke();
      ctx.fillStyle = "#7fe7ff";
      ctx.beginPath();
      ctx.arc(49, -29, 6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = "#ffe7d8";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(26, -3 + pose.armFront * 8);
      ctx.lineTo(70, -12);
      ctx.stroke();
      ctx.fillStyle = "#ff9d8f";
      ctx.beginPath();
      ctx.moveTo(70, -12);
      ctx.lineTo(82, -18);
      ctx.lineTo(76, -2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    drawOverheadBar(player.x, player.y - 96, 72, clamp(player.hp / Math.max(1, player.maxHp), 0, 1), "#ff6961");
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "bold 14px Pretendard, Noto Sans KR, sans-serif";
    ctx.fillText(profile.nickname, player.x, player.y - 106);
  }

  function render(now) {
    drawBackground();
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    drawPlatforms();
    drawDungeonStructures(now);
    drawCoins(now);
    drawAttackEffects();
    monsters.forEach((monster, index) => drawMonster(monster, index, now));
    drawProjectiles();
    drawPlayer(now);
    drawFloatingTexts();
    ctx.restore();
  }

  function step(dt, now) {
    stepMovement(dt);
    updatePlayerState(dt);
    updateMonsters(dt, now);
    updateAttack(dt);
    updateProjectiles(dt);
    updateAttackEffects(dt);
    updateCoins(dt);
    updateFloatingTexts(dt);
    updateHud();
    updatePortalPrompt();
    updatePickupPrompt();
  }

  function gameLoop(now) {
    const delta = Math.min(0.05, (now - prevTs) / 1000);
    prevTs = now;
    accum += delta;
    while (accum >= FIXED_DT) {
      step(FIXED_DT, now);
      accum -= FIXED_DT;
    }
    render(now);
    requestAnimationFrame(gameLoop);
  }

  function requestDungeonJoin() {
    if (!socket) {
      bootstrapFallbackMonsters();
      return;
    }
    socket.emit("join_dungeon", { dungeon_id: dungeonId, nickname: profile.nickname, profile_id: profile._id });
  }

  if (socket) {
    socket.on("connect", () => {
      connectionState = "connected";
      renderStatus();
      addFeed("Dungeon socket connected.");
      requestDungeonJoin();
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
      }
      fallbackTimer = window.setTimeout(() => {
        bootstrapFallbackMonsters();
      }, 1200);
    });

    socket.on("disconnect", () => {
      connectionState = "disconnected";
      renderStatus();
      addFeed("Dungeon socket disconnected.");
      bootstrapFallbackMonsters();
    });

    socket.on("dungeon_joined", (payload) => {
      syncWorld(payload.world || null);
      dungeonKeywords = payload.keywords || null;
      applyMonsterSnapshot(payload.snapshot || {}, true);
      player.x = world.spawn.x;
      player.y = world.spawn.y;
      addFeed(`Monsters ready: ${monsters.length}.`);
    });

    socket.on("dungeon_snapshot", (snapshot) => {
      if (!monsters.length) {
        applyMonsterSnapshot(snapshot || {}, true);
      }
    });
  } else {
    addFeed("Socket.IO not available. Running local dungeon mode.");
    bootstrapFallbackMonsters();
  }

  addFeed("Dungeon combat loaded.");
  addFeed("Z: slash, X: projectile, C: drive, E: pick up coins.");
  addFeed("Use the rotating portal and press Up to return to the lobby.");
  renderStatus();
  updateHud();
  updatePortalPrompt();
  updatePickupPrompt();

  document.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }
    if (event.key === "ArrowLeft") {
      keys.left = true;
    } else if (event.key === "ArrowRight") {
      keys.right = true;
    } else if (event.key === "ArrowUp") {
      keys.up = true;
      interactQueued = true;
    } else if (event.key === " " || event.code === "Space") {
      keys.jumpHeld = true;
      jumpQueued = true;
      event.preventDefault();
    } else if (event.code === "KeyZ" || event.code === "KeyX" || event.code === "KeyC") {
      tryAttack(event.code);
      event.preventDefault();
    } else if (event.code === "KeyE") {
      collectCoins();
      event.preventDefault();
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

  attackZBtn?.addEventListener("click", () => tryAttack("KeyZ"));
  attackXBtn?.addEventListener("click", () => tryAttack("KeyX"));
  attackCBtn?.addEventListener("click", () => tryAttack("KeyC"));
  pickupBtn?.addEventListener("click", collectCoins);

  window.render_game_to_text = () => JSON.stringify({
    mode: "dungeon-combat-live",
    dungeon: { id: world.id, width: world.width, height: world.height },
    player: { profile_id: profile._id, nickname: profile.nickname, hp: Math.round(player.hp), max_hp: player.maxHp, coin: player.coin, x: Math.round(player.x), y: Math.round(player.y), attacking: Boolean(player.attack) },
    controls: { attack_keys: Object.keys(ATTACKS), pickup_key: "KeyE" },
    monsters: monsters.map((monster) => ({ monster_id: monster.monster_id, name: monster.name, hp: Math.round(monster.hp), dead: monster.dead, x: Math.round(monster.x), y: Math.round(monster.y) })),
    coins: { on_ground: coinDrops.length, nearby: getNearbyCoins().length },
    hooks: { keywords: dungeonKeywords, action_log: actionLog.slice(-6) },
  });

  window.advanceTime = (ms) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      step(FIXED_DT, performance.now());
    }
    render(performance.now());
  };

  requestAnimationFrame(gameLoop);
})();




