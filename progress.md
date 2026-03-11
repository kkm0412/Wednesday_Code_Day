Original prompt: 처음에 메인화면 메인화면에서 닉네임 치고 로비 입장 가능 메타버스형이고 플랫포머 형태 캐릭터가 방향키 좌우키를 누르면 좌우로 이동함 스페이스바를 누르면 점프가 가능함. 플레이어는 플랫폼 위를 걸어다님 다른사람들도 입장 가능 다른사람들끼리 만났을때 마우스 오른쪽키를 누르면 친구 추가 대화하기 뜸 채팅창이 뜨고 1대1 대화 가능 로비에서는 엔터키 눌러서 채팅을 입력하면 캐릭터 위에 말풍선이 뜨고 다른 주변에 있는 플레이어들과 소통 가능 rpg에서 대화 하는 것처럼 해보지 로비는 알아서 잘 만들어라. 플레이어들이 탈출 하는 현상이 일어나지 않도록 하고 혹시나 로비 공간에서 벗어나는 경우가 있으면 로비 중앙으로 돌아올수 있도록 대처도 해줘 서버는 우분투에서 돌릴거고 flask 기반으로 작동시킬거야

- 초기 상태 확인: 기존 `index.html`은 단일 좀비 게임이었고 요청사항과 구조가 달라 Flask + Socket.IO 기반으로 신규 구성 필요.
- 구현 계획: `app.py`(서버), `templates/index.html`, `static/client.js`, `static/style.css`, `requirements.txt`를 추가해 멀티플레이 로비형 플랫포머로 재구성.
- 수정: `app.py`의 `join_lobby`에서 `state_lock` 안에서 `make_state_snapshot()`를 호출하던 구조를 제거해 락 재진입 데드락 가능성 해결.
- 테스트 중 발견: `/socket.io/socket.io.js` 경로가 400(프로토콜 미스매치)로 로드 실패하여 클라이언트 소켓 초기화 불가.
- 수정: `templates/index.html`에서 Socket.IO 클라이언트를 `https://cdn.socket.io/4.7.5/socket.io.min.js`로 교체.
- 검증: Playwright 클라이언트로 `닉네임 입력(a) -> 입장(Enter) -> 이동/점프 -> Enter 채팅 입력` 시나리오 실행 성공.
  - 산출물: `output/web-game/shot-0.png`, `output/web-game/state-0.json`
  - `state-0.json` 기준 `mode=lobby`, 플레이어 좌표/상태 정상 반영.
  - `errors-*.json` 생성 없음(새 콘솔 에러 없음).
- 검증: Python Socket.IO 클라이언트 2개 동시 접속 통신 테스트 통과.
  - 결과: `join_lobby`, `friend_request`, `private_message`, `public_chat` 이벤트 모두 양측 수신 확인.

TODO / Suggestions for next agent:
- 운영 배포 전 Flask 개발 서버 대신 gunicorn+eventlet/gevent 기반 실행 스크립트 추가 검토.
- 우클릭 컨텍스트 메뉴를 모바일 대응하려면 long-press 상호작용 입력 추가 고려.
- 현재 Socket.IO 클라이언트는 CDN 의존성이 있으므로 외부망 제한 환경이라면 정적 번들 로컬 서빙 방식으로 전환 필요.
- 사용자 요구사항 업데이트 반영: 로비를 메인(`lobby.html`)으로 분리하고 `/dungeon`, `/game` 라우트를 추가.
- 서버 확장: MongoDB 플레이어 저장소 계층(`_id`, `hp`, `coin`) 추가, 미니게임 신청/수락 소켓 이벤트(`minigame_invite`, `minigame_invite_response`, `minigame_start`) 추가.
- 로비 확장: 포탈 진입 조건을 `포탈 범위 + ArrowUp`으로 구현, 우클릭 메뉴에 미니게임 신청 추가, 가변 점프(짧게/길게) 및 점프 높이 상향 적용.
- 분업용 뼈대 추가: `dungeon.html + dungeon.js`(이동/점프/공격키 훅), `game.html + game.js`(세션/코인 사용 훅) 구성. 던전/미니게임 실제 콘텐츠는 미구현 상태 유지.
- 파일 구조 정리: 기존 `templates/index.html`, `static/client.js` 제거.
- 추가 요구 반영 구현: 포탈은 `ArrowUp`으로 진입하도록 변경, 점프는 가변 점프(짧게/길게) + 기본 높이 소폭 상향.
- 페이지 분리 완료: `/`(lobby), `/dungeon`(기반), `/game`(기반).
- 검증 1: Playwright 액션 테스트(`output/web-game-lobby`)에서 로비 입장/이동/점프/채팅 시나리오 및 상태 출력 정상.
- 검증 2: Playwright 포탈 체크에서 `portal.in_range=true` 상태로 `ArrowUp` 입력 시 URL이 `/dungeon`으로 변경됨 확인.
- 검증 3: 2클라이언트 Socket.IO 테스트에서 `minigame_invite -> minigame_invite_response(accepted) -> minigame_start` 양측 수신 확인.
- 문서화: 분업용 가이드 `division.md` 생성(현재 구현 범위, 소켓 이벤트 계약, 던전/미니게임/백엔드 팀별 고려사항, 데이터 모델 권장안 정리).

