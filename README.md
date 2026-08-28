# ARPG Prototype

디아블로4를 참고한 3D 탑뷰(쿼터뷰) 싱글플레이 ARPG 프로토타입 v0.
브라우저에서 실행되며, 던전 하나를 돌아 보스를 잡는 5분 내외의 플레이 루프를 갖췄습니다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm test         # 단위 테스트 (Vitest)
npm run build    # 프로덕션 빌드
```

## 조작

| 입력 | 동작 |
|---|---|
| WASD / 방향키 | 직접 이동 (누르는 동안 그 방향으로) |
| 좌클릭 (바닥) | 이동 |
| 좌클릭 (적) | 접근 후 기본 공격(휘두르기) — 분노 충전 |
| 우클릭 | 회전베기 (분노 25 소모, 자기 중심 360° 범위) |
| Space | 돌진 (쿨다운 5초, 마우스 방향 대시 + 관통 피해/넉백) |
| I | 인벤토리 열기·닫기 (아이템 클릭 시 장착) |

바닥에 떨어진 아이템은 가까이 가면 자동으로 줍고, 이름표를 클릭하면 그 자리로 이동합니다.

WASD와 클릭 이동은 함께 쓸 수 있습니다. **키를 누르고 있는 동안에는 WASD가 우선**이라,
클릭으로 이동하던 중에 키를 누르면 즉시 직접 조작으로 넘어옵니다. 적을 클릭해 자동으로
쫓아가던 중에도 마찬가지로 빠져나올 수 있습니다.

## 게임 흐름

입구홀에서 시작해 복도를 따라 전투방 3개를 지나 최심부 보스방(해골 군주)까지 진행합니다.
철위병·흔적꾼·등불사제가 전투를 보조하며, 적 처치 시 경험치와 확률 드롭을 얻고 보스는 희귀 등급을 확정 드롭합니다.
보스가 강타·돌진을 예고하는 동안 약점이 열리며, 공격으로 브레이크 게이지를 모두 깎으면
패턴이 취소되고 3초간 무력화되어 집중 공격을 넣을 수 있습니다.
사망하면 3초 후 입구에서 부활합니다.

v0에는 물약이 없어 지속력 수단이 없었고, 그대로면 보스 앞에서 체력이 바닥나 클리어가
불가능했습니다. 그래서 **적을 처치할 때 최대 체력의 8%를 회복**합니다
(`LIFE_ON_KILL_PCT`, `src/systems/progression.ts`). 레벨업 시에는 전체 회복입니다.

## 구조

```
src/
├─ main.ts              부트스트랩 · 시스템 실행 순서 정의
├─ core/
│  ├─ world.ts          Entity/컴포넌트 타입, Resources, miniplex World
│  ├─ loop.ts           고정 60Hz 로직 스텝 + 가변 렌더 루프
│  ├─ pathfind.ts       격자 A* + 시야 스무딩 (벽 클릭 시 최대한 접근)
│  ├─ assets.ts         glTF 로더 (없으면 프리미티브 폴백)
│  └─ rng.ts            결정적 시드 RNG (mulberry32)
├─ systems/             매 스텝 실행되는 ECS 시스템
│  ├─ input.ts          마우스 픽킹 → 이동/공격/스킬 의도
│  ├─ ai.ts             적 상태머신 (idle→chase→attack→return)
│  ├─ boss.ts           보스 패턴 (3연속 강타 / 돌진 차지)
│  ├─ break.ts          약점 노출·브레이크·무력화·집중 피해
│  ├─ party.ts          3역할 동료 AI·탱커 대상 우선·지원 회복
│  ├─ skills.ts         분노·쿨다운, 회전베기, 돌진
│  ├─ movement.ts       길찾기 경로 추종, 벽 슬라이드, 유닛 분리, 넉백
│  ├─ combat.ts         부채꼴 근접 판정, 데미지, 투사체, 사망/부활
│  ├─ loot.ts           드롭 생성, 줍기, 장착 스탯 재계산
│  ├─ progression.ts    XP, 레벨업, 처치 시 회복
│  ├─ animation.ts      상태 → 애니메이션 클립 전환
│  └─ render.ts         씬 동기화, 카메라 추적, 조명
├─ content/             밸런스 데이터 (로직과 분리 — 여기 숫자만 고쳐도 됨)
│  ├─ map.ts            던전 격자 레이아웃, 스폰 배치
│  ├─ enemies.ts        적 스탯
│  ├─ companions.ts     철위병·흔적꾼·등불사제 정의
│  ├─ skills.ts         스킬 수치
│  └─ items.ts          아이템 등급·접사·드롭률
├─ dev/autoplay.ts      자동 플레이 봇 (?autoplay=1)
└─ ui/hud.ts            HP/분노 구슬, 스킬바, 인벤토리, 네임플레이트

