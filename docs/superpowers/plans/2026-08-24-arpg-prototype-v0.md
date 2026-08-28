# ARPG Prototype v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 디아블로4풍 3D 탑뷰 ARPG의 실행 가능한 v0 프로토타입 (클릭 이동, 전투, 스킬 3종, 루트/장착, 레벨업, 보스).

**Architecture:** miniplex 2.x ECS. 엔티티는 평범한 객체, 시스템은 `world.with(...)` 쿼리를 순회하는 순수 함수 모듈. 고정 60Hz 로직 스텝 + 가변 렌더. Three.js 씬 동기화는 render 시스템 하나가 전담. HUD는 HTML/CSS 오버레이.

**Tech Stack:** TypeScript, Vite, Three.js, miniplex 2.x, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-arpg-prototype-design.md`

## Global Constraints

- **커밋은 사용자가 직접 한다. AI는 git commit을 실행하지 않고, 커밋 여부를 묻지도 않는다.** 각 태스크 끝은 "실행 가능한 상태"로만 만든다.
- 모든 순수 로직(수치 계산, 판정 수학, 상태 전이)은 Vitest 단위 테스트를 먼저 작성(TDD). 렌더링/입력은 dev 서버 스모크 체크로 검증.
- 에셋이 없어도 항상 실행 가능해야 한다(프리미티브 폴백).
- 물리엔진 금지: 격자 통행 판정 + 원형 밀어내기만 사용.
- 시스템 파일은 부수효과를 world/Resources 안으로 한정한 순수 함수형 모듈로 유지.
- 타일 크기 = 2 world units. 논리 스텝 = 1/60s 고정.

---

## 공유 타입 (Task 2에서 확정, 이후 모든 태스크가 참조)

```ts
// core/world.ts
import { World } from "miniplex"
import type * as THREE from "three"

export type Vec3 = { x: number; y: number; z: number }
export type Vec2 = { x: number; z: number }

export type EnemyKind = "warrior" | "archer" | "boss"
export type AIState = "idle" | "chase" | "attack" | "return"
export type ModelKind = "player" | "warrior" | "archer" | "boss" | "projectile" | "loot"
export type Rarity = "common" | "magic" | "rare"
export type Slot = "weapon" | "armor" | "ring"

export interface Affix { stat: "attackPower" | "maxHp" | "moveSpeedPct"; value: number }
export interface ItemInstance {
  id: number; name: string; slot: Slot; rarity: Rarity
  base: Affix          // 슬롯 고유 기본 스탯
  affixes: Affix[]     // 등급별 0~2개
}

export interface PlayerComp {
  rage: number; maxRage: number
  level: number; xp: number
  baseAttack: number; baseMaxHp: number; baseSpeed: number
  attackPower: number; moveSpeed: number   // 파생(장비+레벨 반영) — recalc로만 변경
  inventory: ItemInstance[]
  equipment: Partial<Record<Slot, ItemInstance>>
  cooldowns: { dash: number }              // readyAt 시각(초)
}

export interface Entity {
  transform?: { position: Vec3; yaw: number }
  speed?: number
  radius?: number
  moveTarget?: Vec2
  health?: { current: number; max: number }
  dead?: { at: number }
  attack?: { damage: number; range: number; arc: number; cooldown: number; readyAt: number }
  hitFlash?: { until: number }
  knockback?: { dir: Vec2; speed: number; until: number }
  player?: PlayerComp
  attackIntent?: { target: Entity }        // input → combat
  skillIntent?: { skill: "whirlwind" | "dash"; point: Vec2 }  // input → skills
  enemy?: { kind: EnemyKind; state: AIState; home: Vec3; stateSince: number }
  boss?: { phase: "idle" | "slamTelegraph" | "slamming" | "chargeTelegraph" | "charging"
           phaseUntil: number; slamCount: number; nextPatternAt: number
           chargeDir: Vec2; engaged: boolean }
  projectile?: { damage: number; dir: Vec2; speed: number; diesAt: number }
  lootDrop?: { item: ItemInstance }
  xpReward?: number
  model?: { kind: ModelKind; object?: THREE.Object3D; rarity?: Rarity }
}

export const createWorld = () => new World<Entity>()
```

```ts
// Resources (core/world.ts에 함께 정의)
export interface InputEventQueue {
  clicks: { ndcX: number; ndcY: number; button: 0 | 2 }[]
  dashQueued: boolean
  pointer: { ndcX: number; ndcY: number }
  toggleInventory: boolean
}
export interface Resources {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer
  input: InputEventQueue
  time: { now: number }          // 논리 시간(초), 고정 스텝 누적
  rng: () => number              // [0,1)
  map: DungeonMap                // Task 3
  hud: Hud                       // Task 7 (그 전에는 부분 구현)
  flags: { bossDefeated: boolean }
}
```

시스템 시그니처(전 태스크 공통): `export function xxxSystem(world: World<Entity>, res: Resources, dt: number): void`

`main.ts`의 고정 스텝당 시스템 실행 순서:
`input → ai → boss → skills → movement → combat → loot → progression → animation` / 렌더 프레임마다 `render`.

---

### Task 1: 프로젝트 스캐폴드

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `index.html`, `src/style.css`, `src/main.ts`(임시)

**Interfaces:**
- Produces: `npm run dev`(Vite), `npm test`(Vitest run), `#hud` DOM 컨테이너, `#game` 캔버스 마운트 지점

- [ ] **Step 1: 파일 작성**