- 구현: `/game/volley` 신규 라우트/템플릿/클라이언트(`templates/volley.html`, `static/volley.js`) 추가. 캔버스 코트, 중앙 라켓, 벽 반사 필드, 각 진영 상단 대형 점수 숫자 UI 반영.
- 서버 확장: `app.py`에 Volley 세션 상태머신/물리 루프 추가.
  - 각 플레이어 10코인 베팅 잠금(`try_lock_entry_fee`) 후 경기 시작
  - 5점 선취 시 종료
  - 승자에게 20코인 지급(`add_coin`)
  - 경기 중 이탈 시 상대 승 처리(`opponent_disconnect`)
- 흐름 변경: 로비 미니게임 수락 시 `/game/volley?session=...`로 이동하도록 `static/lobby.js` 수정.
- 저장소 확장: `PlayerRepository`에 코인 차감/지급 메서드 추가(MongoDB + in-memory fallback).
- 스타일 확장: `static/style.css`에 volley 레이아웃/캔버스 스타일 추가.
- 테스트: 로컬 서버(`PORT=5199`)에서 Playwright 클라이언트 실행.
  - 명령: `node web_game_playwright_client.js --url http://127.0.0.1:5199/game/volley --iterations 2 --pause-ms 300 --screenshot-dir output/web-volley-check --click 640,360`
  - 결과: 스크린샷/상태 JSON 생성(`output/web-volley-check/shot-0.png`, `state-0.json`).
  - 확인: 각 진영 상단에 큰 점수(0/0) 표시, 상태 오버레이 정상.
  - 제약: 자동 테스트는 단일 브라우저 시나리오라 2인 대전/실제 득점-정산 루프는 미검증.

TODO / Suggestions for next agent:
- 2개 클라이언트 동시 접속으로 실제 득점(5점 종료)과 코인 정산(승자 +20) E2E 검증 필요.
- 동일 닉네임 중복 접속/세션 재접속 정책 정교화 필요(현재 닉네임 기반 매칭).
- MongoDB 사용 시 `find_one_and_update` 동작/인덱스 상태 운영 환경에서 재검증 권장.

- 버그 수정: 미니게임 초대 모달이 표시되지 않던 문제 해결. 원인=`invite-modal`에 `.show` 클래스가 빠져 `.overlay` 기본 `display:none` 유지됨. `showInviteModal`에서 `show` 추가, `hideInviteModal`에서 `show` 제거하도록 수정(`static/lobby.js`).

- 밸런스 조정: `/game/volley` 플레이어 크기 2배(52x68 -> 104x136), 공 반지름 2배(26 -> 52) 반영. 서버 물리값(`app.py`)과 클라이언트 초기 렌더(`static/volley.js`) 동기화.

- 기능 추가: Volley 첫 경기 시작 전 5초 카운트다운 도입. 서버 상태(`countdown`)에서 중앙 숫자 UI 표시 후 0이 되면 공 서브 시작. 이후 랠리는 기존처럼 즉시 재개.

- UX 개선: 로비 복귀 시 `sessionStorage.player_profile.nickname`이 있으면 자동으로 `join_lobby` 요청하도록 변경(`static/lobby.js`). 닉네임 재입력 없이 바로 로비 재입장 가능.
- 검증: Playwright 로비 회귀 체크(`output/web-lobby-autojoin-check`). 저장 닉네임이 없는 신규 컨텍스트에서 start 모드 정상, 콘솔 에러 파일 미생성.

- 볼리 캐릭터 형태 개선: 공 토스 용이성을 위해 플레이어 충돌 판정을 직사각형 단일 AABB에서 `원형 머리 + 몸통` 합성 충돌로 변경(`app.py`). 렌더도 동일하게 머리 원형/몸통 형태로 변경(`static/volley.js`).