tools/playtest/         플레이테스트 하니스 (아래 "테스트" 절 참조)
├─ core.mjs             브라우저 세션 — 관측 + 실제 입력
├─ scenario.mjs         체크포인트 정의와 판정
├─ cli.mjs              CLI (autorun / inputcheck / 단계별 조작)
├─ server.mjs           상주 세션 서버
└─ mcp.mjs              MCP 서버
```

### 시스템 실행 순서

`input → ai → party → break → boss → skills → movement → combat → loot → progression → animation`
(렌더 프레임마다 `render`)

로직은 고정 60Hz 스텝으로 돌고 렌더는 가변 프레임이라, 프레임률이 흔들려도
게임 속도는 일정합니다.

## 에셋

캐릭터 모델은 `public/assets/models/*.glb`에서 자동 로드됩니다 (KayKit, CC0).
파일이 없으면 도형 프리미티브로 대체되므로 에셋 없이도 항상 실행됩니다.
교체 방법과 출처는 [public/assets/models/README.md](public/assets/models/README.md) 참조.

## 밸런스 조정

수치는 전부 `src/content/`에 있습니다. 예를 들어 적이 너무 강하면
`enemies.ts`의 `ENEMY_DEFS`에서 `hp`/`damage`를, 드롭이 적으면
`items.ts`의 `DROP_CHANCE`를 조정하면 됩니다. 로직 코드는 건드릴 필요가 없습니다.

## 테스트

### 단위 테스트

순수 로직(판정 수학, 길찾기, 상태 전이, 스탯 계산, 확률 굴림, 브레이크, 파티 대상 선택)은 단위 테스트로 덮여 있습니다:
`tests/{loop,map,pathfind,movement,ai,combat,skills,items,progression,boss,break,companions}.test.ts`.

```bash
npm test
npm run typecheck
```

### 플레이테스트 하니스 (`tools/playtest/`)

실제로 게임을 띄워서 플레이해보는 자동화 도구입니다. 설계 원칙이 하나 있습니다:

> **관측은 자유롭게, 조작은 반드시 실제 입력으로만.**

게임 내부 상태를 직접 고쳐서 캐릭터를 옮기거나 스탯을 바꾸지 않습니다. 그렇게 하면
"테스트는 통과하는데 사람이 하면 안 되는" 상황을 잡아낼 수 없기 때문입니다.
(실제로 이 원칙을 세우기 전에는 길찾기 부재와 부활 후 투명화 버그가 가려져 있었습니다.)

```bash
npm run playtest         # 자동 플레이 봇으로 던전 완주 + 체크포인트 리포트
npm run playtest:input   # 실제 마우스/키 입력만으로 조작이 되는지 검증
npm run playtest:break   # 보스전이 판단을 요구하는지 계측 (아래 참조)
```

#### 브레이크 계측 (`playtest:break`)

게이지가 존재한다는 것과 그 게이지가 재미있다는 것은 다른 문제다. 플레이어가
아무것도 하지 않아도 브레이크가 나면 그건 연출이지 선택이 아니다. 그 구분을 눈이
아니라 수치로 내리기 위한 도구다.

측정 항목과 읽는 법:

| 항목 | 의미 |
|---|---|
| 노출 창 / 브레이크 / 창당 브레이크율 | 보스전의 리듬이 몇 번 돌았는가 |
| 게이지 이월 | 창이 열릴 때 이미 깎여 있던 횟수. 잦으면 "이번 창에 넣어야 한다"는 압박이 사라진다 |
| **무개입 브레이크** | 분노 소모도 돌진도 없이 발생한 브레이크. **0이 아니면 자동화되고 있다는 뜻** |
| 돌진 사용 (브레이크 / 이동) | 돌진을 아껴 브레이크에 쓰는지, 그냥 이동에 쓰는지 |
| 분노 부족 시간 | 계속 가득 차 있으면 회전베기는 비용 없는 스킬이 된다 |

`--dump` 를 붙이면 게이지가 변한 순간의 원시 표본을 함께 출력한다. 계측값이
이상할 때 근거를 직접 확인하는 용도다.

표본은 바깥에서 폴링하지 않고 페이지 안에서 렌더 프레임마다 쌓는다. `observe()`
왕복은 200ms 안팎이라 0.3~1초짜리 창을 통째로 놓치기 때문이다. 이 추적기도
읽기 전용이라 게임 상태를 쓰지 않는다는 원칙은 그대로다.

진행은 게임 내장 자동 플레이 봇이 맡는다. 봇의 스킬 사용 습관은 사람과 다르므로
절대 수치가 아니라 **변경 전후 비교용 기준선**으로 읽어야 한다.

체크포인트는 3단계로 나뉩니다 — `micro`(입력이 먹히는가), `landmark`(첫 처치·아이템
획득·보스 조우), `objective`(보스 처치·생존). 스크린샷을 눈으로 보고 판단하는 대신
관측 스냅샷만으로 통과/실패가 결정되므로 근거가 남습니다.

#### 단계별 수동 조작

세션을 띄워두고 한 동작씩 보내며 관찰할 수 있습니다.

```bash
npm run playtest:serve                       # 세션 서버 (별도 터미널)
node tools/playtest/cli.mjs start            # 게임 시작
node tools/playtest/cli.mjs observe          # 상태 관측 (적/아이템의 화면 좌표 포함)
node tools/playtest/cli.mjs click 640 300    # 그 좌표로 실제 클릭
node tools/playtest/cli.mjs press Space      # 돌진
```

#### MCP 서버

같은 기능을 MCP로 노출해, Claude가 이 게임을 직접 플레이하며 테스트할 수 있습니다.
(포켓몬 에뮬레이터 MCP 서버와 같은 발상 — 에뮬레이터 대신 브라우저, 버튼 대신
마우스/키, RAM 덤프 대신 ECS 월드 관측입니다.)

```json
{
  "mcpServers": {
    "arpg-playtest": {
      "command": "node",
      "args": ["C:/Users/User/Documents/arpg-prototype/tools/playtest/mcp.mjs"]
    }
  }
}
```

도구: `game_start`, `game_observe`, `game_click`, `game_press`, `game_mouse`,
`game_wait`, `game_screenshot`, `game_checkpoints`, `game_reset`.
게임 상태를 직접 쓰는 도구는 의도적으로 없습니다.

### 자동 플레이 봇

`?autoplay=1` 로 접속하면 게임에 내장된 봇이 입구부터 보스방까지 스스로 진행합니다
(`src/dev/autoplay.ts`). 밸런스 감각을 보거나 회귀를 잡을 때 유용합니다.

## v0 범위 밖 (다음 단계 후보)

절차적 던전 생성, 추가 클래스/영웅 수집, 스킬트리, 상점/제작, 저장·불러오기, 사운드,
추가 장비 슬롯, 물약 시스템, 온라인 길드·거래·랭킹.
