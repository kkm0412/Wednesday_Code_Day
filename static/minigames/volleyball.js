(() => {
  const COURT = {
    width: 1280,
    height: 720,
    groundY: 640,
    netX: 640,
    netHeight: 195,
    netHalfWidth: 9,
  };

  const TARGET_SCORE = 5;
  const ENTRY_FEE = 10;
  const WIN_REWARD = 20;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function safeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function createInitialState() {
    return {
      phase: "playing",
      target_score: TARGET_SCORE,
      scores: { left: 0, right: 0 },
      countdown_seconds: 5,
      countdown_remaining: 0,
      court: {
        width: COURT.width,
        height: COURT.height,
        ground_y: COURT.groundY,
        net_x: COURT.netX,
        net_height: COURT.netHeight,
      },
      players: {
        left: {
          x: 250,
          y: COURT.groundY - 38,
          vx: 0,
          vy: 0,
          radius: 38,
          jump_lock: false,
          nickname: "left",
        },
        right: {
          x: COURT.width - 250,
          y: COURT.groundY - 38,
          vx: 0,
          vy: 0,
          radius: 38,
          jump_lock: false,
          nickname: "right",
        },
      },
      ball: {
        x: COURT.width * 0.5,
        y: 230,
        vx: 0,
        vy: -120,
        radius: 18,
      },
      winner_side: null,
      reason: null,
      last_point_side: null,
    };
  }

  function resetBallForServe(state, servingSide) {
    if (servingSide === "left") {
      state.ball.x = COURT.width * 0.35;
      state.ball.vx = 140;
    } else {
      state.ball.x = COURT.width * 0.65;
      state.ball.vx = -140;
    }
    state.ball.y = 230;
    state.ball.vy = -80;
  }

  function updatePlayerPhysics(body, control, side, dt) {
    const accel = 2400;
    const maxSpeed = 430;
    const friction = 9.4;
    const gravity = 1880;
    const jumpVelocity = -790;

    const intent = (control.right ? 1 : 0) - (control.left ? 1 : 0);
    body.vx += intent * accel * dt;

    if (!intent) {
      body.vx *= Math.max(0, 1 - friction * dt);
    }

    body.vx = clamp(body.vx, -maxSpeed, maxSpeed);

    const onGround = body.y >= COURT.groundY - body.radius - 0.5;
    if (control.jump && onGround && !body.jump_lock) {
      body.vy = jumpVelocity;
      body.jump_lock = true;
    } else if (!control.jump) {
      body.jump_lock = false;
    }

    body.vy += gravity * dt;
    body.vy = clamp(body.vy, -1200, 1450);

    body.x += body.vx * dt;
    body.y += body.vy * dt;

    if (side === "left") {
      body.x = clamp(body.x, body.radius + 18, COURT.netX - body.radius - 8);
    } else {
      body.x = clamp(body.x, COURT.netX + body.radius + 8, COURT.width - body.radius - 18);
    }

    if (body.y > COURT.groundY - body.radius) {
      body.y = COURT.groundY - body.radius;
      body.vy = 0;
    }
  }

  function resolveBallPlayerCollision(ball, body) {
    let dx = ball.x - body.x;
    let dy = ball.y - body.y;
    const minDist = ball.radius + body.radius;

    let distSq = dx * dx + dy * dy;
    if (distSq <= 0) {
      dx = 0.01;
      dy = -1;
      distSq = dx * dx + dy * dy;
    }

    if (distSq >= minDist * minDist) {
      return;
    }

    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;

    ball.x += nx * overlap;
    ball.y += ny * overlap;

    const relVx = ball.vx - body.vx;
    const relVy = ball.vy - body.vy;
    const approaching = relVx * nx + relVy * ny;

    if (approaching < 0) {
      const restitution = 1.05;
      const impulse = -(1 + restitution) * approaching;
      ball.vx += impulse * nx;
      ball.vy += impulse * ny;
    }

    ball.vx += body.vx * 0.12;
    ball.vy -= 58;
  }

  function updateBallAndScoring(state, dt) {
    const ball = state.ball;

    ball.vy += 1850 * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x < ball.radius) {
      ball.x = ball.radius;
      ball.vx = Math.abs(ball.vx) * 0.92;
    } else if (ball.x > COURT.width - ball.radius) {
      ball.x = COURT.width - ball.radius;
      ball.vx = -Math.abs(ball.vx) * 0.92;
    }

    if (ball.y < ball.radius) {
      ball.y = ball.radius;
      ball.vy = Math.abs(ball.vy) * 0.9;
    }

    if (Math.abs(ball.x - COURT.netX) < COURT.netHalfWidth + ball.radius && ball.y + ball.radius > COURT.groundY - COURT.netHeight) {
      if (ball.x < COURT.netX) {
        ball.x = COURT.netX - (COURT.netHalfWidth + ball.radius);
        ball.vx = -Math.abs(ball.vx) * 0.9;
      } else {
        ball.x = COURT.netX + (COURT.netHalfWidth + ball.radius);
        ball.vx = Math.abs(ball.vx) * 0.9;
      }
    }

    resolveBallPlayerCollision(ball, state.players.left);
    resolveBallPlayerCollision(ball, state.players.right);

    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 990) {
      const scale = 990 / speed;
      ball.vx *= scale;
      ball.vy *= scale;
    }

    if (ball.y + ball.radius >= COURT.groundY) {
      const landedSide = ball.x < COURT.netX ? "left" : "right";
      return landedSide === "left" ? "right" : "left";
    }

    return null;
  }

  function createVolleyballRuntime(config) {
    const {
      canvas,
      ctx,
      socket,
      profile,
      sessionId,
      onStatus,
      onPhase,
      onScore,
      onFeed,
      onCoin,
      onResult,
      onHideResult,
    } = config;

    const inputState = { left: false, right: false, jump: false };
    let lastInputSent = { left: false, right: false, jump: false };
    let inputSendAccum = 0;

    let mode = "network";
    let phase = "connecting";
    let mySide = null;
    let state = null;

    let handlersBound = false;
    let connectedAt = Date.now();

    const demo = {
      meNickname: (profile && profile.nickname) || "demoUser1",
      oppNickname: "demoUser2",
      scores: { left: 0, right: 0 },
      coins: {
        left: safeNumber(profile && profile.coin, 0),
        right: 0,
      },
      entryLedger: null,
      rewardLedger: null,
      state: null,
    };

    function setScoreFromState(currentState) {
      onScore(`${currentState.scores.left} : ${currentState.scores.right}`);
    }

    function syncCoinDisplay() {
      if (mySide === "left") {
        onCoin(demo.coins.left);
      } else if (mySide === "right") {
        onCoin(demo.coins.right);
      }
    }

    function startDemo(reason) {
      mode = "demo";
      phase = "playing";
      mySide = "left";

      demo.state = createInitialState();
      demo.state.players.left.nickname = demo.meNickname;
      demo.state.players.right.nickname = demo.oppNickname;
      demo.state.scores.left = 0;
      demo.state.scores.right = 0;
      demo.entryLedger = {
        left: { before: demo.coins.left, after_entry: demo.coins.left - ENTRY_FEE },
        right: { before: demo.coins.right, after_entry: demo.coins.right - ENTRY_FEE },
      };
      demo.rewardLedger = null;
      demo.coins.left -= ENTRY_FEE;
      demo.coins.right -= ENTRY_FEE;
      syncCoinDisplay();

      onHideResult();
      onPhase("데모 진행중");
      onStatus(reason || "데모 모드로 실행됩니다.");
      onFeed("실시간 세션 연결 실패: demo fallback 시작", "system");

      state = demo.state;
      setScoreFromState(state);
    }

    function bindHandlers() {
      if (handlersBound) {
        return;
      }

      socket.on("volley_joined", (payload) => {
        if (!payload || payload.session_id !== sessionId) {
          return;
        }
        mySide = payload.side;
        connectedAt = Date.now();
        onFeed(`세션 접속 완료 (${mySide.toUpperCase()})`, "system");
      });

      socket.on("volley_waiting", (payload) => {
        if (!payload) {
          return;
        }
        phase = "waiting";
        onPhase("대기중");
        const connected = Number.isFinite(Number(payload.connected_players))
          ? Number(payload.connected_players)
          : 1;
        onStatus(`상대 접속 대기 중 (${connected}/2)`);
      });

      socket.on("volley_start", (payload) => {
        if (!payload || payload.session_id !== sessionId) {
          return;
        }

        mode = "network";
        phase = payload.status === "countdown" ? "countdown" : "playing";
        state = state || createInitialState();
        state.phase = payload.status || "playing";
        state.scores = payload.scores || state.scores;
        state.countdown_seconds = safeNumber(payload.countdown_seconds, state.countdown_seconds || 5);
        state.countdown_remaining = safeNumber(
          payload.countdown_remaining,
          state.countdown_remaining || state.countdown_seconds || 0
        );
        if (payload.side_nicknames) {
          state.players.left.nickname = payload.side_nicknames.left || state.players.left.nickname;
          state.players.right.nickname = payload.side_nicknames.right || state.players.right.nickname;
        }

        onHideResult();
        onPhase(payload.status === "countdown" ? "카운트다운" : "진행중");
        onStatus(payload.status === "countdown" ? "경기 시작 카운트다운" : "실시간 매치 진행중");
        onFeed("배구 매치 시작", "system");

        setScoreFromState(state);
      });

      socket.on("volley_state", (payload) => {
        if (!payload || payload.session_id !== sessionId || mode !== "network") {
          return;
        }

        const field = payload.field || {};
        const left = payload.players?.left;
        const right = payload.players?.right;
        const ball = payload.ball;
        if (!left || !right || !ball) {
          return;
        }
        const fw = Number(field.width) || COURT.width;
        const fh = Number(field.height) || COURT.height;
        const sx = COURT.width / fw;
        const sy = COURT.height / fh;

        state = {
          phase: payload.status || "playing",
          target_score: payload.target_score || TARGET_SCORE,
          scores: payload.scores || { left: 0, right: 0 },
          countdown_seconds: safeNumber(payload.countdown_seconds, state?.countdown_seconds || 5),
          countdown_remaining: safeNumber(payload.countdown_remaining, state?.countdown_remaining || 0),
          court: {
            width: field.width || COURT.width,
            height: field.height || COURT.height,
            ground_y: field.floor_y || COURT.groundY,
            net_x: field.racket_x || COURT.netX,
            net_height: field.racket_h || COURT.netHeight,
          },
          players: {
            left: {
              x: left.x * sx,
              y: left.y * sy,
              vx: left.vx * sx,
              vy: left.vy * sy,
              radius: Math.max(12, Math.min((left.w || 76) * sx, (left.h || 76) * sy) * 0.5),
              jump_lock: false,
              nickname: left.nickname || "left",
            },
            right: {
              x: right.x * sx,
              y: right.y * sy,
              vx: right.vx * sx,
              vy: right.vy * sy,
              radius: Math.max(12, Math.min((right.w || 76) * sx, (right.h || 76) * sy) * 0.5),
              jump_lock: false,
              nickname: right.nickname || "right",
            },
          },
          ball: {
            x: ball.x * sx,
            y: ball.y * sy,
            vx: ball.vx * sx,
            vy: ball.vy * sy,
            radius: Math.max(8, ball.r * ((sx + sy) * 0.5)),
          },
          winner_side: null,
          reason: null,
          last_point_side: null,
        };

        if (payload.status === "finished") {
          phase = "finished";
        } else if (payload.status === "countdown") {
          phase = "countdown";
        } else {
          phase = "playing";
        }
        onPhase(payload.status === "countdown" ? "카운트다운" : "진행중");
        setScoreFromState(state);
      });

      socket.on("volley_match_end", (payload) => {
        if (!payload || payload.session_id !== sessionId) {
          return;
        }

        phase = "finished";
        onPhase("종료");
        onStatus(payload.reason === "forfeit" ? "상대 이탈로 경기 종료" : "경기 종료");

        const didWin = mySide && payload.winner_side === mySide;
        const myAfter = didWin && Number.isFinite(Number(payload.winner_coin))
          ? Number(payload.winner_coin)
          : safeNumber(profile && profile.coin, 0);
        onCoin(myAfter);

        onResult({
          winnerSide: payload.winner_side,
          winnerNickname: payload.winner_nickname,
          scores: payload.scores,
          reason: payload.reason,
          coins: {
            entry_fee: payload.entry_fee ?? ENTRY_FEE,
            win_reward: payload.pot ?? WIN_REWARD,
            me_after_result: myAfter,
          },
          mySide,
          mode: "network",
        });
      });

      handlersBound = true;
    }

    function unbindHandlers() {
      if (!handlersBound) {
        return;
      }

      socket.off("volley_joined");
      socket.off("volley_waiting");
      socket.off("volley_start");
      socket.off("volley_state");
      socket.off("volley_match_end");
      handlersBound = false;
    }

    function sendInputIfNeeded(force = false) {
      if (mode !== "network" || phase !== "playing" || !sessionId) {
        return;
      }

      const changed =
        force ||
        inputState.left !== lastInputSent.left ||
        inputState.right !== lastInputSent.right ||
        inputState.jump !== lastInputSent.jump;

      if (!changed) {
        return;
      }

      socket.emit("volley_input", {
        session_id: sessionId,
        left: inputState.left,
        right: inputState.right,
        jump: inputState.jump,
      });

      lastInputSent = {
        left: inputState.left,
        right: inputState.right,
        jump: inputState.jump,
      };
    }

    function updateDemoAi() {
      if (!demo.state || phase !== "playing") {
        return;
      }

      const ball = demo.state.ball;
      const right = demo.state.players.right;
      const control = { left: false, right: false, jump: false };

      const targetX = clamp(ball.x, COURT.netX + 70, COURT.width - 70);
      if (targetX < right.x - 12) {
        control.left = true;
      } else if (targetX > right.x + 12) {
        control.right = true;
      }

      if (Math.abs(ball.x - right.x) < 120 && ball.y < right.y - 30 && ball.vy > 0) {
        control.jump = true;
      }

      return control;
    }

    function finishDemoRound(winnerSide, reason) {
      phase = "finished";
      demo.state.phase = "finished";
      demo.state.winner_side = winnerSide;
      demo.state.reason = reason;

      const rewardBefore = demo.coins[winnerSide];
      demo.coins[winnerSide] += WIN_REWARD;
      demo.rewardLedger = {
        side: winnerSide,
        before_reward: rewardBefore,
        after_reward: demo.coins[winnerSide],
      };

      syncCoinDisplay();

      const myCoins = mySide === "left" ? demo.coins.left : demo.coins.right;
      const myEntry = mySide === "left" ? demo.entryLedger.left : demo.entryLedger.right;

      onResult({
        winnerSide,
        winnerNickname: winnerSide === "left" ? demo.meNickname : demo.oppNickname,
        scores: demo.state.scores,
        reason,
        coins: {
          entry_fee: ENTRY_FEE,
          win_reward: WIN_REWARD,
          me_before: myEntry.before,
          me_after_entry: myEntry.after_entry,
          me_after_result: myCoins,
          opponent_after_result: mySide === "left" ? demo.coins.right : demo.coins.left,
        },
        mySide,
        mode: "demo",
      });

      onPhase("종료(데모)");
      onStatus("데모 경기 종료");
    }

    function updateDemo(dt) {
      if (!demo.state || phase !== "playing") {
        return;
      }

      const demoAi = updateDemoAi();
      const leftControl = inputState;
      const rightControl = demoAi || { left: false, right: false, jump: false };

      updatePlayerPhysics(demo.state.players.left, leftControl, "left", dt);
      updatePlayerPhysics(demo.state.players.right, rightControl, "right", dt);

      const scorer = updateBallAndScoring(demo.state, dt);
      if (scorer) {
        demo.state.scores[scorer] += 1;
        demo.state.last_point_side = scorer;
        if (demo.state.scores[scorer] >= TARGET_SCORE) {
          finishDemoRound(scorer, "score");
        } else {
          resetBallForServe(demo.state, scorer);
        }
      }

      state = demo.state;
      setScoreFromState(state);
    }

    function drawCourt(currentState) {
      ctx.fillStyle = "#8ccfff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#ffffff66";
      for (let i = 0; i < 8; i += 1) {
        ctx.beginPath();
        ctx.ellipse(120 + i * 165, 80 + (i % 3) * 28, 56, 18, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "#f0d3a1";
      ctx.fillRect(0, COURT.groundY, COURT.width, COURT.height - COURT.groundY);

      ctx.fillStyle = "#c4a27f";
      ctx.fillRect(0, COURT.groundY + 36, COURT.width, 16);

      ctx.fillStyle = "#f6f6f6";
      ctx.fillRect(COURT.netX - 7, COURT.groundY - COURT.netHeight, 14, COURT.netHeight);

      ctx.strokeStyle = "#6f6f6f";
      ctx.lineWidth = 2;
      for (let i = 0; i < 10; i += 1) {
        const y = COURT.groundY - COURT.netHeight + i * (COURT.netHeight / 10);
        ctx.beginPath();
        ctx.moveTo(COURT.netX - 7, y);
        ctx.lineTo(COURT.netX + 7, y);
        ctx.stroke();
      }
    }

    function drawScoreboard(currentState) {
      const leftScore = safeNumber(currentState.scores?.left, 0);
      const rightScore = safeNumber(currentState.scores?.right, 0);

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#13273f";
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 148px Pretendard, Noto Sans KR, sans-serif";
      ctx.strokeText(String(leftScore), canvas.width * 0.25, 112);
      ctx.fillText(String(leftScore), canvas.width * 0.25, 112);
      ctx.strokeText(String(rightScore), canvas.width * 0.75, 112);
      ctx.fillText(String(rightScore), canvas.width * 0.75, 112);

      ctx.font = "700 24px Pretendard, Noto Sans KR, sans-serif";
      ctx.fillStyle = "#173253";
      ctx.fillText(currentState.players.left.nickname || "LEFT", canvas.width * 0.25, 174);
      ctx.fillText(currentState.players.right.nickname || "RIGHT", canvas.width * 0.75, 174);

      ctx.font = "700 24px Pretendard, Noto Sans KR, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#173253";
      ctx.lineWidth = 5;
      const centerText = `${leftScore} : ${rightScore}  (to ${safeNumber(currentState.target_score, TARGET_SCORE)})`;
      ctx.strokeText(centerText, canvas.width * 0.5, 52);
      ctx.fillText(centerText, canvas.width * 0.5, 52);
      ctx.restore();
    }

    function drawCountdownOverlay(currentState) {
      if (currentState.phase !== "countdown") {
        return;
      }

      const countdown = Math.max(0, Math.ceil(safeNumber(currentState.countdown_remaining, 0)));
      ctx.save();
      ctx.fillStyle = "#102238c8";
      ctx.fillRect(canvas.width * 0.32, canvas.height * 0.28, canvas.width * 0.36, 260);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffffff";
      ctx.font = "800 42px Pretendard, Noto Sans KR, sans-serif";
      ctx.fillText("경기 시작까지", canvas.width * 0.5, canvas.height * 0.40);
      ctx.font = "900 140px Pretendard, Noto Sans KR, sans-serif";
      ctx.fillText(String(countdown), canvas.width * 0.5, canvas.height * 0.56);
      ctx.restore();
    }

    function drawPlayer(side, body) {
      const isMine = side === mySide;
      const bodyColor = isMine ? "#f5dc4c" : "#ffb66b";
      const earColor = isMine ? "#1d1d1d" : "#7c3a13";

      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = earColor;
      ctx.beginPath();
      ctx.arc(body.x - body.radius * 0.45, body.y - body.radius * 0.74, 8, 0, Math.PI * 2);
      ctx.arc(body.x + body.radius * 0.45, body.y - body.radius * 0.74, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#101010";
      ctx.beginPath();
      ctx.arc(body.x - 8, body.y - 4, 3.1, 0, Math.PI * 2);
      ctx.arc(body.x + 8, body.y - 4, 3.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = isMine ? "#123d66" : "#602f13";
      ctx.font = "15px Pretendard, Noto Sans KR, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(body.nickname || side, body.x, body.y - body.radius - 12);
    }

    function drawBall(ball) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#ff5a5a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius * 0.78, -0.8, 1.9);
      ctx.stroke();
    }

    function drawWaitingScreen(message) {
      ctx.fillStyle = "#d8efff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#16334b";
      ctx.textAlign = "center";
      ctx.font = "36px Pretendard, Noto Sans KR, sans-serif";
      ctx.fillText("2인 캐주얼 배구", canvas.width / 2, canvas.height / 2 - 18);
      ctx.font = "18px Pretendard, Noto Sans KR, sans-serif";
      ctx.fillText(message || "세션 연결 대기 중", canvas.width / 2, canvas.height / 2 + 20);
    }

    function init() {
      bindHandlers();
      onHideResult();
      onPhase("연결중");
      onStatus("서버 세션 연결 중...");

      if (!sessionId) {
        startDemo("세션 정보가 없어 demo fallback으로 시작합니다.");
        return;
      }

      socket.emit("volley_join_session", {
        session_id: sessionId,
        nickname: profile.nickname,
      });
    }

    function update(dt) {
      if (mode === "network") {
        if (phase === "playing") {
          inputSendAccum += dt;
          if (inputSendAccum >= 1 / 30) {
            inputSendAccum = 0;
            sendInputIfNeeded(false);
          }
        }

        if (phase === "connecting" && Date.now() - connectedAt > 9000) {
          startDemo("상대 연결 지연으로 demo fallback 전환");
        }
      } else {
        updateDemo(dt);
      }
    }

    function render() {
      if (!state) {
        const message = phase === "waiting" ? "상대 접속 대기 중" : "세션 연결 중";
        drawWaitingScreen(message);
        return;
      }

      drawCourt(state);
      drawScoreboard(state);
      drawPlayer("left", state.players.left);
      drawPlayer("right", state.players.right);
      drawBall(state.ball);
      drawCountdownOverlay(state);
    }

    function onKeyDown(event) {
      if (phase !== "playing") {
        return;
      }

      if (event.key === "ArrowLeft") {
        inputState.left = true;
        event.preventDefault();
      } else if (event.key === "ArrowRight") {
        inputState.right = true;
        event.preventDefault();
      } else if (event.key === "ArrowUp" || event.key === " " || event.code === "Space") {
        inputState.jump = true;
        event.preventDefault();
      }
    }

    function onKeyUp(event) {
      if (event.key === "ArrowLeft") {
        inputState.left = false;
      } else if (event.key === "ArrowRight") {
        inputState.right = false;
      } else if (event.key === "ArrowUp" || event.key === " " || event.code === "Space") {
        inputState.jump = false;
      }
    }

    function requestRematch() {
      if (phase !== "finished") {
        return;
      }

      if (mode === "network") {
        onStatus("재대결은 아직 미지원입니다.");
      } else {
        startDemo("데모 재대결 시작");
      }
    }

    function leaveToLobby() {
      // Server session cleanup is handled by disconnect for now.
    }

    function teardown() {
      leaveToLobby();
      unbindHandlers();
    }

    function renderGameToText() {
      return JSON.stringify({
        mode: mode === "network" ? "volleyball-network" : "volleyball-demo",
        phase,
        session_id: sessionId,
        side: mySide,
        state,
      });
    }

    return {
      init,
      update,
      render,
      teardown,
      onKeyDown,
      onKeyUp,
      requestRematch,
      leaveToLobby,
      renderGameToText,
    };
  }

  window.createVolleyballRuntime = createVolleyballRuntime;
})();