- 통일 작업: `/game` -> `/game/volley` 리다이렉트로 경로 단일화. `/game/volley`는 `templates/game.html` 렌더.
- 이벤트 통일: 프론트 런타임(`static/minigames/volleyball.js`)의 소켓 이벤트/emit을 `volley_*`로 전환(`volley_joined`, `volley_waiting`, `volley_start`, `volley_state`, `volley_match_end`, `volley_input`, `volley_join_session`).
- 서버 페이로드 적응: `volley_state`(서버 월드 좌표 2200x1200)를 캔버스 좌표(1280x720)로 스케일 변환해 렌더 오프셋 문제 방지.
- 데모 코인 기본값: `static/game.js`, `static/minigames/volleyball.js` 모두 기본 0으로 조정.

- 입력 버그 수정(lobby):
  - 한글 IME 조합 중 Enter 전송 시 마지막 글자 누락 문제 대응: chat/pm 입력에서 composition 상태를 추적하고 Enter 전송을 조합 완료 후(setTimeout) 처리.
  - 스페이스 장눌림 시 페이지 스크롤 문제 대응: 입력 포커스가 아닐 때 Space/Arrow 기본동작 preventDefault.
  - 1:1 채팅에서 Space 미입력 문제 대응: 전역 키다운에서 입력 포커스(typing target)일 때 이동/점프 키 처리 무시.

- MongoDB 영속화 확장:
  - `PlayerRepository` 문서에 `id` 필드 추가(신규 생성 시 저장, 기존 문서는 조회 시 누락되면 보정).
  - 프로필 정규화 응답에 `id/_id/nickname/hp/coin` 포함.
- 서버 이벤트 추가/연결:
  - `sync_profile` 소켓 이벤트 추가: 닉네임 기준 `hp/coin` DB 업데이트 + ACK 반환.
  - `dungeon_return_lobby` 소켓 이벤트 추가: 던전 복귀 시 `hp=100`으로 리셋하고 `coin` 유지 + ACK 반환.
  - `join_dungeon` 응답(`dungeon_joined`)에 DB 기준 `profile` 포함하도록 확장.
  - `join_lobby` 응답(`joined.profile`)에도 `id` 포함.
- 클라이언트 동기화 반영:
  - `static/dungeon.js`
    - `saveProfile()`에 `sync_profile` 서버 동기화 훅 추가.
    - `dungeon_joined.profile`을 로컬 상태에 적용해 던전 진입 시 DB 값 기준으로 시작.
    - 복귀 포탈에서 `dungeon_return_lobby` ACK 후 로비 이동하도록 변경(실패/타임아웃 시 로컬 fallback, HP 100 저장).
  - `static/lobby.js`
    - 던전 포탈 진입 직전에 `sync_profile` ACK를 기다린 뒤 이동(타임아웃 fallback).
    - 세션 저장 프로필에 `id` 필드 포함.
- 검증:
  - 문법 체크: `node --check static/dungeon.js`, `node --check static/lobby.js` 통과.
  - 서버 이벤트 통합 체크(`.venv/bin/python` + `socketio.test_client`) 통과:
    - `join_lobby` -> 기본 프로필
    - `sync_profile(hp=37, coin=91)` -> ACK 반영
    - `join_dungeon` -> profile이 37/91로 전달
    - `dungeon_return_lobby` -> ACK profile이 100/91로 전달
  - Playwright는 1회 실행에서 스크린샷/상태 생성(`output/web-lobby-mongo-check`) 확인. 추가 1회는 샌드박스 Chromium 권한 오류로 실패.

- 미니게임 코인 게이트 강화:
  - `minigame_invite` 단계에서 신청자 코인이 10 미만이면 즉시 차단 + 시스템 안내 메시지 전송.
  - `minigame_invite` 단계에서 대상자 코인이 10 미만이면 초대 자체를 차단.
  - `minigame_invite_response(accepted)` 단계에서 수락자/신청자 둘 중 하나라도 10 미만이면 세션 생성 차단.
- 배구 UI 개선(`/game/volley`, `static/minigames/volleyball.js`):
  - 좌/우 진영 상단에 대형 점수 숫자 표시(각 진영 별).
  - 중앙 상단에 현재 스코어/목표점 표시.
  - 경기 상태가 `countdown`일 때 중앙 오버레이에 큰 숫자로 카운트다운 표시.
  - 네트워크 state에 `countdown_seconds`, `countdown_remaining` 반영.
- 검증:
  - 문법 체크 통과: `app.py` compile, `node --check static/minigames/volleyball.js`.
  - Socket.IO 테스트 클라이언트로 초대/수락 코인 게이트 확인:
    - 신청자 10 미만: 초대 차단.
    - 대상자 10 미만: 초대 차단.
    - 수락자 10 미만: 수락 차단, `minigame_start` 미발생.
  - Playwright 스크린샷(`output/web-volley-ui-check/shot-0.png`)에서 좌/우 대형 점수 UI 확인.
