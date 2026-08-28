import type { Entity, GameWorld, Resources, SkillId, Vec2 } from "../core/world"
import { advanceHitstop } from "../core/hitstop"
import { inputSystem } from "../systems/input"
import { directMoveSystem } from "../systems/directMove"
import { aiSystem } from "../systems/ai"
import { partySystem } from "../systems/party"
import { breakSystem } from "../systems/break"
import { bossSystem } from "../systems/boss"
import { skillsSystem } from "../systems/skills"
import { movementSystem } from "../systems/movement"
import { combatSystem } from "../systems/combat"
import { lootSystem } from "../systems/loot"
import { progressionSystem } from "../systems/progression"
import { townSystem } from "../systems/town"
import { zoneSystem } from "../systems/zone"
import { collectCombatEvents, type CombatEvent } from "../systems/combatEvents"
import type { Game } from "./headless"

/**
 * 고정 60Hz 스텝. `main.ts` 의 `logic()` 과 **같은 순서**로 부른다.
 *
 * 순서를 다르게 두면 텍스트에서 통과한 시나리오가 게임에서 다르게 돌아가고,
 * 그 순간 이 도구는 쓸모가 없어진다. `main.ts` 를 고치면 여기도 같이 고쳐야 한다
 * (`tests/scenario.contract.test.ts` 가 두 목록이 어긋나면 실패시킨다).
 *
 * 렌더 계열만 뺐다: `animationSystem`(모델 믹서), `renderSystem`, `renderFrame`.
 * `feedbackSystem` 대신 `collectCombatEvents` 를 직접 부른다 — 소리·이펙트 대신
 * **텍스트 로그**로 내보내기 위해서다. 감지 경로는 게임과 완전히 같다.
 */
export const STEP = 1 / 60

export const SYSTEM_ORDER = [
  "input", "directMove", "ai", "party", "break", "boss",
  "skills", "movement", "combat", "loot", "progression", "town", "zone",
] as const

/**
 * 이벤트에 **발생 시점**을 박아 둔다.
 *
 * 처음엔 이벤트만 모아 뒀다가 로그를 찍을 때 `res.time.now` 를 읽었는데, 그러면
 * 한 배치의 열한 줄이 전부 같은 시각·같은 체력으로 나온다. 실제로 그렇게 나왔고,
 * "한 프레임에 11번 맞았다" 처럼 읽혔다. 시각과 체력은 그 순간의 값이어야 한다.
 */
export interface TimedEvent extends CombatEvent {
  /** 게임 시간(히트스톱 반영). */
  t: number
  /** 이벤트 대상의 그 순간 체력. */
  hpAt?: number
  hpMax?: number
}

function stamp(evt: CombatEvent, now: number): TimedEvent {
  return {
    ...evt,
    t: now,
    hpAt: evt.entity?.health ? Math.round(evt.entity.health.current) : undefined,
    hpMax: evt.entity?.health?.max,
  }
}

export function stepOnce(game: Game): TimedEvent[] {
  const { world, res, runtime } = game
  res.time.realNow += STEP
  const dt = advanceHitstop(res.hitstop, STEP)
  res.time.now += dt
  inputSystem(world, res)
  directMoveSystem(world, res, dt)
  aiSystem(world, res, dt)
  partySystem(world, res, dt)
  breakSystem(world, res, dt)
  bossSystem(world, res, dt)
  skillsSystem(world, res, dt)
  movementSystem(world, res, dt)
  combatSystem(world, res, dt)
  lootSystem(world, res, dt)
  progressionSystem(world, res, dt)
  townSystem(world, res, runtime, dt)
  zoneSystem(world, res, runtime, dt)
  return collectCombatEvents(world, res).map((e) => stamp(e, res.time.now))
}

/** `seconds` 만큼 굴린다. 매 스텝의 전투 이벤트를 모아 돌려준다. */
export function advance(game: Game, seconds: number): TimedEvent[] {
  const steps = Math.max(1, Math.round(seconds / STEP))
  const events: TimedEvent[] = []
  for (let i = 0; i < steps; i++) events.push(...stepOnce(game))
  return events
}

// ---------------------------------------------------------------------------
// 명령 — **실제 의도 컴포넌트를 통해서만** 조작한다.
// 좌표를 손으로 옮기는 함수는 여기에 두지 않는다. 그건 검증이 아니라 치팅이다.
// ---------------------------------------------------------------------------

function setComponent<K extends keyof Entity>(
  world: GameWorld, e: Entity, key: K, value: NonNullable<Entity[K]>,
): void {
  if (e[key] !== undefined) world.removeComponent(e, key)
  world.addComponent(e, key, value)
}

/** 지점으로 이동 명령. 브라우저의 좌클릭(빈 바닥)과 같은 경로다. */
export function moveTo(game: Game, point: Vec2): void {
  setComponent(game.world, game.player, "moveTarget", { x: point.x, z: point.z })
  if (game.player.attackIntent) game.world.removeComponent(game.player, "attackIntent")
}

/** 적을 공격. 브라우저의 좌클릭(적)과 같은 경로다. */
export function attack(game: Game, target: Entity): void {
  setComponent(game.world, game.player, "attackIntent", { target })
  if (game.player.moveTarget) game.world.removeComponent(game.player, "moveTarget")
}

/** 스킬 시전. 브라우저의 우클릭(회전베기) / Space(돌진)와 같은 경로다. */
export function cast(game: Game, skill: SkillId, point: Vec2): void {
  setComponent(game.world, game.player, "skillIntent", { skill, point })
}

/** WASD 직접 이동. 키를 눌러 둔 상태를 만든다. */
export function hold(game: Game, ...keys: ("KeyW" | "KeyA" | "KeyS" | "KeyD")[]): void {
  game.res.input.held = new Set(keys)
}
export function releaseKeys(game: Game): void {
  game.res.input.held.clear()
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

export function livingEnemies(game: Game): Entity[] {
  const out: Entity[] = []
  for (const e of game.world.with("enemy", "transform", "health")) if (!e.dead) out.push(e)
  return out
}

export function nearestEnemy(game: Game): Entity | null {
  const p = game.player.transform!.position
  let best: Entity | null = null
  let bd = Infinity
  for (const e of livingEnemies(game)) {
    const ep = e.transform!.position
    const d = Math.hypot(ep.x - p.x, ep.z - p.z)
    if (d < bd) { bd = d; best = e }
  }
  return best
}

export function distanceTo(game: Game, e: Entity): number {
  const p = game.player.transform!.position
  const q = e.transform!.position
  return Math.hypot(q.x - p.x, q.z - p.z)
}