`package.json`:
```json
{
  "name": "arpg-prototype",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

의존성 설치(정확 버전은 설치 시점 최신을 따름):
```bash
npm i three miniplex
npm i -D vite typescript vitest @types/three
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "types": ["vite/client"], "skipLibCheck": true, "noEmit": true
  },
  "include": ["src", "tests"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from "vite"
export default defineConfig({ server: { port: 5173 } })
```

`index.html` — `<div id="game">` 캔버스 마운트, `<div id="hud">` 내부에 `#hp-orb`, `#rage-orb`, `#skillbar`(슬롯 3개), `#inventory`(hidden), `#overlay`(사망/클리어 메시지, hidden), `#floating-layer`(데미지 텍스트), `#nameplates`(드롭 이름표/체력바). `src/style.css`에 다크 테마 + 비네트(radial-gradient 고정 오버레이) + 구슬(원형, 아래에서 차오르는 fill) 스타일.

`src/main.ts`(임시): `console.log("boot")` 만.

`.gitignore`: `node_modules/`, `dist/`.

- [ ] **Step 2: 검증**

Run: `npm i && npm i three miniplex && npm i -D vite typescript vitest @types/three && npm test`
Expected: vitest "no test files found" 정상 종료(또는 빈 통과). `npm run dev` 기동 후 HTTP 200.

---

### Task 2: 코어 — Entity 타입, World, 고정 스텝 루프

**Files:**
- Create: `src/core/world.ts`(위 공유 타입 전체), `src/core/loop.ts`
- Test: `tests/loop.test.ts`

**Interfaces:**
- Produces: `createWorld()`, `Entity`, `Resources`, `createLoop(logic: (dt:number)=>void, render: ()=>void): { start(): void }` — 내부 고정 스텝 accumulator는 `stepAccumulator` 순수 함수로 분리

- [ ] **Step 1: 실패 테스트 작성** — accumulator 로직

```ts
// tests/loop.test.ts
import { describe, it, expect } from "vitest"
import { stepAccumulator, STEP } from "../src/core/loop"

describe("stepAccumulator", () => {
  it("누적 시간에서 고정 스텝 횟수를 뽑아낸다", () => {
    // 0.05s 경과 → 60Hz(≈0.01667s) 스텝 3회, 나머지 잔여
    const r = stepAccumulator(0.05)
    expect(r.steps).toBe(3)
    expect(r.remainder).toBeCloseTo(0.05 - 3 * STEP, 10)
  })
  it("프레임 스파이크는 최대 5스텝으로 클램프", () => {
    expect(stepAccumulator(1.0).steps).toBe(5)
  })
})
```

- [ ] **Step 2: 실행 → FAIL 확인** (`npm test`)

- [ ] **Step 3: 구현**

```ts
// src/core/loop.ts
export const STEP = 1 / 60
const MAX_STEPS = 5

export function stepAccumulator(acc: number): { steps: number; remainder: number } {
  let steps = Math.floor(acc / STEP)
  if (steps > MAX_STEPS) { steps = MAX_STEPS; acc = STEP * MAX_STEPS }
  return { steps, remainder: acc - steps * STEP }
}

export function createLoop(logic: (dt: number) => void, render: () => void) {
  let acc = 0, last = performance.now()
  const frame = () => {
    const now = performance.now()
    acc += Math.min((now - last) / 1000, 0.25); last = now
    const { steps, remainder } = stepAccumulator(acc)
    for (let i = 0; i < steps; i++) logic(STEP)
    acc = remainder
    render()
    requestAnimationFrame(frame)
  }
  return { start: () => requestAnimationFrame(frame) }
}
```

`src/core/world.ts`는 상단 "공유 타입" 블록 그대로 작성.

- [ ] **Step 4: 실행 → PASS 확인** (`npm test`)

---

### Task 3: 던전 맵 데이터와 통행 판정

**Files:**
- Create: `src/content/map.ts`
- Test: `tests/map.test.ts`

**Interfaces:**
- Produces: `TILE = 2`, `parseMap(layout: string[]): DungeonMap`, `DUNGEON: DungeonMap`,
  `DungeonMap = { cols, rows, walls: boolean[][], playerSpawn: Vec2, spawns: { kind: EnemyKind; x: number; z: number }[], bossSpawn: Vec2 }`,
  `isWalkable(map, wx, wz): boolean` (월드좌표), `worldToCell(w): number`
- 좌표계: 셀 (c,r) 중심 = 월드 `(c*TILE, r*TILE)`. 문자: `#`벽, `.`바닥, `P`플레이어, `w`워리어, `a`아처, `B`보스

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/map.test.ts
import { describe, it, expect } from "vitest"
import { parseMap, isWalkable, TILE, DUNGEON } from "../src/content/map"

const MINI = ["#####", "#P.w#", "#..B#", "#####"]

describe("parseMap", () => {
  const m = parseMap(MINI)
  it("스폰 추출", () => {
    expect(m.playerSpawn).toEqual({ x: 1 * TILE, z: 1 * TILE })
    expect(m.spawns).toEqual([{ kind: "warrior", x: 3 * TILE, z: 1 * TILE }])
    expect(m.bossSpawn).toEqual({ x: 3 * TILE, z: 2 * TILE })
  })
  it("통행 판정: 벽/바닥/경계 밖", () => {
    expect(isWalkable(m, 1 * TILE, 1 * TILE)).toBe(true)
    expect(isWalkable(m, 0, 0)).toBe(false)
    expect(isWalkable(m, -999, 0)).toBe(false)
  })
})

describe("DUNGEON", () => {
  it("실전 맵은 플레이어/보스/적 스폰을 모두 가진다", () => {
    expect(DUNGEON.playerSpawn).toBeDefined()
    expect(DUNGEON.bossSpawn).toBeDefined()
    expect(DUNGEON.spawns.filter(s => s.kind === "warrior").length).toBeGreaterThanOrEqual(4)
    expect(DUNGEON.spawns.filter(s => s.kind === "archer").length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: 실행 → FAIL 확인**

- [ ] **Step 3: 구현** — `parseMap`은 문자열 격자를 순회해 walls/스폰 수집. `isWalkable`은 `worldToCell = Math.round(w / TILE)` 후 경계·벽 체크. `DUNGEON`은 아래 레이아웃(입구홀 → 복도 → 전투방3 → 대형 보스방, 약 38×26):

```ts
export const DUNGEON = parseMap([
  "######################################",
  "#....................................#",  // (외곽 전체 벽, 아래는 구조)
  "#..PP....#####....w..w...#####.......#",
  "#........#...#..........#...#...a...#",
  "#........#...####..w..###...#.......#",
  "#..입구홀..........................#",
  // 실제 구현 시 아스키 레이아웃을 손으로 정교화: 입구홀(P), 복도,
  // 전투방1(w×2), 전투방2(w×2+a), 전투방3(w×1+a×2), 최심부 보스방(B, 12×10 규모)
  "######################################",
])
```
(레이아웃 문자열은 구현 시점에 40×28 내외로 완성한다 — 요건: 위 테스트의 스폰 수 충족, 모든 방이 복도로 연결, 보스방은 가장 안쪽.)

- [ ] **Step 4: 실행 → PASS 확인**

---

### Task 4: 렌더 기초 — 씬/카메라/조명/맵 메시

**Files:**
- Create: `src/systems/render.ts`
- Modify: `src/main.ts` (부트스트랩 전체 작성)

**Interfaces:**
- Produces: `initRender(mount: HTMLElement): { scene, camera, renderer }`,
  `buildMapMeshes(scene, map): void`, `renderSystem(world, res): void` (model.object 없는 엔티티에 프리미티브 생성·부착, transform→Object3D 동기화, 카메라 추적),
  `CAMERA_OFFSET = { x: 0, y: 14, z: 9 }` (약 57° 내려다봄, lookAt 플레이어)
- Consumes: `DUNGEON`, `createWorld`, `createLoop`

- [ ] **Step 1: 구현**

`initRender`: WebGLRenderer(antialias, shadowMap off), PerspectiveCamera(fov 45), `scene.fog = new THREE.Fog(0x07070c, 18, 46)`, background 동일색. 조명: `AmbientLight(0x2a2a3a, 0.7)` + `DirectionalLight(0x8888aa, 0.35)` + 플레이어 추적 `PointLight(0xffa050, 60, 20)`(render 시스템이 매 프레임 플레이어 위치+y2로 이동).

`buildMapMeshes`: walls 격자를 순회, 바닥은 병합된 `PlaneGeometry`(짙은 회갈색 `MeshStandardMaterial 0x4a4038, roughness 1`), 벽 셀은 `BoxGeometry(TILE, 3, TILE)`(`0x2b2b33`) — `InstancedMesh`로 1드로우콜.

`renderSystem`: `world.with("transform", "model")` 순회. `model.object`가 없으면 `createPrimitive(kind, rarity)`로 생성 후 scene.add:
- player: CapsuleGeometry(0.45, 0.9) 강철색 + 오른손 위치 박스 검
- warrior: Capsule 0.4 뼈색(0xd8d0c0), archer: 동일+갈색 활 토러스, boss: Capsule 0.9×2.2 진홍(0x7a1818)
- projectile: Sphere 0.15 (0xffcc66, emissive), loot: Octahedron 0.3 + 등급색 emissive + 상하 부유/회전 애니메이션은 여기서 시간 기반 처리
매 프레임 `object.position.set(p.x, 높이보정, p.z)`, `object.rotation.y = yaw`. `dead` 컴포넌트가 있으면 서서히 침하+투명화. 카메라: `camera.position = playerPos + CAMERA_OFFSET`로 lerp(0.1), lookAt(playerPos).

`main.ts`: world/resources 구성 → 플레이어 엔티티 스폰(`DUNGEON.playerSpawn`, model:"player", health 100/100, speed 6, radius 0.45, attack{damage:12, range:1.8, arc:1.75, cooldown:0.5, readyAt:0}, player 컴포넌트 초기값) → `createLoop(logicStep, () => { renderSystem(...); renderer.render(...) })`. logicStep은 시스템들을 순서대로 호출하고 `res.time.now += dt`. 아직 없는 시스템 호출부는 이 태스크에서는 주석이 아니라 **추가하지 않는다**(태스크마다 한 줄씩 추가).

- [ ] **Step 2: 스모크 체크**

Run: `npm run dev` 후 브라우저 확인.
Expected: 어두운 던전 벽/바닥이 보이고, 입구에 플레이어 캡슐이 서 있으며 콘솔 에러 0건.

---

### Task 5: 입력과 이동 — 클릭 이동, 충돌, 카메라 추적

**Files:**
- Create: `src/systems/input.ts`, `src/systems/movement.ts`
- Modify: `src/main.ts` (시스템 등록, input 이벤트 바인딩)
- Test: `tests/movement.test.ts`

**Interfaces:**
- Produces:
  - `bindInput(dom: HTMLElement): InputEventQueue` — click/contextmenu(기본동작 차단)/keydown(Space, KeyI) 수집
  - `inputSystem(world, res)` — 클릭 NDC → Raycaster로 적 히트 시 `attackIntent`, 지면(y=0 평면) 히트 시 `moveTarget` 설정. 우클릭 → `skillIntent:{skill:"whirlwind"}`, Space → `skillIntent:{skill:"dash", point: 포인터 지면점}` (skills 시스템은 Task 8 전까지 intent를 소비만 하고 무시)
  - `movementSystem(world, res, dt)` — moveTarget으로 스텝 이동, 도착 반경 0.15에서 moveTarget 제거. knockback 처리. 이후 벽 충돌·유닛 분리.
  - 순수 헬퍼: `stepToward(pos: Vec2, target: Vec2, dist: number): Vec2`,
    `moveWithWalls(map, pos: Vec2, delta: Vec2, radius: number): Vec2` (x축, z축 분리 시도 — 벽 슬라이드),
    `separate(a: Vec2, ra: number, b: Vec2, rb: number): Vec2` (a가 밀려날 오프셋, 겹침 없으면 0벡터)
- Consumes: `isWalkable`, Entity의 `transform/speed/radius/moveTarget/knockback`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/movement.test.ts
import { describe, it, expect } from "vitest"
import { stepToward, moveWithWalls, separate } from "../src/systems/movement"
import { parseMap, TILE } from "../src/content/map"

describe("stepToward", () => {
  it("목표 방향으로 정확히 dist만큼 이동", () => {
    const p = stepToward({ x: 0, z: 0 }, { x: 10, z: 0 }, 1)
    expect(p).toEqual({ x: 1, z: 0 })
  })
  it("남은 거리가 dist보다 짧으면 목표에 스냅", () => {
    expect(stepToward({ x: 0, z: 0 }, { x: 0.5, z: 0 }, 1)).toEqual({ x: 0.5, z: 0 })
  })
})

describe("moveWithWalls", () => {
  const m = parseMap(["#####", "#P..#", "#####"])
  it("벽으로 파고들지 못하고, 평행 성분은 유지(슬라이드)", () => {
    const start = { x: 1 * TILE, z: 1 * TILE }
    const out = moveWithWalls(m, start, { x: 0.5, z: -5 }, 0.45) // 위쪽은 벽
    expect(out.x).toBeCloseTo(start.x + 0.5)
    expect(out.z).toBe(start.z)
  })
})

describe("separate", () => {
  it("겹친 두 원에서 a를 밀어낼 오프셋 반환", () => {
    const off = separate({ x: 0, z: 0 }, 0.5, { x: 0.6, z: 0 }, 0.5)
    expect(off.x).toBeCloseTo(-0.4, 5)
    expect(off.z).toBeCloseTo(0)
  })
  it("안 겹치면 0", () => {
    expect(separate({ x: 0, z: 0 }, 0.4, { x: 2, z: 0 }, 0.4)).toEqual({ x: 0, z: 0 })
  })
})
```

- [ ] **Step 2: 실행 → FAIL 확인**

- [ ] **Step 3: 구현**

`moveWithWalls`: 후보 위치 x축만 적용해 `radius` 만큼 4방향 샘플(`pos±radius`)이 모두 walkable하면 채택, z축 동일 반복. `movementSystem`: knockback 활성 시(`time.now < until`) knockback 이동(벽 충돌 적용) 우선, 아니면 moveTarget 이동. yaw는 이동 방향으로 갱신(`Math.atan2(dx, dz)`). 유닛 분리는 살아있는(`!dead`) transform+radius 엔티티 쌍에 `separate` 적용(양쪽 절반씩). `inputSystem`: Raycaster는 model.object 리스트 대상 intersect → 최상위 엔티티 매핑(Object3D.userData.entity에 저장, render 시스템이 생성 시 기록). 적 클릭 판별은 `entity.enemy` 존재 여부.

- [ ] **Step 4: 실행 → PASS 확인** (`npm test`)

- [ ] **Step 5: 스모크 체크**

Expected: 바닥 클릭 시 플레이어가 그 지점으로 이동, 벽에 막히고 미끄러짐, 카메라가 따라옴.

---

### Task 6: 적 콘텐츠와 AI 상태머신

**Files:**
- Create: `src/content/enemies.ts`, `src/systems/ai.ts`
- Modify: `src/main.ts` (스폰 루프, aiSystem 등록)
- Test: `tests/ai.test.ts`

**Interfaces:**
- Produces:
  - `ENEMY_DEFS: Record<EnemyKind, { hp, damage, speed, radius, aggroRange, attackRange, attackCooldown, xp, leashRange, preferredRange? }>` — warrior{40,8,4,0.4,8,1.6,1.2,20,14}, archer{25,6,3.5,0.4,10,8,2.0,25,14, preferredRange:7}, boss{400,15,3,0.9,10,2.2,1.5,200,999}
  - `spawnEnemy(world, kind, x, z): Entity` — enemy/transform/health/attack/model 등 조립
  - `aiTransition(state: AIState, ctx: { distToPlayer: number; distToHome: number; def: 위 정의; playerAlive: boolean }): AIState` — 순수 함수
  - `aiSystem(world, res, dt)` — 전이 적용 + 상태별 행동: chase→moveTarget=플레이어(아처는 preferredRange 유지: 멀면 접근, 4 미만이면 후퇴점), attack→정지·yaw 조준·readyAt 경과 시 공격 실행(공격 자체는 combat의 `meleeStrike`/`fireProjectile` 호출 — Task 7에서 제공, 이 태스크에서는 콘솔 없는 no-op 스텁 함수를 combat.ts에 먼저 만들어 둔다), return→home으로 이동+도착 시 idle, HP 전체 회복
- Consumes: `stepToward` 등 movement 헬퍼, `DUNGEON.spawns`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/ai.test.ts
import { describe, it, expect } from "vitest"
import { aiTransition } from "../src/systems/ai"
import { ENEMY_DEFS } from "../src/content/enemies"

const def = ENEMY_DEFS.warrior
const base = { distToHome: 0, playerAlive: true, def }

describe("aiTransition (warrior)", () => {
  it("idle → chase: 어그로 범위 진입", () =>
    expect(aiTransition("idle", { ...base, distToPlayer: 7 })).toBe("chase"))
  it("idle 유지: 범위 밖", () =>
    expect(aiTransition("idle", { ...base, distToPlayer: 9 })).toBe("idle"))
  it("chase → attack: 공격 사거리 진입", () =>
    expect(aiTransition("chase", { ...base, distToPlayer: 1.5 })).toBe("attack"))
  it("chase → return: 리쉬 초과", () =>
    expect(aiTransition("chase", { ...base, distToPlayer: 20, distToHome: 15 })).toBe("return"))
  it("attack → chase: 사거리 이탈(x1.3 히스테리시스)", () =>
    expect(aiTransition("attack", { ...base, distToPlayer: 2.2 })).toBe("chase"))
  it("return → idle: 귀환 완료", () =>
    expect(aiTransition("return", { ...base, distToPlayer: 30, distToHome: 0.3 })).toBe("idle"))
  it("플레이어 사망 시 항상 return/idle", () =>
    expect(aiTransition("chase", { ...base, distToPlayer: 2, playerAlive: false })).toBe("return"))
})
```

- [ ] **Step 2: 실행 → FAIL 확인**
- [ ] **Step 3: 구현** — 전이표 그대로. `aiSystem`은 `world.with("enemy", "transform", "health")` 순회, dead 제외.
- [ ] **Step 4: 실행 → PASS 확인**
- [ ] **Step 5: 스모크 체크** — 적들이 배치되어 있고, 접근하면 추적해오며, 멀리 도망가면 제자리로 돌아간다.

---

### Task 7: 전투 — 기본 공격, 데미지, 사망, 투사체, HUD 기본

**Files:**
- Create: `src/systems/combat.ts`, `src/ui/hud.ts`
- Modify: `src/main.ts`, `src/systems/ai.ts` (스텁 → 실제 호출)
- Test: `tests/combat.test.ts`

**Interfaces:**
- Produces:
  - 순수: `inMeleeArc(origin: Vec2, yaw: number, target: Vec2, range: number, arc: number, targetRadius: number): boolean`,
    `applyDamage(health, amount): { died: boolean }`
  - `meleeStrike(world, res, attacker, targets: Iterable<Entity>): void` — 부채꼴 내 대상에 데미지, hitFlash 부여, 플레이어 가해 시 분노 +10, 사망 처리(dead 부여, xp/loot 이벤트 훅 호출)
  - `fireProjectile(world, attacker, targetPos: Vec2): void` — projectile 엔티티 생성
  - `combatSystem(world, res, dt)` — ① 플레이어 attackIntent 처리(사거리 밖이면 moveTarget 추적, 안이면 readyAt 체크 후 meleeStrike) ② 투사체 비행/명중(원형 충돌, 벽 충돌 소멸, diesAt) ③ dead 엔티티 1.2초 후 world.remove ④ 플레이어 사망 시 오버레이 표시 후 3초 뒤 입구 부활(HP 전체, 분노 0)
  - `Hud`: `createHud(): Hud` — `setHp(cur,max)`, `setRage(cur,max)`, `showDamage(worldPos, amount, opts)`(render가 투영좌표 계산해 호출), `setOverlay(text|null)`, `setSkillCooldown(slot, remain01)`, 인벤토리 API는 Task 9에서 확장
- Consumes: `ENEMY_DEFS`, movement 헬퍼, render의 투영(`camera`)

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/combat.test.ts
import { describe, it, expect } from "vitest"
import { inMeleeArc, applyDamage } from "../src/systems/combat"

describe("inMeleeArc", () => {
  // yaw=0 은 +z 방향을 향한다 (atan2(dx,dz) 규약)
  it("정면 사거리 내 → true", () =>
    expect(inMeleeArc({ x: 0, z: 0 }, 0, { x: 0, z: 1.5 }, 1.8, 1.75, 0.4)).toBe(true))
  it("등 뒤 → false", () =>
    expect(inMeleeArc({ x: 0, z: 0 }, 0, { x: 0, z: -1.5 }, 1.8, 1.75, 0.4)).toBe(false))
  it("사거리 밖 → false (반지름 보정 포함)", () =>
    expect(inMeleeArc({ x: 0, z: 0 }, 0, { x: 0, z: 2.5 }, 1.8, 1.75, 0.4)).toBe(false))
  it("타겟 반지름 덕에 살짝 먼 것도 히트", () =>
    expect(inMeleeArc({ x: 0, z: 0 }, 0, { x: 0, z: 2.1 }, 1.8, 1.75, 0.4)).toBe(true))
  it("부채꼴 경계각 바로 안 → true", () => {
    const a = 1.75 / 2 - 0.05
    expect(inMeleeArc({ x: 0, z: 0 }, 0, { x: Math.sin(a) * 1.2, z: Math.cos(a) * 1.2 }, 1.8, 1.75, 0.4)).toBe(true)
  })
})

describe("applyDamage", () => {
  it("체력 감소, 생존", () => {
    const h = { current: 50, max: 50 }
    expect(applyDamage(h, 20).died).toBe(false)
    expect(h.current).toBe(30)
  })
  it("0 이하로 내려가면 died, 음수 클램프", () => {
    const h = { current: 10, max: 50 }
    expect(applyDamage(h, 25).died).toBe(true)
    expect(h.current).toBe(0)
  })
})
```

- [ ] **Step 2: 실행 → FAIL 확인**
- [ ] **Step 3: 구현** — `inMeleeArc`: 거리 ≤ range+targetRadius && 방향각-yaw 차(±π 정규화) ≤ arc/2. 사망 처리 공통 함수 `kill(world, res, entity)`: `addComponent(dead)`, moveTarget/attackIntent 제거, xpReward → progression 큐(res 경유가 아니라 player 컴포넌트에 직접 xp 가산은 Task 10에서 — 이 태스크에서는 xpReward를 dead 엔티티에 남겨두고 progression 시스템이 수거), lootDrop 생성은 Task 9의 `rollDrop` 훅(이 태스크에서는 미호출). hitFlash는 render 시스템에서 emissive 점멸로 반영(render.ts에 6줄 추가). HUD: hp/rage 구슬은 CSS `height %` fill, 데미지 텍스트는 pooled div가 0.7s 떠오르며 소멸.
- [ ] **Step 4: 실행 → PASS 확인**
- [ ] **Step 5: 스모크 체크** — 적 클릭 → 접근 → 자동 기본공격, 데미지 숫자·히트플래시, 적 사망·소멸. 워리어에게 맞으면 HP 구슬 감소, 아처가 투사체 발사. 0 되면 사망 오버레이 후 입구 부활.

---

### Task 8: 스킬 3종 — 분노, 쿨다운, 회전베기, 돌진

**Files:**
- Create: `src/content/skills.ts`, `src/systems/skills.ts`
- Modify: `src/main.ts`, `src/ui/hud.ts` (스킬바 쿨다운/자원 표시)
- Test: `tests/skills.test.ts`

**Interfaces:**
- Produces:
  - `SKILLS = { whirlwind: { rageCost: 25, damage: 20, radius: 3 }, dash: { cooldown: 5, damage: 15, distance: 6, speed: 24, knockback: { speed: 12, duration: 0.18 } } }`
  - 순수: `canCast(skill: "whirlwind"|"dash", player: PlayerComp, now: number): boolean`,
    `spendCost(skill, player, now): void` (분노 차감 또는 readyAt 갱신)
  - `skillsSystem(world, res, dt)` — skillIntent 소비: whirlwind→반경 내 전체 적 데미지+미니 넉백, 시각효과(반투명 링 메시 0.25s), dash→플레이어에 `dashing:{dir, until}` 상태 부여(스킬 시스템 내부 Set으로 관리하지 말고 knockback 컴포넌트 재사용: dir=클릭방향, speed=24, until=now+distance/speed), 경로상 적에게 1회 데미지+knockback
- Consumes: combat의 `applyDamage`/`kill`, movement의 knockback 처리(이미 Task 5에서 구현됨)

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/skills.test.ts
import { describe, it, expect } from "vitest"
import { canCast, spendCost, SKILLS } from "../src/systems/skills"
import type { PlayerComp } from "../src/core/world"

const mkPlayer = (over: Partial<PlayerComp> = {}): PlayerComp => ({
  rage: 30, maxRage: 100, level: 1, xp: 0,
  baseAttack: 12, baseMaxHp: 100, baseSpeed: 6,
  attackPower: 12, moveSpeed: 6,
  inventory: [], equipment: {}, cooldowns: { dash: 0 }, ...over,
})

describe("whirlwind 자원", () => {
  it("분노 충분 → 시전 가능, 차감", () => {
    const p = mkPlayer({ rage: 30 })
    expect(canCast("whirlwind", p, 0)).toBe(true)
    spendCost("whirlwind", p, 0)
    expect(p.rage).toBe(30 - SKILLS.whirlwind.rageCost)
  })
  it("분노 부족 → 불가", () =>
    expect(canCast("whirlwind", mkPlayer({ rage: 10 }), 0)).toBe(false))
})

describe("dash 쿨다운", () => {
  it("준비됨 → 시전 후 readyAt = now + cooldown", () => {
    const p = mkPlayer()
    expect(canCast("dash", p, 10)).toBe(true)
    spendCost("dash", p, 10)
    expect(p.cooldowns.dash).toBe(10 + SKILLS.dash.cooldown)
    expect(canCast("dash", p, 12)).toBe(false)
    expect(canCast("dash", p, 15.1)).toBe(true)
  })
})
```

- [ ] **Step 2: 실행 → FAIL 확인**
- [ ] **Step 3: 구현** — 위 시그니처대로. 스킬바 UI: 3슬롯(좌클릭/우클릭/Space 아이콘 텍스트), dash 슬롯은 남은 쿨다운 비율만큼 어두운 오버레이(`setSkillCooldown`), whirlwind 슬롯은 분노 부족 시 반투명.
- [ ] **Step 4: 실행 → PASS 확인**
- [ ] **Step 5: 스모크 체크** — 기본공격으로 분노 충전 → 우클릭 회전베기로 다수 적 타격, Space 돌진으로 적 관통+넉백, 스킬바에 쿨다운 표시.

---

### Task 9: 아이템/루트 — 드롭, 줍기, 인벤토리, 장착

**Files:**
- Create: `src/content/items.ts`, `src/systems/loot.ts`
- Modify: `src/systems/combat.ts` (`kill`에서 `rollDrop` 호출), `src/ui/hud.ts` (인벤토리 패널·이름표), `src/main.ts`
- Test: `tests/items.test.ts`

**Interfaces:**
- Produces:
  - `rollRarity(rng, opts?: { guaranteed?: Rarity }): Rarity` — common 60% / magic 30% / rare 10%
  - `rollItem(rng, level: number, opts?): ItemInstance` — 슬롯 균등, 기본스탯 슬롯별(weapon→attackPower 5+2×level±20%, armor→maxHp 12+4×level±20%, ring→둘 중 하나 절반 값), 접사 common 0/magic 1/rare 2개(풀: attackPower +2..6, maxHp +5..20, moveSpeedPct +5..10), 이름은 "등급 수식어 + 슬롯명"
  - `DROP_CHANCE = { warrior: 0.25, archer: 0.3, boss: 1.0 }`, `rollDrop(world, res, enemy): void` — 보스는 `guaranteed:"rare"`
  - `computeDerived(player: PlayerComp): { attackPower: number; maxHp: number; moveSpeed: number }` — base + 레벨 보정(Task 10의 수치) + 장비 base/affix 합산, moveSpeedPct는 곱연산
  - `applyEquip(player, item): ItemInstance | undefined` — 같은 슬롯 기존 장비를 인벤토리로, 새 장비 장착, 반환=교체된 것
  - `lootSystem(world, res, dt)` — lootDrop 엔티티 클릭(attackIntent 대신 input에서 loot 클릭 판별 추가) 또는 반경 1.2 접근 시 자동 줍기 → inventory push(최대 20), 이름표는 render가 투영좌표로 hud에 전달
- Consumes: `Rarity/Slot/ItemInstance/PlayerComp`, seeded rng

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/items.test.ts
import { describe, it, expect } from "vitest"
import { rollRarity, rollItem, computeDerived, applyEquip } from "../src/content/items"
import type { PlayerComp } from "../src/core/world"

// mulberry32 — 테스트 재현용 시드 RNG (구현은 src/core/rng.ts로 두고 여기서 import해도 됨)
const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe("rollRarity", () => {
  it("guaranteed 옵션은 항상 그 등급", () =>
    expect(rollRarity(mulberry32(1), { guaranteed: "rare" })).toBe("rare"))
  it("1000회 분포가 대략 60/30/10", () => {
    const rng = mulberry32(42)
    const c = { common: 0, magic: 0, rare: 0 }
    for (let i = 0; i < 1000; i++) c[rollRarity(rng)]++
    expect(c.common).toBeGreaterThan(500); expect(c.rare).toBeLessThan(200)
  })
})

describe("rollItem", () => {
  it("등급별 접사 개수: common 0 / magic 1 / rare 2", () => {
    const rng = mulberry32(7)
    expect(rollItem(rng, 1, { guaranteed: "common" }).affixes.length).toBe(0)
    expect(rollItem(rng, 1, { guaranteed: "magic" }).affixes.length).toBe(1)
    expect(rollItem(rng, 1, { guaranteed: "rare" }).affixes.length).toBe(2)
  })
})

const mkPlayer = (): PlayerComp => ({
  rage: 0, maxRage: 100, level: 1, xp: 0,
  baseAttack: 12, baseMaxHp: 100, baseSpeed: 6,
  attackPower: 12, moveSpeed: 6, inventory: [], equipment: {}, cooldowns: { dash: 0 },
})

describe("computeDerived / applyEquip", () => {
  it("무기 장착 시 공격력 = base + 무기 base + 접사 합", () => {
    const p = mkPlayer()
    p.equipment.weapon = {
      id: 1, name: "t", slot: "weapon", rarity: "magic",
      base: { stat: "attackPower", value: 7 },
      affixes: [{ stat: "attackPower", value: 3 }],
    }
    expect(computeDerived(p).attackPower).toBe(12 + 7 + 3)
  })
  it("moveSpeedPct는 곱연산", () => {
    const p = mkPlayer()
    p.equipment.ring = {
      id: 2, name: "t", slot: "ring", rarity: "magic",
      base: { stat: "maxHp", value: 5 },
      affixes: [{ stat: "moveSpeedPct", value: 10 }],
    }
    expect(computeDerived(p).moveSpeed).toBeCloseTo(6 * 1.1)
  })
  it("applyEquip은 같은 슬롯을 교체하고 기존 장비를 반환", () => {
    const p = mkPlayer()
    const a = { id: 1, name: "a", slot: "weapon" as const, rarity: "common" as const, base: { stat: "attackPower" as const, value: 5 }, affixes: [] }
    const b = { ...a, id: 2, name: "b" }
    p.inventory = [a, b]
    expect(applyEquip(p, a)).toBeUndefined()
    expect(applyEquip(p, b)).toBe(a)
    expect(p.equipment.weapon).toBe(b)
    expect(p.inventory).toContain(a)
  })
})
```

- [ ] **Step 2: 실행 → FAIL 확인**
- [ ] **Step 3: 구현** — `src/core/rng.ts`에 mulberry32 두고 게임은 `Date.now()` 시드. 드롭 엔티티: `{ transform, lootDrop, model:{kind:"loot", rarity} }` + 등급색 빛기둥(CylinderGeometry, additive blending, 반투명). 인벤토리 UI: `I` 토글 그리드, 아이템 셀 클릭→장착(computeDerived 재계산→player.attackPower/moveSpeed 갱신, maxHp 변화는 비율 유지), 장착칸 표시, 등급색 테두리, hover 툴팁(스탯 나열).
- [ ] **Step 4: 실행 → PASS 확인**
- [ ] **Step 5: 스모크 체크** — 적 처치 시 확률 드롭(빛기둥+이름표), 접근/클릭 줍기, `I` 인벤토리에서 장착 시 스탯 변화 체감(툴팁 수치 확인).

---

### Task 10: 성장 — XP, 레벨업

**Files:**
- Create: `src/systems/progression.ts`
- Modify: `src/ui/hud.ts` (XP 바/레벨 표시), `src/main.ts`
- Test: `tests/progression.test.ts`

**Interfaces:**
- Produces:
  - `xpForLevel(level: number): number` = `Math.floor(100 * Math.pow(level, 1.5))` (level→level+1 필요량)
  - `applyXp(player: PlayerComp, amount: number): { levelsGained: number }` — 연쇄 레벨업 처리, 레벨당 baseAttack +2, baseMaxHp +15
  - `progressionSystem(world, res, dt)` — dead+xpReward 엔티티에서 1회 수거(xpReward 컴포넌트 제거로 중복 방지), 레벨업 시: computeDerived 재계산, HP 전체 회복, 황금 링 이펙트+화면 플래시, hud 갱신
- Consumes: `computeDerived`(Task 9), `kill`이 남긴 dead+xpReward

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/progression.test.ts
import { describe, it, expect } from "vitest"
import { xpForLevel, applyXp } from "../src/systems/progression"

describe("xpForLevel", () => {
  it("지수 곡선", () => {
    expect(xpForLevel(1)).toBe(100)
    expect(xpForLevel(4)).toBe(800)
  })
})

describe("applyXp", () => {
  const mk = () => ({
    rage: 0, maxRage: 100, level: 1, xp: 0,
    baseAttack: 12, baseMaxHp: 100, baseSpeed: 6,
    attackPower: 12, moveSpeed: 6, inventory: [], equipment: {}, cooldowns: { dash: 0 },
  })
  it("미달 시 xp만 누적", () => {
    const p = mk()
    expect(applyXp(p, 50).levelsGained).toBe(0)
    expect(p.xp).toBe(50); expect(p.level).toBe(1)
  })
  it("초과분 이월 + 스탯 상승", () => {
    const p = mk()
    expect(applyXp(p, 120).levelsGained).toBe(1)
    expect(p.level).toBe(2); expect(p.xp).toBe(20)
    expect(p.baseAttack).toBe(14); expect(p.baseMaxHp).toBe(115)
  })
  it("한 번에 여러 레벨", () => {
    const p = mk()
    expect(applyXp(p, 100 + 283 + 10).levelsGained).toBe(2) // L1→2:100, L2→3:282.8→282
    expect(p.level).toBe(3)
  })
})
```
(주의: `xpForLevel(2)`=`floor(100·2^1.5)`=282 — 세 번째 테스트의 기대값은 구현 후 실제 곡선값으로 확정하되 floor 규약을 테스트에 명시)

- [ ] **Step 2: 실행 → FAIL 확인**
- [ ] **Step 3: 구현** — 위 그대로. HUD에 하단 XP 바(현재/필요), 레벨 숫자.
- [ ] **Step 4: 실행 → PASS 확인**
- [ ] **Step 5: 스모크 체크** — 적 처치로 XP 바 증가, 레벨업 시 회복+이펙트+공격력 상승 체감.

---

### Task 11: 보스 — 패턴 2종, 클리어

**Files:**
- Create: `src/systems/boss.ts`
- Modify: `src/main.ts` (보스 스폰, bossSystem 등록), `src/ui/hud.ts` (보스 체력바 상단 표시)
- Test: `tests/boss.test.ts`

**Interfaces:**
- Produces:
  - `BOSS = { slam: { telegraph: 0.8, radius: 3.5, damage: 25, count: 3, interval: 1.2 }, charge: { telegraph: 1.0, speed: 18, halfWidth: 1.2, damage: 30, maxDist: 12 }, patternCooldown: 4 }`
  - 순수: `nextBossPhase(boss: NonNullable<Entity["boss"]>, now: number, rngPick: number): Entity["boss"]["phase"] | null` — null이면 유지. idle에서 nextPatternAt 경과 시 rngPick<0.5→"slamTelegraph" else "chargeTelegraph"; telegraph 만료→실행 페이즈; slam은 count 소진까지 반복.
  - `pointInChargePath(origin: Vec2, dir: Vec2, halfWidth: number, maxDist: number, p: Vec2, pRadius: number): boolean`
  - `bossSystem(world, res, dt)` — engaged 전까지 idle(플레이어 거리<10 시 engaged+보스 체력바 표시). telegraph 동안 바닥 표시 메시(slam: 붉은 원, charge: 붉은 사각 경로) 생성/제거. slam 발동 순간 반경 내 플레이어 피해. charge는 knockback 컴포넌트로 자체 돌진, 경로 판정 1회 피해. 페이즈 사이 chase+접촉 근접공격(attack 컴포넌트 재사용). 사망 시: `rollDrop(guaranteed rare)`+`res.flags.bossDefeated=true`+오버레이 "던전 클리어!"
- Consumes: `ENEMY_DEFS.boss`, `applyDamage/kill`, `rollDrop`, knockback 이동

- [ ] **Step 1: 실패 테스트 작성**

```ts
// tests/boss.test.ts
import { describe, it, expect } from "vitest"
import { nextBossPhase, pointInChargePath, BOSS } from "../src/systems/boss"

const mkBoss = (over = {}) => ({
  phase: "idle" as const, phaseUntil: 0, slamCount: 0,
  nextPatternAt: 10, chargeDir: { x: 0, z: 1 }, engaged: true, ...over,
})

describe("nextBossPhase", () => {
  it("쿨다운 전에는 idle 유지", () =>
    expect(nextBossPhase(mkBoss(), 5, 0.3)).toBeNull())
  it("쿨다운 후 rng<0.5 → slamTelegraph", () =>
    expect(nextBossPhase(mkBoss(), 11, 0.3)).toBe("slamTelegraph"))
  it("쿨다운 후 rng≥0.5 → chargeTelegraph", () =>
    expect(nextBossPhase(mkBoss(), 11, 0.7)).toBe("chargeTelegraph"))
  it("telegraph 만료 → 실행 페이즈", () =>
    expect(nextBossPhase(mkBoss({ phase: "slamTelegraph", phaseUntil: 11 }), 11.01, 0)).toBe("slamming"))
  it("slam 횟수 남음 → 다시 telegraph", () =>
    expect(nextBossPhase(mkBoss({ phase: "slamming", phaseUntil: 11, slamCount: 1 }), 11.01, 0)).toBe("slamTelegraph"))
  it("slam 3회 소진 → idle", () =>
    expect(nextBossPhase(mkBoss({ phase: "slamming", phaseUntil: 11, slamCount: BOSS.slam.count }), 11.01, 0)).toBe("idle"))
})

describe("pointInChargePath", () => {
  it("경로 중앙 → true", () =>
    expect(pointInChargePath({ x: 0, z: 0 }, { x: 0, z: 1 }, 1.2, 12, { x: 0.5, z: 5 }, 0.45)).toBe(true))
  it("측면 이탈 → false", () =>
    expect(pointInChargePath({ x: 0, z: 0 }, { x: 0, z: 1 }, 1.2, 12, { x: 3, z: 5 }, 0.45)).toBe(false))
  it("뒤쪽 → false", () =>
    expect(pointInChargePath({ x: 0, z: 0 }, { x: 0, z: 1 }, 1.2, 12, { x: 0, z: -2 }, 0.45)).toBe(false))
})
```

- [ ] **Step 2: 실행 → FAIL 확인**
- [ ] **Step 3: 구현** — 페이즈 머신은 순수 함수 + bossSystem이 부수효과(텔레그래프 메시, 데미지, 돌진 knockback 셋업, slamCount/nextPatternAt 갱신) 담당.
- [ ] **Step 4: 실행 → PASS 확인**
- [ ] **Step 5: 스모크 체크** — 보스방 진입 시 상단 보스 체력바, 예고 표시 보고 피하기 가능, 3연타/차지 패턴 동작, 처치 시 희귀 드롭+클리어 오버레이.

---

### Task 12: 에셋 파이프라인 + 애니메이션 + 비주얼 폴리시

**Files:**
- Create: `src/core/assets.ts`, `src/systems/animation.ts`
- Modify: `src/systems/render.ts` (프리미티브 대신 레지스트리 경유), `public/assets/models/README.md`

**Interfaces:**
- Produces:
  - `loadModelRegistry(): Promise<Registry>` — `public/assets/models/{player,warrior,archer,boss}.glb`를 GLTFLoader로 시도, 404/실패 시 해당 kind는 `null`(프리미티브 폴백). 성공 시 `{ scene, clips }` 보관, 인스턴스는 `SkeletonUtils.clone`
  - `animationSystem(world, res, dt)` — glTF 모델 엔티티에 AnimationMixer 부착, 논리 상태→클립 매핑(`idle/walk/attack/death` 이름 부분일치 검색), 크로스페이드 0.15s. 프리미티브 폴백 엔티티는 간이 연출(공격 시 15° 기울임 펀치, 이동 시 바운스)
  - `public/assets/models/README.md` — 권장 CC0 에셋 출처(KayKit Skeletons/Adventurers/Dungeon, Quaternius Ultimate RPG)와 파일명 규약 안내
- Consumes: render의 모델 생성 지점

- [ ] **Step 1: 구현** — 레지스트리 → render의 `createPrimitive`를 `createModel(kind)`로 교체(레지스트리 우선). 다운로드 가능한 CC0 에셋은 시도하되(직링크 없으면 스킵), 실패해도 게임 동작에 영향 없음을 확인.
- [ ] **Step 2: 폴리시** — 안개 농도/조명 강도 튜닝, 벽 상단 어둡게, 드롭 빛기둥 블룸 느낌(additive), 사망 페이드, 화면 흔들림(보스 slam 시 카메라 0.15s 셰이크).
- [ ] **Step 3: 스모크 체크** — 에셋 유무 양쪽 모두 실행 확인(models 폴더 비운 상태 + 넣은 상태), 콘솔 에러 0건.

---

### Task 13: 통합 검증 — 스모크 자동화 + 밸런스 패스 + 문서

**Files:**
- Create: `README.md` (실행법, 조작법, 에셋 넣는 법, 구조 개요)
- Test: 전체 `npm test` + 브라우저 스모크

**Interfaces:**
- Consumes: 전체

- [ ] **Step 1: 전체 단위 테스트** — `npm test` 전건 PASS.
- [ ] **Step 2: 브라우저 스모크(agent-browser)** — dev 서버 기동 → 페이지 로드 → 콘솔 에러 0건 확인 → 캔버스 클릭으로 플레이어 위치 변화 확인 → 스크린샷 저장.
- [ ] **Step 3: 플레이스루 체크리스트(사용자 또는 수동)** — 입구→전투방 3개 클리어→레벨 2~3 도달→장비 2개 이상 장착→보스 처치→클리어 화면. 5분 내외인지, 난이도 급락/급등 구간 메모 후 `content/` 수치만으로 조정.
- [ ] **Step 4: README 작성** — 설치/실행/조작(`좌클릭 이동·공격, 우클릭 회전베기, Space 돌진, I 인벤토리`)/에셋 규약/폴더 구조.

---

## Self-Review 결과

- **스펙 커버리지**: 클릭이동(T5), 기본공격(T7), 스킬3종(T8), 루트/장착(T9), XP/레벨업(T10), 적2종+AI(T6), 보스(T11), 수제 던전(T3), 프리미티브 폴백+에셋 드롭인(T4/T12), HUD(T7~10), 사망/부활(T7), 테스트 전략(각 태스크+T13) — 전 항목 태스크 매핑 확인.
- **의도적 단순화**: 스펙의 AI 5상태(대기→인지→추적→공격→복귀) 중 "인지"는 idle→chase 전이 조건으로 흡수해 4상태로 구현(동작 동일, 상태 수만 축소).
- **타입 일관성**: `PlayerComp`/`ItemInstance`/`Affix`/시스템 시그니처를 공유 타입 블록에 고정하고 각 태스크 테스트 코드가 동일 형태 사용 확인.
- **잔여 리스크**: DUNGEON 레이아웃 문자열은 T3 구현 시점에 완성(테스트가 요건 강제). xpForLevel(2) 계열 기대값은 floor 규약으로 테스트에 고정.
