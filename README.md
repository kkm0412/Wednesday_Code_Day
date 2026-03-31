# 정글버스

## 0. 실행 방법

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

- 실행 후 브라우저에서 `http://localhost:5000` 으로 접속하면 됩니다.
- MongoDB는 선택 사항입니다. `MONGODB_URI` 환경 변수가 없으면 메모리 기반 저장소로 실행됩니다.
- 포트를 바꾸고 싶으면 `PORT=5001 python3 app.py` 처럼 실행하면 됩니다.

## 1. 프로젝트 한 줄 소개

### 멀티플레이 로비 중심의 실시간 웹 기반 메타버스
- Flask + Socket.IO 기반
- 로비, 던전, 2인 배구 미니게임 연결
- 서버 권위 판정 + 코인 정산
---

## 2. 왜 만들었나
### 목표
- 색다른 소통 창구
- 어려운 외부활동을 가상환경으로 확장
- 간단한 미니게임들로 동료들과 친목 도모

### 핵심 키워드
- Realtime
- Scene 분리
- Server authoritative
- Coin settlement

---

## 3. 기술 스택

| 영역 | 사용 기술 |
|---|---|
| Backend | Flask, Flask-SocketIO |
| Frontend | HTML, CSS, Canvas API, Vanilla JS |
| Data | MongoDB(optional), in-memory fallback |
| Network | Socket.IO |

---

## 4. 시스템 구성

### 페이지 구조
- `/` : 로비
- `/dungeon` : 던전
- `/game/volley` : 2인 배구

### 서버 역할
- 로비 상태 브로드캐스트
- 초대/수락 세션 관리
- 배구 물리/득점/승패 확정
- 코인 차감/보상 처리

---

## 5. 로비 핵심 기능

- 닉네임 입장
- 좌우 이동 + 점프
- 공개 채팅(Enter)
- 우클릭 상호작용
- 미니게임 초대/수락
- 포탈 + `↑`로 던전 이동


---

## 6. 던전 핵심 기능

- 던전 씬 분리
- 전용 HUD/배경/포탈
- 액션 키 훅(Z/X/C)
- 코인 드랍/픽업 UI

---

## 7. 2인 배구 미니게임

### 게임 규칙
- 실시간 2인 대전
- 공 포물선 + 네트 충돌(MVP 물리)
- 5점 선승

### 코인 규칙
- 시작 시 각 `-10`
- 승자 `+20`
---
