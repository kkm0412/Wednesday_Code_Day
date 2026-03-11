import os
import threading
import time
from typing import Dict, Any

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

WORLD = {
    "width": 2600,
    "height": 1300,
    "spawn": {"x": 1300, "y": 500},
}

players: Dict[str, Dict[str, Any]] = {}
state_lock = threading.Lock()
broadcast_task = None


def clamp_or_recenter(player: Dict[str, Any]) -> None:
    # Hard fallback: if state gets corrupted or escapes bounds, move back to lobby center.
    if (
        player["x"] < -220
        or player["x"] > WORLD["width"] + 220
        or player["y"] < -260
        or player["y"] > WORLD["height"] + 320
    ):
        player["x"] = WORLD["spawn"]["x"]
        player["y"] = WORLD["spawn"]["y"]
        player["vx"] = 0.0
        player["vy"] = 0.0


def safe_player_view(player: Dict[str, Any], now_ts: float) -> Dict[str, Any]:
    bubble = player["bubble"] if player["bubble_until"] > now_ts else ""
    bubble_until = player["bubble_until"] if bubble else 0.0
    return {
        "id": player["id"],
        "nickname": player["nickname"],
        "x": player["x"],
        "y": player["y"],
        "vx": player["vx"],
        "vy": player["vy"],
        "direction": player["direction"],
        "bubble": bubble,
        "bubble_until": bubble_until,
    }


def make_state_snapshot() -> Dict[str, Any]:
    now_ts = time.time()
    with state_lock:
        serialized = []
        for player in players.values():
            clamp_or_recenter(player)
            serialized.append(safe_player_view(player, now_ts))
    return {
        "timestamp": now_ts,
        "players": serialized,
    }


def run_broadcast_loop() -> None:
    while True:
        socketio.emit("state_snapshot", make_state_snapshot())
        socketio.sleep(0.05)


def ensure_broadcast_loop_started() -> None:
    global broadcast_task
    if broadcast_task is None:
        broadcast_task = socketio.start_background_task(run_broadcast_loop)


@app.route("/")
def index() -> str:
    return render_template("index.html")


@socketio.on("join_lobby")
def on_join_lobby(data: Dict[str, Any]) -> None:
    ensure_broadcast_loop_started()

    nickname = str((data or {}).get("nickname", "")).strip()
    if not nickname:
        nickname = "Guest"
    nickname = nickname[:16]

    sid = request.sid
    with state_lock:
        players[sid] = {
            "id": sid,
            "nickname": nickname,
            "x": float(WORLD["spawn"]["x"]),
            "y": float(WORLD["spawn"]["y"]),
            "vx": 0.0,
            "vy": 0.0,
            "direction": 1,
            "bubble": "",
            "bubble_until": 0.0,
            "friends": set(),
        }
    snapshot = make_state_snapshot()

    emit("joined", {"id": sid, "world": WORLD, "snapshot": snapshot})
    emit(
        "system_notice",
        {"message": f"{nickname} 님이 로비에 입장했습니다."},
        broadcast=True,
        include_self=False,
    )


@socketio.on("player_state")
def on_player_state(data: Dict[str, Any]) -> None:
    sid = request.sid
    payload = data or {}

    with state_lock:
        player = players.get(sid)
        if player is None:
            return

        player["x"] = float(payload.get("x", player["x"]))
        player["y"] = float(payload.get("y", player["y"]))
        player["vx"] = float(payload.get("vx", player["vx"]))
        player["vy"] = float(payload.get("vy", player["vy"]))
        direction = payload.get("direction", player["direction"])
        player["direction"] = -1 if float(direction) < 0 else 1

        clamp_or_recenter(player)


@socketio.on("public_chat")
def on_public_chat(data: Dict[str, Any]) -> None:
    sid = request.sid
    text = str((data or {}).get("text", "")).strip()
    if not text:
        return
    text = text[:120]

    now_ts = time.time()
    with state_lock:
        player = players.get(sid)
        if player is None:
            return

        player["bubble"] = text
        player["bubble_until"] = now_ts + 5.5

        payload = {
            "from_id": sid,
            "nickname": player["nickname"],
            "text": text,
            "x": player["x"],
            "y": player["y"],
            "timestamp": now_ts,
        }

    emit("public_chat", payload, broadcast=True)


@socketio.on("friend_request")
def on_friend_request(data: Dict[str, Any]) -> None:
    sid = request.sid
    target_id = str((data or {}).get("target_id", "")).strip()
    if not target_id or target_id == sid:
        return

    with state_lock:
        sender = players.get(sid)
        target = players.get(target_id)
        if sender is None or target is None:
            return

        sender["friends"].add(target_id)
        target["friends"].add(sid)

        sender_payload = {
            "friend_id": target_id,
            "friend_nickname": target["nickname"],
        }
        target_payload = {
            "friend_id": sid,
            "friend_nickname": sender["nickname"],
        }

    emit("friend_added", sender_payload, room=sid)
    emit("friend_added", target_payload, room=target_id)


@socketio.on("private_message")
def on_private_message(data: Dict[str, Any]) -> None:
    sid = request.sid
    payload = data or {}
    target_id = str(payload.get("target_id", "")).strip()
    text = str(payload.get("text", "")).strip()
    if not target_id or not text:
        return

    text = text[:300]
    now_ts = time.time()
    with state_lock:
        sender = players.get(sid)
        target = players.get(target_id)
        if sender is None or target is None:
            return

        outbound = {
            "from_id": sid,
            "from_nickname": sender["nickname"],
            "target_id": target_id,
            "target_nickname": target["nickname"],
            "text": text,
            "timestamp": now_ts,
        }

    emit("private_message", outbound, room=sid)
    emit("private_message", outbound, room=target_id)


@socketio.on("disconnect")
def on_disconnect() -> None:
    sid = request.sid
    with state_lock:
        leaving = players.pop(sid, None)

    if leaving is None:
        return

    emit("player_left", {"id": sid}, broadcast=True)
    emit(
        "system_notice",
        {"message": f"{leaving['nickname']} 님이 퇴장했습니다."},
        broadcast=True,
    )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    socketio.run(app, host="0.0.0.0", port=port)
