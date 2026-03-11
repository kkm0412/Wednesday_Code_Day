import os
import threading
import time
import uuid
import math
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, redirect, render_template, request
from flask_socketio import SocketIO, emit

try:
    from pymongo import MongoClient
    from pymongo.collection import ReturnDocument
    from pymongo.errors import DuplicateKeyError, PyMongoError
except Exception:  # pragma: no cover - optional in local envs without pymongo
    MongoClient = None
    ReturnDocument = None
    DuplicateKeyError = Exception
    PyMongoError = Exception


class PlayerRepository:
    def __init__(self) -> None:
        self.enabled = False
        self._local_profiles: Dict[str, Dict[str, Any]] = {}
        self._local_lock = threading.Lock()
        self.collection = None

        mongo_uri = os.getenv("MONGODB_URI", "").strip()
        db_name = os.getenv("MONGODB_DB", "meta_world")
        collection_name = os.getenv("MONGODB_COLLECTION", "players")

        if not mongo_uri or MongoClient is None:
            print("[PlayerRepository] MongoDB disabled; using in-memory fallback.")
            return

        try:
            client = MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
            client.admin.command("ping")
            self.collection = client[db_name][collection_name]
            self.collection.create_index("nickname", unique=True)
            self.enabled = True
            print("[PlayerRepository] MongoDB connected.")
        except Exception as exc:  # pragma: no cover - connection runtime issue
            print(f"[PlayerRepository] MongoDB connection failed ({exc}); fallback enabled.")
            self.enabled = False

    @staticmethod
    def _normalize_profile(raw: Dict[str, Any]) -> Dict[str, Any]:
        identity = str(raw.get("id") or raw.get("_id") or "")
        return {
            "id": identity,
            "_id": str(raw.get("_id", "")),
            "nickname": str(raw.get("nickname", "Guest")),
            "hp": int(raw.get("hp", 100)),
            "coin": int(raw.get("coin", 0)),
        }

    def get_or_create(self, nickname: str) -> Dict[str, Any]:
        if self.enabled and self.collection is not None:
            doc = self.collection.find_one({"nickname": nickname})
            if doc is None:
                candidate = {
                    "id": f"player-{uuid.uuid4().hex[:12]}",
                    "nickname": nickname,
                    "hp": 100,
                    "coin": 10,
                    "created_at": time.time(),
                    "updated_at": time.time(),
                }
                try:
                    inserted = self.collection.insert_one(candidate)
                    candidate["_id"] = inserted.inserted_id
                    doc = candidate
                except DuplicateKeyError:
                    doc = self.collection.find_one({"nickname": nickname})
                except PyMongoError:
                    doc = None

            if doc is not None and not doc.get("id"):
                generated_id = f"player-{uuid.uuid4().hex[:12]}"
                try:
                    self.collection.update_one(
                        {"_id": doc["_id"]},
                        {"$set": {"id": generated_id, "updated_at": time.time()}},
                    )
                    doc["id"] = generated_id
                except PyMongoError:
                    doc["id"] = generated_id

            if doc is not None:
                return self._normalize_profile(doc)

        key = nickname.lower()
        if key not in self._local_profiles:
            self._local_profiles[key] = {
                "id": f"player-{uuid.uuid4().hex[:12]}",
                "_id": f"local-{uuid.uuid4().hex[:10]}",
                "nickname": nickname,
                "hp": 100,
                "coin": 10,
            }
        return dict(self._local_profiles[key])

    def try_lock_entry_fee(self, nickname: str, fee: int) -> Dict[str, Any]:
        fee = max(0, int(fee))
        if fee == 0:
            profile = self.get_or_create(nickname)
            return {"ok": True, "profile": profile}

        if self.enabled and self.collection is not None:
            try:
                doc = self.collection.find_one_and_update(
                    {"nickname": nickname, "coin": {"$gte": fee}},
                    {"$inc": {"coin": -fee}, "$set": {"updated_at": time.time()}},
                    return_document=ReturnDocument.AFTER,
                )
            except PyMongoError:
                doc = None
            if doc is None:
                return {"ok": False, "error": "insufficient_coin"}
            return {"ok": True, "profile": self._normalize_profile(doc)}

        key = nickname.lower()
        with self._local_lock:
            profile = self._local_profiles.get(key)
            if profile is None:
                profile = {
                    "id": f"player-{uuid.uuid4().hex[:12]}",
                    "_id": f"local-{uuid.uuid4().hex[:10]}",
                    "nickname": nickname,
                    "hp": 100,
                    "coin": 10,
                }
                self._local_profiles[key] = profile
            if int(profile.get("coin", 0)) < fee:
                return {"ok": False, "error": "insufficient_coin"}
            profile["coin"] = int(profile.get("coin", 0)) - fee
            return {"ok": True, "profile": dict(profile)}

    def add_coin(self, nickname: str, amount: int) -> Dict[str, Any]:
        amount = int(amount)
        if amount == 0:
            return {"ok": True, "profile": self.get_or_create(nickname)}

        if self.enabled and self.collection is not None:
            try:
                doc = self.collection.find_one_and_update(
                    {"nickname": nickname},
                    {"$inc": {"coin": amount}, "$set": {"updated_at": time.time()}},
                    return_document=ReturnDocument.AFTER,
                )
            except PyMongoError:
                doc = None
            if doc is None:
                return {"ok": False, "error": "not_found"}
            return {"ok": True, "profile": self._normalize_profile(doc)}

        key = nickname.lower()
        with self._local_lock:
            profile = self._local_profiles.get(key)
            if profile is None:
                profile = {
                    "id": f"player-{uuid.uuid4().hex[:12]}",
                    "_id": f"local-{uuid.uuid4().hex[:10]}",
                    "nickname": nickname,
                    "hp": 100,
                    "coin": 10,
                }
                self._local_profiles[key] = profile
            profile["coin"] = max(0, int(profile.get("coin", 0)) + amount)
            return {"ok": True, "profile": dict(profile)}

    def update_profile(
        self,
        nickname: str,
        hp: Optional[int] = None,
        coin: Optional[int] = None,
    ) -> Dict[str, Any]:
        updates: Dict[str, Any] = {}
        if hp is not None:
            updates["hp"] = max(0, int(hp))
        if coin is not None:
            updates["coin"] = max(0, int(coin))

        if not updates:
            return {"ok": True, "profile": self.get_or_create(nickname)}

        if self.enabled and self.collection is not None:
            try:
                doc = self.collection.find_one_and_update(
                    {"nickname": nickname},
                    {"$set": {**updates, "updated_at": time.time()}},
                    return_document=ReturnDocument.AFTER,
                )
            except PyMongoError:
                doc = None
            if doc is None:
                # Ensure profile exists first, then retry update.
                self.get_or_create(nickname)
                try:
                    doc = self.collection.find_one_and_update(
                        {"nickname": nickname},
                        {"$set": {**updates, "updated_at": time.time()}},
                        return_document=ReturnDocument.AFTER,
                    )
                except PyMongoError:
                    doc = None
            if doc is None:
                return {"ok": False, "error": "update_failed"}
            return {"ok": True, "profile": self._normalize_profile(doc)}

        key = nickname.lower()
        with self._local_lock:
            profile = self._local_profiles.get(key)
            if profile is None:
                profile = {
                    "id": f"player-{uuid.uuid4().hex[:12]}",
                    "_id": f"local-{uuid.uuid4().hex[:10]}",
                    "nickname": nickname,
                    "hp": 100,
                    "coin": 10,
                }
                self._local_profiles[key] = profile
            for update_key, value in updates.items():
                profile[update_key] = int(value)
            return {"ok": True, "profile": dict(profile)}


