(() => {
  const nameEl = document.getElementById("game-name");
  const hpEl = document.getElementById("game-hp");
  const coinEl = document.getElementById("game-coin");
  const sessionEl = document.getElementById("game-session");
  const partyEl = document.getElementById("game-party");

  const phaseEl = document.getElementById("volleyball-phase");
  const statusEl = document.getElementById("volleyball-status");
  const scoreEl = document.getElementById("volleyball-score");
  const feedEl = document.getElementById("volleyball-feed");

  const resultPanel = document.getElementById("volleyball-result-panel");
  const resultTitle = document.getElementById("volleyball-result-title");
  const resultScore = document.getElementById("volleyball-result-score");
  const resultCoin = document.getElementById("volleyball-result-coin");
  const rematchStatus = document.getElementById("volleyball-rematch-status");

  const rematchBtn = document.getElementById("volleyball-rematch-btn");
  const backBtn = document.getElementById("volleyball-back-btn");

  const canvas = document.getElementById("volleyball-canvas");
  const ctx = canvas.getContext("2d");

  const profileRaw = sessionStorage.getItem("player_profile");
  const profile = profileRaw
    ? JSON.parse(profileRaw)
    : { _id: "guest", nickname: "demoUser1", hp: 100, coin: 0 };

  function setCoinValue(value) {
    const coin = Number.isFinite(Number(value)) ? Number(value) : 0;
    profile.coin = coin;
    coinEl.textContent = String(coin);
    sessionStorage.setItem("player_profile", JSON.stringify(profile));
  }

  nameEl.textContent = profile.nickname;
  hpEl.textContent = String(Number.isFinite(Number(profile.hp)) ? Number(profile.hp) : 100);
  setCoinValue(profile.coin);

  const url = new URL(window.location.href);
  const sessionIdFromQuery = url.searchParams.get("session");

  const storedSessionRaw = sessionStorage.getItem("active_minigame_session");
  const storedSession = storedSessionRaw ? JSON.parse(storedSessionRaw) : null;

  const sessionId = sessionIdFromQuery || storedSession?.session_id || "";
  sessionEl.textContent = sessionId || "demo";

  if (storedSession?.players?.length) {
    const members = storedSession.players.map((p) => p.nickname).join(", ");
    partyEl.textContent = `파티: ${members}`;
  } else {
    partyEl.textContent = "세션 정보 없음 - demo fallback 가능";
  }

  function appendFeed(text, type = "system") {
    const line = document.createElement("div");
    line.className = `feed-line ${type}`;
    line.textContent = text;
    feedEl.appendChild(line);
    while (feedEl.children.length > 40) {
      feedEl.removeChild(feedEl.firstChild);
    }
    feedEl.scrollTop = feedEl.scrollHeight;
  }

  function setPhase(text) {
    phaseEl.textContent = text;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function setScore(text) {
    scoreEl.textContent = text;
  }

  function hideResultPanel() {
    resultPanel.classList.add("hidden");
  }

  function showResultPanel(payload) {
    const didWin = payload.winnerSide === payload.mySide;
    const scores = payload.scores || { left: 0, right: 0 };
    const coins = payload.coins || {};

    resultTitle.textContent = didWin ? "승리했습니다" : "패배했습니다";
    resultScore.textContent = `${scores.left} : ${scores.right}`;
    resultCoin.textContent = `코인 ${coins.me_before ?? "-"} -> ${coins.me_after_result ?? "-"} (입장 -${coins.entry_fee ?? 10}, 승리 +${didWin ? (coins.win_reward ?? 20) : 0})`;
    rematchStatus.textContent = payload.mode === "demo" ? "데모 모드 재대결 가능" : "재대결 버튼으로 재요청";
    resultPanel.classList.remove("hidden");

    appendFeed(
      didWin
        ? `${payload.winnerNickname || "플레이어"} 승리. 보상 +${coins.win_reward ?? 20} 코인`
        : `${payload.winnerNickname || "상대"} 승리`,
      "system"
    );

    if (Number.isFinite(Number(coins.me_after_result))) {
      setCoinValue(Number(coins.me_after_result));
    }
  }

  const socket = io();

  const runtime = window.createVolleyballRuntime({
    canvas,
    ctx,
    socket,
    profile,
    sessionId,
    onStatus: setStatus,
    onPhase: setPhase,
    onScore: setScore,
    onFeed: appendFeed,
    onCoin: setCoinValue,
    onResult: showResultPanel,
    onHideResult: hideResultPanel,
  });

  runtime.init();

  let prevTs = performance.now();
  let accum = 0;
  const FIXED_DT = 1 / 60;

  function loop(now) {
    const delta = Math.min(0.05, (now - prevTs) / 1000);
    prevTs = now;
    accum += delta;

    while (accum >= FIXED_DT) {
      runtime.update(FIXED_DT);
      accum -= FIXED_DT;
    }

    runtime.render();
    requestAnimationFrame(loop);
  }

  rematchBtn.addEventListener("click", () => {
    runtime.requestRematch();
    rematchStatus.textContent = "재대결 요청 전송";
  });

  backBtn.addEventListener("click", () => {
    runtime.leaveToLobby();
    window.location.assign("/");
  });

  document.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }

    if (event.key.toLowerCase() === "f") {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        canvas.requestFullscreen().catch(() => {});
      }
      return;
    }

    runtime.onKeyDown(event);
  });

  document.addEventListener("keyup", (event) => {
    runtime.onKeyUp(event);
  });

  window.addEventListener("beforeunload", () => {
    runtime.leaveToLobby();
  });

  window.render_game_to_text = () => runtime.renderGameToText();
  window.advanceTime = (ms) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      runtime.update(FIXED_DT);
    }
    runtime.render();
  };

  appendFeed("배구 런타임 초기화", "system");
  requestAnimationFrame(loop);
})();