class DungeonMonsterRepository:
    def __init__(self) -> None:
        self.enabled = False
        self._local_monsters: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self.collection = None

        mongo_uri = os.getenv("MONGODB_URI", "").strip()
        db_name = os.getenv("MONGODB_DB", "meta_world")
        collection_name = os.getenv("MONGODB_DUNGEON_COLLECTION", "dungeon_monsters")

        if not mongo_uri or MongoClient is None:
            print("[DungeonMonsterRepository] MongoDB disabled; using in-memory fallback.")
            return

        try:
            client = MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
            client.admin.command("ping")
            self.collection = client[db_name][collection_name]
            self.collection.create_index(
                [("dungeon_id", 1), ("monster_id", 1)],
                unique=True,
            )
            self.collection.create_index("dungeon_id")
            self.enabled = True
            print("[DungeonMonsterRepository] MongoDB connected.")
        except Exception as exc:  # pragma: no cover - connection runtime issue
            print(f"[DungeonMonsterRepository] MongoDB connection failed ({exc}); fallback enabled.")
            self.enabled = False

    @staticmethod
    def _normalize_monster(raw: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "dungeon_id": str(raw.get("dungeon_id", "default_dungeon")),
            "monster_id": str(raw.get("monster_id", "")),
            "template_id": str(raw.get("template_id", "unknown")),
            "name": str(raw.get("name", "Unknown Monster")),
            "theme": str(raw.get("theme", "cute_side_scroll")),
            "sprite_hint": str(raw.get("sprite_hint", "round")),
            "x": float(raw.get("x", 0)),
            "y": float(raw.get("y", 0)),
            "spawn_x": float(raw.get("spawn_x", raw.get("x", 0))),
            "spawn_y": float(raw.get("spawn_y", raw.get("y", 0))),
            "hp": int(raw.get("hp", 1)),
            "max_hp": int(raw.get("max_hp", raw.get("hp", 1))),
            "level": int(raw.get("level", 1)),
            "state": str(raw.get("state", "idle")),
            "is_boss": bool(raw.get("is_boss", False)),
            "move_range": float(raw.get("move_range", 90)),
            "respawn_delay": float(raw.get("respawn_delay", 8.0)),
            "created_at": float(raw.get("created_at", time.time())),
            "updated_at": float(raw.get("updated_at", time.time())),
            "last_seen_at": float(raw.get("last_seen_at", time.time())),
        }

    def list_by_dungeon(self, dungeon_id: str) -> List[Dict[str, Any]]:
        if self.enabled and self.collection is not None:
            docs = list(self.collection.find({"dungeon_id": dungeon_id}).sort("monster_id", 1))
            if docs:
                return [self._normalize_monster(doc) for doc in docs]

        local_bucket = self._local_monsters.get(dungeon_id, {})
        return [dict(local_bucket[key]) for key in sorted(local_bucket.keys())]

    def seed_dungeon(self, dungeon_id: str, seeds: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        existing = self.list_by_dungeon(dungeon_id)
        if existing:
            return existing

        now_ts = time.time()
        docs = []
        for seed in seeds:
            docs.append(
                {
                    "dungeon_id": dungeon_id,
                    "monster_id": str(seed["monster_id"]),
                    "template_id": str(seed["template_id"]),
                    "name": str(seed["name"]),
                    "theme": str(seed.get("theme", "cute_side_scroll")),
                    "sprite_hint": str(seed.get("sprite_hint", "round")),
                    "x": float(seed["x"]),
                    "y": float(seed["y"]),
                    "spawn_x": float(seed.get("spawn_x", seed["x"])),
                    "spawn_y": float(seed.get("spawn_y", seed["y"])),
                    "hp": int(seed["hp"]),
                    "max_hp": int(seed.get("max_hp", seed["hp"])),
                    "level": int(seed.get("level", 1)),
                    "state": str(seed.get("state", "idle")),
                    "is_boss": bool(seed.get("is_boss", False)),
                    "move_range": float(seed.get("move_range", 90)),
                    "respawn_delay": float(seed.get("respawn_delay", 8.0)),
                    "created_at": now_ts,
                    "updated_at": now_ts,
                    "last_seen_at": now_ts,
                }
            )

        if self.enabled and self.collection is not None:
            try:
                self.collection.insert_many(docs, ordered=False)
            except PyMongoError:
                pass
            return self.list_by_dungeon(dungeon_id)

        bucket = self._local_monsters.setdefault(dungeon_id, {})
        for doc in docs:
            bucket[doc["monster_id"]] = dict(doc)
        return self.list_by_dungeon(dungeon_id)

    def touch_dungeon(self, dungeon_id: str) -> None:
        now_ts = time.time()
        if self.enabled and self.collection is not None:
            try:
                self.collection.update_many(
                    {"dungeon_id": dungeon_id},
                    {"$set": {"last_seen_at": now_ts}},
                )
            except PyMongoError:
                pass
            return

        if dungeon_id not in self._local_monsters:
            return

        for monster in self._local_monsters[dungeon_id].values():
            monster["last_seen_at"] = now_ts


app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")
player_repository = PlayerRepository()
dungeon_repository = DungeonMonsterRepository()

WORLD = {
    "width": 2800,
    "height": 1400,
    "spawn": {"x": 1400, "y": 540},
    "portal": {
        "x": 1325,
        "y": 1180,
        "w": 150,
        "h": 140,
        "target": "/dungeon",
    },
}

DUNGEON_WORLD = {
    "width": 2800,
    "height": 1400,
    "spawn": {"x": 420, "y": 520},
    "id": "default_dungeon",
}

DUNGEON_MONSTER_SEEDS: Dict[str, List[Dict[str, Any]]] = {
    "default_dungeon": [
        {
            "monster_id": "mint-slime-001",
            "template_id": "mint_slime",
            "name": "Mint Slime",
            "theme": "cute_forest",
            "sprite_hint": "slime",
            "x": 560,
            "y": 1320,
            "hp": 36,
            "max_hp": 36,
            "level": 1,
            "move_range": 88,
        },
        {
            "monster_id": "pom-mushroom-001",
            "template_id": "pom_mushroom",
            "name": "Pom Mushroom",
            "theme": "cute_forest",
            "sprite_hint": "mushroom",
            "x": 1010,
            "y": 1320,
            "hp": 45,
            "max_hp": 45,
            "level": 2,
            "move_range": 74,
        },
        {
            "monster_id": "cloud-pupu-001",
            "template_id": "cloud_pupu",
            "name": "Cloud Pupu",
            "theme": "dreamy_cloud",
            "sprite_hint": "puff",
            "x": 1500,
            "y": 940,
            "hp": 52,
            "max_hp": 52,
            "level": 3,
            "move_range": 110,
        },
        {
            "monster_id": "honey-sprout-001",
            "template_id": "honey_sprout",
            "name": "Honey Sprout",
            "theme": "flower_garden",
            "sprite_hint": "sprout",
            "x": 1880,
            "y": 1320,
            "hp": 58,
            "max_hp": 58,
            "level": 3,
            "move_range": 96,
        },
        {
            "monster_id": "acorn-bat-001",
            "template_id": "acorn_bat",
            "name": "Acorn Bat",
            "theme": "twilight_cute",
            "sprite_hint": "bat",
            "x": 2320,
            "y": 900,
            "hp": 72,
            "max_hp": 72,
            "level": 4,
            "move_range": 132,
        },
    ]
}

players: Dict[str, Dict[str, Any]] = {}
state_lock = threading.Lock()
broadcast_task = None
pending_minigame_invites: Dict[str, Dict[str, Any]] = {}
minigame_sessions: Dict[str, Dict[str, Any]] = {}
volley_connections: Dict[str, Dict[str, str]] = {}

VOLLEY_ENTRY_FEE = 10
VOLLEY_WIN_SCORE = 5
VOLLEY_POT = VOLLEY_ENTRY_FEE * 2
VOLLEY_FIELD = {
    "width": 2200.0,
    "height": 1200.0,
    "floor_y": 1100.0,
    "racket_x": 1100.0,
    "racket_w": 40.0,
    "racket_h": 280.0,
}
VOLLEY_MOVE = {
    "gravity": 1920.0,
    "move_accel": 10800.0,
    "max_run_speed": 790.0,
    "ground_friction": 13.0,
    "air_friction": 2.35,
    "jump_impulse": -830.0,
    "jump_hold_force": 2100.0,
    "jump_hold_time": 0.18,
    "jump_cut_multiplier": 0.48,
}
VOLLEY_BALL = {
    "radius": 52.0,
    "gravity": 1700.0,
    "restitution": 0.91,
    "max_speed": 1180.0,
    "min_bounce_vy": 250.0,
}
volley_task = None


def clamp_or_recenter(player: Dict[str, Any]) -> None:
    if (
        player["x"] < -260
        or player["x"] > WORLD["width"] + 260
        or player["y"] < -280
        or player["y"] > WORLD["height"] + 360
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
        "hp": player["hp"],
        "max_hp": max(100, int(player["hp"])),
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


def sanitize_nickname(raw_name: Any) -> str:
    nickname = str(raw_name or "").strip()
    if not nickname:
        nickname = "Guest"
    return nickname[:16]


def sanitize_dungeon_id(raw_dungeon_id: Any) -> str:
    candidate = str(raw_dungeon_id or "").strip().lower()
    if not candidate:
        return "default_dungeon"

    sanitized = "".join(ch for ch in candidate if ch.isalnum() or ch in {"_", "-"})
    return sanitized[:40] or "default_dungeon"


def find_player(sid: str) -> Optional[Dict[str, Any]]:
    return players.get(sid)


def dungeon_seed_for(dungeon_id: str) -> List[Dict[str, Any]]:
    return DUNGEON_MONSTER_SEEDS.get(dungeon_id, DUNGEON_MONSTER_SEEDS["default_dungeon"])


def safe_monster_view(monster: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "monster_id": monster["monster_id"],
        "template_id": monster["template_id"],
        "name": monster["name"],
        "theme": monster["theme"],
        "sprite_hint": monster["sprite_hint"],
        "x": monster["x"],
        "y": monster["y"],
        "spawn_x": monster["spawn_x"],
        "spawn_y": monster["spawn_y"],
        "hp": monster["hp"],
        "max_hp": monster["max_hp"],
        "level": monster["level"],
        "state": monster["state"],
        "is_boss": monster["is_boss"],
        "move_range": monster["move_range"],
        "respawn_delay": monster["respawn_delay"],
        "updated_at": monster["updated_at"],
        "last_seen_at": monster["last_seen_at"],
    }


def make_dungeon_snapshot(dungeon_id: str) -> Dict[str, Any]:
    monsters = dungeon_repository.list_by_dungeon(dungeon_id)
    return {
        "timestamp": time.time(),
        "dungeon_id": dungeon_id,
        "monsters": [safe_monster_view(monster) for monster in monsters],
    }


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def create_volley_player(side: str, nickname: str) -> Dict[str, Any]:
    hw = 52.0
    hh = 68.0
    spawn_x = 620.0 if side == "left" else 1580.0
    return {
        "nickname": nickname,
        "side": side,
        "x": spawn_x,
        "y": VOLLEY_FIELD["floor_y"] - hh,
        "vx": 0.0,
        "vy": 0.0,
        "width": hw * 2,
        "height": hh * 2,
        "on_ground": True,
        "jump_holding": False,
        "jump_hold_timer": 0.0,
        "input": {"left": False, "right": False, "jump": False, "jump_prev": False},
    }


def _player_bounds(side: str, hw: float) -> Dict[str, float]:
    if side == "left":
        max_x = VOLLEY_FIELD["racket_x"] - (VOLLEY_FIELD["racket_w"] * 0.5) - hw - 8.0
        return {"min_x": hw + 8.0, "max_x": max_x}
    min_x = VOLLEY_FIELD["racket_x"] + (VOLLEY_FIELD["racket_w"] * 0.5) + hw + 8.0
    return {"min_x": min_x, "max_x": VOLLEY_FIELD["width"] - hw - 8.0}


def _rect_from_player(player: Dict[str, Any]) -> Dict[str, float]:
    hw = player["width"] * 0.5
    hh = player["height"] * 0.5
    return {
        "left": player["x"] - hw,
        "right": player["x"] + hw,
        "top": player["y"] - hh,
        "bottom": player["y"] + hh,
        "hw": hw,
        "hh": hh,
    }


def simulate_volley_player(player: Dict[str, Any], dt: float) -> None:
    input_state = player["input"]
    left_pressed = bool(input_state.get("left", False))
    right_pressed = bool(input_state.get("right", False))
    jump_pressed = bool(input_state.get("jump", False))
    jump_prev = bool(input_state.get("jump_prev", False))

    intent = (1 if right_pressed else 0) - (1 if left_pressed else 0)
    player["vx"] += intent * VOLLEY_MOVE["move_accel"] * dt

    if intent == 0:
        friction = VOLLEY_MOVE["ground_friction"] if player["on_ground"] else VOLLEY_MOVE["air_friction"]
        player["vx"] *= max(0.0, 1.0 - friction * dt)
        if abs(player["vx"]) < 2.5:
            player["vx"] = 0.0

    player["vx"] = _clamp(player["vx"], -VOLLEY_MOVE["max_run_speed"], VOLLEY_MOVE["max_run_speed"])

    jump_started = jump_pressed and not jump_prev
    jump_released = (not jump_pressed) and jump_prev
    if jump_started and player["on_ground"]:
        player["vy"] = VOLLEY_MOVE["jump_impulse"]
        player["on_ground"] = False
        player["jump_holding"] = True
        player["jump_hold_timer"] = 0.0

    if player["jump_holding"] and jump_pressed and player["jump_hold_timer"] < VOLLEY_MOVE["jump_hold_time"] and player["vy"] < 0:
        player["vy"] -= VOLLEY_MOVE["jump_hold_force"] * dt
        player["jump_hold_timer"] += dt
    elif player["jump_holding"]:
        player["jump_holding"] = False

    if jump_released and player["vy"] < 0:
        player["vy"] *= VOLLEY_MOVE["jump_cut_multiplier"]
        player["jump_holding"] = False

    player["vy"] += VOLLEY_MOVE["gravity"] * dt
    player["vy"] = _clamp(player["vy"], -1200.0, 1500.0)

    player["x"] += player["vx"] * dt
    rect = _rect_from_player(player)
    bounds = _player_bounds(player["side"], rect["hw"])
    player["x"] = _clamp(player["x"], bounds["min_x"], bounds["max_x"])

    player["y"] += player["vy"] * dt
    rect = _rect_from_player(player)
    floor_y = VOLLEY_FIELD["floor_y"] - rect["hh"]
    ceiling_y = rect["hh"] + 4.0

    player["on_ground"] = False
    if player["y"] >= floor_y:
        player["y"] = floor_y
        player["vy"] = 0.0
        player["on_ground"] = True
        player["jump_holding"] = False
    elif player["y"] <= ceiling_y:
        player["y"] = ceiling_y
        if player["vy"] < 0:
            player["vy"] = 0.0

    player["input"]["jump_prev"] = jump_pressed


def _circle_rect_collision(cx: float, cy: float, radius: float, rect: Dict[str, float]) -> Dict[str, float]:
    nearest_x = _clamp(cx, rect["left"], rect["right"])
    nearest_y = _clamp(cy, rect["top"], rect["bottom"])
    dx = cx - nearest_x
    dy = cy - nearest_y
    dist_sq = dx * dx + dy * dy
    if dist_sq >= radius * radius:
        return {"hit": 0.0}

    dist = math.sqrt(dist_sq) if dist_sq > 1e-6 else 0.0
    if dist == 0.0:
        if abs(dx) >= abs(dy):
            nx = 1.0 if cx > (rect["left"] + rect["right"]) * 0.5 else -1.0
            ny = 0.0
        else:
            nx = 0.0
            ny = 1.0 if cy > (rect["top"] + rect["bottom"]) * 0.5 else -1.0
        penetration = radius
    else:
        nx = dx / dist
        ny = dy / dist
        penetration = radius - dist
    return {"hit": 1.0, "nx": nx, "ny": ny, "penetration": penetration}


def _circle_circle_collision(
    ax: float,
    ay: float,
    ar: float,
    bx: float,
    by: float,
    br: float,
) -> Dict[str, float]:
    dx = ax - bx
    dy = ay - by
    rs = ar + br
    dist_sq = dx * dx + dy * dy
    if dist_sq >= rs * rs:
        return {"hit": 0.0}
    dist = math.sqrt(dist_sq) if dist_sq > 1e-6 else 0.0
    if dist == 0.0:
        nx = 0.0
        ny = -1.0
        penetration = rs
    else:
        nx = dx / dist
        ny = dy / dist
        penetration = rs - dist
    return {"hit": 1.0, "nx": nx, "ny": ny, "penetration": penetration}


def _ball_player_collision(ball: Dict[str, Any], player: Dict[str, Any]) -> Dict[str, float]:
    prect = _rect_from_player(player)
    body_top = prect["top"] + prect["hh"] * 0.22
    body_rect = {
        "left": prect["left"] + prect["hw"] * 0.16,
        "right": prect["right"] - prect["hw"] * 0.16,
        "top": body_top,
        "bottom": prect["bottom"],
    }
    head_r = prect["hw"]
    head_cx = player["x"]
    head_cy = prect["top"] + head_r + 2.0

    candidates = [
        _circle_rect_collision(ball["x"], ball["y"], ball["r"], body_rect),
        _circle_circle_collision(ball["x"], ball["y"], ball["r"], head_cx, head_cy, head_r),
    ]
    best = {"hit": 0.0}
    for hit in candidates:
        if not hit.get("hit"):
            continue
        if not best.get("hit") or float(hit["penetration"]) > float(best.get("penetration", 0.0)):
            best = hit
    return best


def _cap_ball_speed(ball: Dict[str, Any]) -> None:
    speed = math.hypot(ball["vx"], ball["vy"])
    max_speed = VOLLEY_BALL["max_speed"]
    if speed > max_speed and speed > 0:
        scale = max_speed / speed
        ball["vx"] *= scale
        ball["vy"] *= scale


def reset_volley_round(
    session: Dict[str, Any],
    conceding_side: Optional[str] = None,
    launch_immediately: bool = True,
) -> None:
    center_x = VOLLEY_FIELD["width"] * 0.5
    spawn_x = center_x
    if conceding_side == "left":
        spawn_x = center_x - 180.0
    elif conceding_side == "right":
        spawn_x = center_x + 180.0
    serve_dir = 1.0 if spawn_x <= center_x else -1.0
    serve_vx = 340.0 * serve_dir
    serve_vy = -520.0
    session["ball"] = {
        "x": spawn_x,
        "y": 380.0,
        "vx": serve_vx if launch_immediately else 0.0,
        "vy": serve_vy if launch_immediately else 0.0,
        "r": VOLLEY_BALL["radius"],
    }
    session["pending_serve"] = None if launch_immediately else {"vx": serve_vx, "vy": serve_vy}
    session["players_state"]["left"] = create_volley_player("left", session["nick_by_side"]["left"])
    session["players_state"]["right"] = create_volley_player("right", session["nick_by_side"]["right"])


def _finish_volley_match(session: Dict[str, Any], winner_side: str, reason: str) -> None:
    if session.get("settled", False):
        return
    winner_nickname = session["nick_by_side"][winner_side]
    coin_result = player_repository.add_coin(winner_nickname, VOLLEY_POT)
    winner_coin = None
    if coin_result.get("ok"):
        winner_coin = int(coin_result["profile"].get("coin", 0))

    session["status"] = "finished"
    session["settled"] = True
    session["winner_side"] = winner_side
    session["winner_nickname"] = winner_nickname
    session["match_end_payload"] = {
        "session_id": session["session_id"],
        "winner_side": winner_side,
        "winner_nickname": winner_nickname,
        "scores": dict(session["scores"]),
        "entry_fee": VOLLEY_ENTRY_FEE,
        "pot": VOLLEY_POT,
        "reason": reason,
        "winner_coin": winner_coin,
    }


def simulate_volley_session(session: Dict[str, Any], dt: float) -> None:
    if session["status"] not in {"countdown", "playing"}:
        return

    for side in ("left", "right"):
        simulate_volley_player(session["players_state"][side], dt)

    if session["status"] == "countdown":
        remain = float(session.get("countdown_until", 0.0)) - time.time()
        if remain <= 0.0:
            session["status"] = "playing"
            session["countdown_remaining"] = 0
            pending = session.get("pending_serve")
            if pending:
                session["ball"]["vx"] = float(pending.get("vx", 0.0))
                session["ball"]["vy"] = float(pending.get("vy", 0.0))
                session["pending_serve"] = None
        else:
            session["countdown_remaining"] = max(1, int(math.ceil(remain)))
        return

    ball = session["ball"]
    ball["vy"] += VOLLEY_BALL["gravity"] * dt
    ball["x"] += ball["vx"] * dt
    ball["y"] += ball["vy"] * dt
    r = ball["r"]
    restitution = VOLLEY_BALL["restitution"]

    if ball["x"] - r <= 0:
        ball["x"] = r
        ball["vx"] = abs(ball["vx"]) * restitution
    elif ball["x"] + r >= VOLLEY_FIELD["width"]:
        ball["x"] = VOLLEY_FIELD["width"] - r
        ball["vx"] = -abs(ball["vx"]) * restitution

    if ball["y"] - r <= 0:
        ball["y"] = r
        ball["vy"] = abs(ball["vy"]) * restitution

    racket_rect = {
        "left": VOLLEY_FIELD["racket_x"] - (VOLLEY_FIELD["racket_w"] * 0.5),
        "right": VOLLEY_FIELD["racket_x"] + (VOLLEY_FIELD["racket_w"] * 0.5),
        "top": VOLLEY_FIELD["floor_y"] - VOLLEY_FIELD["racket_h"],
        "bottom": VOLLEY_FIELD["floor_y"],
    }
    racket_hit = _circle_rect_collision(ball["x"], ball["y"], r, racket_rect)
    if racket_hit.get("hit"):
        ball["x"] += racket_hit["nx"] * racket_hit["penetration"]
        ball["y"] += racket_hit["ny"] * racket_hit["penetration"]
        vn = ball["vx"] * racket_hit["nx"] + ball["vy"] * racket_hit["ny"]
        if vn < 0:
            impulse = -(1.0 + restitution) * vn
            ball["vx"] += impulse * racket_hit["nx"]
            ball["vy"] += impulse * racket_hit["ny"]

    for side in ("left", "right"):
        player = session["players_state"][side]
        hit = _ball_player_collision(ball, player)
        if not hit.get("hit"):
            continue
        ball["x"] += hit["nx"] * hit["penetration"]
        ball["y"] += hit["ny"] * hit["penetration"]
        rel_vx = ball["vx"] - player["vx"]
        rel_vy = ball["vy"] - player["vy"]
        vn = rel_vx * hit["nx"] + rel_vy * hit["ny"]
        if vn < 0:
            impulse = -(1.0 + restitution) * vn
            ball["vx"] += impulse * hit["nx"] + player["vx"] * 0.22
            ball["vy"] += impulse * hit["ny"] + player["vy"] * 0.08

    if abs(ball["vy"]) < VOLLEY_BALL["min_bounce_vy"] and ball["vy"] > 0:
        ball["vy"] = VOLLEY_BALL["min_bounce_vy"]
    _cap_ball_speed(ball)

    if ball["y"] + r >= VOLLEY_FIELD["floor_y"]:
        scorer = "right" if ball["x"] < VOLLEY_FIELD["racket_x"] else "left"
        conceder = "left" if scorer == "right" else "right"
        session["scores"][scorer] += 1
        if session["scores"][scorer] >= VOLLEY_WIN_SCORE:
            _finish_volley_match(session, scorer, "score_limit")
            return
        reset_volley_round(session, conceding_side=conceder)


def build_volley_state_payload(session: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "session_id": session["session_id"],
        "status": session["status"],
        "countdown_remaining": int(session.get("countdown_remaining", 0)),
        "countdown_seconds": int(session.get("countdown_seconds", 0)),
        "scores": dict(session["scores"]),
        "target_score": VOLLEY_WIN_SCORE,
        "field": VOLLEY_FIELD,
        "players": {
            "left": {
                "nickname": session["players_state"]["left"]["nickname"],
                "x": session["players_state"]["left"]["x"],
                "y": session["players_state"]["left"]["y"],
                "vx": session["players_state"]["left"]["vx"],
                "vy": session["players_state"]["left"]["vy"],
                "w": session["players_state"]["left"]["width"],
                "h": session["players_state"]["left"]["height"],
            },
            "right": {
                "nickname": session["players_state"]["right"]["nickname"],
                "x": session["players_state"]["right"]["x"],
                "y": session["players_state"]["right"]["y"],
                "vx": session["players_state"]["right"]["vx"],
                "vy": session["players_state"]["right"]["vy"],
                "w": session["players_state"]["right"]["width"],
                "h": session["players_state"]["right"]["height"],
            },
        },
        "ball": dict(session["ball"]),
    }


def run_volley_loop() -> None:
    while True:
        emit_queue = []
        with state_lock:
            for session in minigame_sessions.values():
                if session.get("type") != "volley":
                    continue

                if session["status"] in {"countdown", "playing"}:
                    simulate_volley_session(session, 1.0 / 60.0)
                    emit_queue.append(("volley_state", build_volley_state_payload(session), session["session_id"]))

                if session.get("match_end_payload") and not session.get("end_emitted"):
                    emit_queue.append(("volley_match_end", dict(session["match_end_payload"]), session["session_id"]))
                    session["end_emitted"] = True
        for event_name, payload, room in emit_queue:
            socketio.emit(event_name, payload, room=room)
        socketio.sleep(1.0 / 60.0)


def ensure_volley_loop_started() -> None:
    global volley_task
    if volley_task is None:
        volley_task = socketio.start_background_task(run_volley_loop)
@app.route("/")
def lobby() -> str:
    return render_template("lobby.html")


@app.route("/dungeon")
def dungeon() -> str:
    return render_template("dungeon.html")


@app.route("/game")
def game() -> str:
    return redirect("/game/volley")


@app.route("/game/volley")
def game_volley() -> str:
    return render_template("game.html")


@app.route("/dev/grant_coin", methods=["POST"])
def dev_grant_coin() -> Any:
    payload = request.get_json(silent=True) or request.form or {}
    nickname_raw = str(payload.get("nickname", "")).strip()
    amount_raw = payload.get("amount", 0)
    try:
        amount = int(amount_raw)
    except Exception:
        amount = 0

    updated = []
    with state_lock:
        target_nicknames = []
        if nickname_raw:
            target_nicknames = [sanitize_nickname(nickname_raw)]
        else:
            target_nicknames = sorted({str(p.get("nickname", "")).strip() for p in players.values() if p.get("nickname")})

        for nickname in target_nicknames:
            result = player_repository.add_coin(nickname, amount)
            if not result.get("ok"):
                continue
            profile = result["profile"]
            coin = int(profile.get("coin", 0))
            for sid, p in players.items():
                if p.get("nickname") == nickname:
                    p["coin"] = coin
                    emit("system_notice", {"message": f"[DEV] Coin granted: {nickname} +{amount}"}, room=sid)
            updated.append({"nickname": nickname, "coin": coin})

    return jsonify(
        {
            "ok": True,
            "amount": amount,
            "targets": updated,
            "count": len(updated),
            "note": "If no nickname is provided, coins are granted to all connected players.",
        }
    )


@socketio.on("join_dungeon")
def on_join_dungeon(data: Dict[str, Any]) -> None:
    nickname = sanitize_nickname((data or {}).get("nickname"))
    profile = player_repository.get_or_create(nickname)
    dungeon_id = sanitize_dungeon_id((data or {}).get("dungeon_id"))
    dungeon_repository.seed_dungeon(dungeon_id, dungeon_seed_for(dungeon_id))
    dungeon_repository.touch_dungeon(dungeon_id)

    emit(
        "dungeon_joined",
        {
            "dungeon_id": dungeon_id,
            "world": {**DUNGEON_WORLD, "id": dungeon_id},
            "snapshot": make_dungeon_snapshot(dungeon_id),
            "profile": {
                "id": profile["id"],
                "_id": profile["_id"],
                "nickname": profile["nickname"],
                "hp": int(profile["hp"]),
                "coin": int(profile["coin"]),
            },
            "keywords": {
                "spawn_manager": True,
                "wave_timer": "pending",
                "combat_authoritative_server": True,
                "damage_confirm": "pending",
                "death_respawn": "pending",
                "clear_fail_condition": "pending",
                "reward_confirm": "pending",
                "monster_persistence": "server",
            },
        },
    )


@socketio.on("sync_profile")
def on_sync_profile(data: Dict[str, Any]) -> Dict[str, Any]:
    payload = data or {}
    nickname = sanitize_nickname(payload.get("nickname"))
    hp_raw = payload.get("hp")
    coin_raw = payload.get("coin")

    hp_value = None
    if hp_raw is not None:
        try:
            hp_value = max(0, int(hp_raw))
        except Exception:
            hp_value = None

    coin_value = None
    if coin_raw is not None:
        try:
            coin_value = max(0, int(coin_raw))
        except Exception:
            coin_value = None

    result = player_repository.update_profile(
        nickname=nickname,
        hp=hp_value,
        coin=coin_value,
    )
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error", "sync_failed")}

    profile = result["profile"]
    sid = request.sid
    with state_lock:
        player = find_player(sid)
        if player is not None and player.get("nickname") == nickname:
            player["profile_id"] = profile["_id"]
            player["hp"] = int(profile["hp"])
            player["coin"] = int(profile["coin"])

    return {
        "ok": True,
        "profile": {
            "id": profile["id"],
            "_id": profile["_id"],
            "nickname": profile["nickname"],
            "hp": int(profile["hp"]),
            "coin": int(profile["coin"]),
        },
    }


@socketio.on("dungeon_return_lobby")
def on_dungeon_return_lobby(data: Dict[str, Any]) -> Dict[str, Any]:
    payload = data or {}
    nickname = sanitize_nickname(payload.get("nickname"))
    coin_raw = payload.get("coin")
    coin_value = None
    if coin_raw is not None:
        try:
            coin_value = max(0, int(coin_raw))
        except Exception:
            coin_value = None

    result = player_repository.update_profile(
        nickname=nickname,
        hp=100,
        coin=coin_value,
    )
    if not result.get("ok"):
        return {"ok": False, "error": result.get("error", "return_failed")}

    profile = result["profile"]
    with state_lock:
        for player in players.values():
            if player.get("nickname") != nickname:
                continue
            player["profile_id"] = profile["_id"]
            player["hp"] = int(profile["hp"])
            player["coin"] = int(profile["coin"])

    return {
        "ok": True,
        "profile": {
            "id": profile["id"],
            "_id": profile["_id"],
            "nickname": profile["nickname"],
            "hp": int(profile["hp"]),
            "coin": int(profile["coin"]),
        },
    }


@socketio.on("request_dungeon_snapshot")
def on_request_dungeon_snapshot(data: Dict[str, Any]) -> None:
    dungeon_id = sanitize_dungeon_id((data or {}).get("dungeon_id"))
    dungeon_repository.seed_dungeon(dungeon_id, dungeon_seed_for(dungeon_id))
    dungeon_repository.touch_dungeon(dungeon_id)
    emit("dungeon_snapshot", make_dungeon_snapshot(dungeon_id))


@socketio.on("dungeon_action_request")
def on_dungeon_action_request(data: Dict[str, Any]) -> None:
    payload = data or {}
    action_key = str(payload.get("action_key", "")).strip().upper()
    if action_key not in {"KEYZ", "KEYX", "KEYC"}:
        return

    emit(
        "dungeon_action_queued",
        {
            "dungeon_id": sanitize_dungeon_id(payload.get("dungeon_id")),
            "action_key": action_key,
            "status": "placeholder",
            "server_authoritative": True,
            "message": f"{action_key} was queued on the server combat hook.",
        },
    )


@socketio.on("join_lobby")
def on_join_lobby(data: Dict[str, Any]) -> None:
    ensure_broadcast_loop_started()

    nickname = sanitize_nickname((data or {}).get("nickname"))
    profile = player_repository.get_or_create(nickname)

    sid = request.sid
    with state_lock:
        players[sid] = {
            "id": sid,
            "profile_id": profile["_id"],
            "nickname": nickname,
            "hp": int(profile["hp"]),
            "coin": int(profile["coin"]),
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
    emit(
        "joined",
        {
            "id": sid,
            "world": WORLD,
            "snapshot": snapshot,
            "profile": {
                "id": profile["id"],
                "_id": profile["_id"],
                "nickname": nickname,
                "hp": int(profile["hp"]),
                "coin": int(profile["coin"]),
            },
        },
    )
    emit(
        "system_notice",
        {"message": f"{nickname} joined the lobby."},
        broadcast=True,
        include_self=False,
    )


@socketio.on("player_state")
def on_player_state(data: Dict[str, Any]) -> None:
    sid = request.sid
    payload = data or {}

    with state_lock:
        player = find_player(sid)
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
        player = find_player(sid)
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
        sender = find_player(sid)
        target = find_player(target_id)
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
        sender = find_player(sid)
        target = find_player(target_id)
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


@socketio.on("minigame_invite")
def on_minigame_invite(data: Dict[str, Any]) -> None:
    sid = request.sid
    target_id = str((data or {}).get("target_id", "")).strip()
    if not target_id or target_id == sid:
        return

    sender_nickname = ""
    with state_lock:
        sender = find_player(sid)
        if sender is None:
            return
        sender_nickname = sender["nickname"]

    sender_profile = player_repository.get_or_create(sender_nickname)
    if int(sender_profile.get("coin", 0)) < VOLLEY_ENTRY_FEE:
        emit(
            "system_notice",
            {"message": f"You need at least {VOLLEY_ENTRY_FEE} coins to invite a minigame."},
            room=sid,
        )
        return

    with state_lock:
        sender = find_player(sid)
        target = find_player(target_id)
        if sender is None or target is None:
            return
        target_nickname = target["nickname"]

    target_profile = player_repository.get_or_create(target_nickname)
    if int(target_profile.get("coin", 0)) < VOLLEY_ENTRY_FEE:
        emit(
            "system_notice",
            {"message": f"{target_nickname} has fewer than {VOLLEY_ENTRY_FEE} coins and cannot join now."},
            room=sid,
        )
        return

    with state_lock:
        sender = find_player(sid)
        target = find_player(target_id)
        if sender is None or target is None:
            return

        distance = ((sender["x"] - target["x"]) ** 2 + (sender["y"] - target["y"]) ** 2) ** 0.5
        if distance > 220:
            emit(
                "system_notice",
                {"message": "You can only invite nearby players to a minigame."},
                room=sid,
            )
            return

        pending_minigame_invites[target_id] = {
            "from_id": sid,
            "from_nickname": sender["nickname"],
            "created_at": time.time(),
        }

    emit(
        "minigame_invited",
        {
            "from_id": sid,
            "from_nickname": sender["nickname"],
        },
        room=target_id,
    )
    emit(
        "system_notice",
        {"message": f"Sent a minigame invite to {target['nickname']}."},
        room=sid,
    )


@socketio.on("minigame_invite_response")
def on_minigame_invite_response(data: Dict[str, Any]) -> None:
    sid = request.sid
    requester_id = str((data or {}).get("from_id", "")).strip()
    accepted = bool((data or {}).get("accepted", False))

    with state_lock:
        invitation = pending_minigame_invites.get(sid)
        if invitation is None or invitation.get("from_id") != requester_id:
            return

        requester = find_player(requester_id)
        responder = find_player(sid)
        pending_minigame_invites.pop(sid, None)

        if requester is None or responder is None:
            return

        requester_nickname = requester["nickname"]
        responder_nickname = responder["nickname"]

    if not accepted:
        emit(
            "minigame_invite_declined",
            {"nickname": responder["nickname"]},
            room=requester_id,
        )
        return

    requester_profile = player_repository.get_or_create(requester_nickname)
    if int(requester_profile.get("coin", 0)) < VOLLEY_ENTRY_FEE:
        emit(
            "system_notice",
            {"message": f"{requester_nickname} does not have enough coins for the minigame."},
            room=sid,
        )
        emit(
            "system_notice",
            {"message": "You need at least 10 coins to start a minigame."},
            room=requester_id,
        )
        return

    responder_profile = player_repository.get_or_create(responder_nickname)
    if int(responder_profile.get("coin", 0)) < VOLLEY_ENTRY_FEE:
        emit(
            "system_notice",
            {"message": f"You need at least {VOLLEY_ENTRY_FEE} coins to accept this minigame."},
            room=sid,
        )
        emit(
            "system_notice",
            {"message": f"{responder_nickname} does not have enough coins to accept right now."},
            room=requester_id,
        )
        return

    session_id = uuid.uuid4().hex[:10]
    nick_by_side = {
        "left": requester["nickname"],
        "right": responder["nickname"],
    }
    minigame_sessions[session_id] = {
        "type": "volley",
        "session_id": session_id,
        "status": "waiting_join",
        "allowed_nicknames": [nick_by_side["left"], nick_by_side["right"]],
        "nick_by_side": nick_by_side,
        "sid_by_side": {"left": "", "right": ""},
        "players_state": {
            "left": create_volley_player("left", nick_by_side["left"]),
            "right": create_volley_player("right", nick_by_side["right"]),
        },
        "scores": {"left": 0, "right": 0},
        "ball": {
            "x": VOLLEY_FIELD["width"] * 0.5,
            "y": 380.0,
            "vx": 320.0,
            "vy": -520.0,
            "r": VOLLEY_BALL["radius"],
        },
        "entry_fee": VOLLEY_ENTRY_FEE,
        "target_score": VOLLEY_WIN_SCORE,
        "countdown_seconds": 5,
        "countdown_remaining": 0,
        "countdown_until": 0.0,
        "pending_serve": None,
        "settled": False,
        "match_end_payload": None,
        "end_emitted": False,
    }

    payload = {
        "session_id": session_id,
        "game_path": f"/game/volley?session={session_id}",
        "players": [
            {"id": requester_id, "nickname": requester["nickname"]},
            {"id": sid, "nickname": responder["nickname"]},
        ],
    }
    emit("minigame_start", payload, room=requester_id)
    emit("minigame_start", payload, room=sid)


@socketio.on("volley_join_session")
def on_volley_join_session(data: Dict[str, Any]) -> None:
    ensure_volley_loop_started()
    payload = data or {}
    session_id = str(payload.get("session_id", "")).strip()
    nickname = sanitize_nickname(payload.get("nickname"))
    sid = request.sid
    if not session_id or not nickname:
        emit("volley_error", {"message": "The session payload is invalid."})
        return

    with state_lock:
        session = minigame_sessions.get(session_id)
        if session is None or session.get("type") != "volley":
            emit("volley_error", {"message": "This volleyball session is not valid."}, room=sid)
            return

        side = None
        for side_key, side_nickname in session["nick_by_side"].items():
            if side_nickname == nickname:
                side = side_key
                break
        if side is None:
            emit("volley_error", {"message": "You are not a participant in this session."}, room=sid)
            return

        prev_sid = session["sid_by_side"].get(side, "")
        if prev_sid and prev_sid != sid:
            volley_connections.pop(prev_sid, None)

        session["sid_by_side"][side] = sid
        session["status"] = "waiting_join"
        volley_connections[sid] = {"session_id": session_id, "side": side}
        socketio.server.enter_room(sid, session_id, namespace="/")

        connected_sides = [
            side_key
            for side_key in ("left", "right")
            if session["sid_by_side"].get(side_key)
        ]
        both_connected = len(connected_sides) == 2

        ready_to_start = False
        if both_connected and not session.get("bets_locked", False):
            left_nickname = session["nick_by_side"]["left"]
            right_nickname = session["nick_by_side"]["right"]
            left_lock = player_repository.try_lock_entry_fee(left_nickname, VOLLEY_ENTRY_FEE)
            right_lock = player_repository.try_lock_entry_fee(right_nickname, VOLLEY_ENTRY_FEE)

            if left_lock.get("ok") and right_lock.get("ok"):
                session["bets_locked"] = True
                session["status"] = "countdown"
                session["scores"] = {"left": 0, "right": 0}
                session["countdown_seconds"] = 5
                session["countdown_until"] = time.time() + float(session["countdown_seconds"])
                session["countdown_remaining"] = int(session["countdown_seconds"])
                reset_volley_round(session, launch_immediately=False)
                ready_to_start = True
            else:
                if left_lock.get("ok"):
                    player_repository.add_coin(left_nickname, VOLLEY_ENTRY_FEE)
                if right_lock.get("ok"):
                    player_repository.add_coin(right_nickname, VOLLEY_ENTRY_FEE)
                session["status"] = "cancelled"
                emit(
                    "volley_error",
                    {"message": "Both players need 10 coins to start."},
                    room=session_id,
                )
                return
        elif both_connected and session.get("bets_locked", False):
            ready_to_start = session["status"] in {"countdown", "playing", "finished"}

        emit(
            "volley_joined",
            {
                "session_id": session_id,
                "side": side,
                "nickname": nickname,
                "entry_fee": VOLLEY_ENTRY_FEE,
                "target_score": VOLLEY_WIN_SCORE,
                "connected_players": len(connected_sides),
                "status": session["status"],
            },
            room=sid,
        )

        if ready_to_start:
            emit(
                "volley_start",
                {
                    "session_id": session_id,
                    "entry_fee": VOLLEY_ENTRY_FEE,
                    "target_score": VOLLEY_WIN_SCORE,
                    "pot": VOLLEY_POT,
                    "status": session["status"],
                    "countdown_seconds": int(session.get("countdown_seconds", 0)),
                    "countdown_remaining": int(session.get("countdown_remaining", 0)),
                    "scores": dict(session["scores"]),
                    "side_nicknames": dict(session["nick_by_side"]),
                },
                room=session_id,
            )
        else:
            emit(
                "volley_waiting",
                {
                    "session_id": session_id,
                    "connected_players": len(connected_sides),
                },
                room=session_id,
            )


@socketio.on("volley_input")
def on_volley_input(data: Dict[str, Any]) -> None:
    sid = request.sid
    payload = data or {}
    with state_lock:
        connection = volley_connections.get(sid)
        if connection is None:
            return
        session = minigame_sessions.get(connection["session_id"])
        if session is None or session.get("type") != "volley":
            return
        if session.get("status") not in {"playing", "waiting_join"}:
            return
        side = connection["side"]
        player = session["players_state"][side]
        player["input"]["left"] = bool(payload.get("left", False))
        player["input"]["right"] = bool(payload.get("right", False))
        player["input"]["jump"] = bool(payload.get("jump", False))


@socketio.on("disconnect")
def on_disconnect() -> None:
    sid = request.sid
    volley_end_emit = None
    with state_lock:
        connection = volley_connections.pop(sid, None)
        if connection is not None:
            session = minigame_sessions.get(connection["session_id"])
            if session and session.get("type") == "volley":
                side = connection["side"]
                session["sid_by_side"][side] = ""
                if session.get("status") == "playing" and not session.get("settled"):
                    winner_side = "right" if side == "left" else "left"
                    _finish_volley_match(session, winner_side, "opponent_disconnect")
                    if session.get("match_end_payload"):
                        volley_end_emit = (dict(session["match_end_payload"]), session["session_id"])

        leaving = players.pop(sid, None)
        pending_minigame_invites.pop(sid, None)

        remove_keys = [
            target_id
            for target_id, invite in pending_minigame_invites.items()
            if invite.get("from_id") == sid
        ]
        for target_id in remove_keys:
            pending_minigame_invites.pop(target_id, None)

    if leaving is None:
        if volley_end_emit is not None:
            payload, room_id = volley_end_emit
            emit("volley_match_end", payload, room=room_id)
        return

    if volley_end_emit is not None:
        payload, room_id = volley_end_emit
        emit("volley_match_end", payload, room=room_id)

    emit("player_left", {"id": sid}, broadcast=True)
    emit(
        "system_notice",
        {"message": f"{leaving['nickname']} left the lobby."},
        broadcast=True,
    )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    socketio.run(app, host="0.0.0.0", port=port)
