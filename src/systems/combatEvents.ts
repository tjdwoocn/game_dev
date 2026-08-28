import type { Entity, GameWorld, Resources, SkillCastPhase, SkillId, Vec3 } from "../core/world"
import { drainGameplayEvents } from "../core/events"

/**
 * 전투 이벤트 감지 — 소리와 이펙트가 같은 신호를 본다.
 *
 * **왜 각 시스템에 호출을 심지 않는가.** 전투·스킬·루팅 코드에 `playSound()` 와
 * `spawnVfx()` 를 흩어 놓으면 남의 파일을 전부 건드려야 하고, 나중에 "타격 순간" 의 정의가
 * 바뀔 때 고칠 곳이 여러 군데가 된다. 대신 여기서 매 프레임 상태 변화를 읽는다.
 *   `damageResolved`·`skillCast` = 판정 시스템의 명시 신호 / `hitFlash` 갱신 = 레거시 피격
 *   / `dead` 부착 = 죽었다 / `attack.readyAt` 증가 = 휘둘렀다
 * 60Hz 로 도니 지연은 16ms 이내다.
 *
 * **왜 소리와 이펙트가 이 모듈을 공유하는가.** 각자 감지하면 두 벌의 판정이 생기고
 * 조용히 갈라진다(소리는 나는데 이펙트는 안 나오는 식). 신호는 하나여야 한다.
 */

export type CombatEventKind =
  | "swing" | "hit" | "hitHeavy" | "crit" | "enemyDeath" | "playerHurt"
  | "lootDrop" | "lootPickup" | "breakOpen" | "breakSuccess"
  | "propBreak" | "levelUp" | "dash" | "whirlwind" | "skillWindup" | "skillRelease" | "bossTelegraph"

export interface CombatEvent {
  kind: CombatEventKind
  /** 이벤트가 일어난 월드 좌표. 없으면 화면 전체 이벤트다(레벨업 등). */
  at?: Vec3
  /** 방향이 있는 이벤트의 바라보는 각(라디안). 검격 궤적이 쓴다. */
  yaw?: number
  /** 0~1. 거리 감쇠와 세기를 겸한다. */
  power: number
  entity?: Entity
  amount?: number
  critical?: boolean
  focused?: boolean
  skillId?: SkillId
  phase?: SkillCastPhase
  castId?: number
}

interface Prev {
  attackReadyAt: number
  hitFlashUntil: number
  dead: boolean
  exposedUntil: number
  brokenUntil: number
  bossPhase: string
}

const prev = new WeakMap<Entity, Prev>()
let prevLevel = 0
let prevLootCount = -1
let prevInventory = -1

function snapshot(e: Entity): Prev {
  return {
    attackReadyAt: e.attack?.readyAt ?? 0,
    hitFlashUntil: e.hitFlash?.until ?? 0,
    dead: !!e.dead,
    exposedUntil: e.breakable?.exposedUntil ?? 0,
    brokenUntil: e.breakable?.brokenUntil ?? 0,
    bossPhase: e.boss?.phase ?? "",
  }
}

/**
 * 거리 감쇠. 화면 밖에서 벌어지는 일이 코앞처럼 느껴지면 상황이 안 읽힌다.
 * 완전한 0 이 되지 않도록 하한을 둔다 — 아예 사라지면 무슨 일이 났는지 모른다.
 */
function attenuation(pos: Vec3 | undefined, playerPos: Vec3 | null): number {
  if (!pos || !playerPos) return 1
  const d = Math.hypot(pos.x - playerPos.x, pos.z - playerPos.z)
  return Math.max(0.25, Math.min(1, 1 - (d - 6) / 26))
}

/**
 * 이번 프레임에 일어난 전투 이벤트를 모은다.
 *
 * 처음 보는 엔티티는 건너뛴다 — 존에 들어서는 순간 기존 엔티티 전부가 "새로 생긴 것" 으로
 * 보여서 소리와 이펙트가 한꺼번에 터진다.
 */
export function collectCombatEvents(world: GameWorld, res: Resources): CombatEvent[] {
  const events: CombatEvent[] = []
  const playerEntity = world.with("player", "transform").first
  const playerPos = playerEntity?.transform?.position ?? null
  const pc = playerEntity?.player

  // 판정 시스템이 발행한 명시 이벤트를 먼저 소비한다. 상태 델타 관찰은 아직
  // 마이그레이션되지 않은 이벤트를 위한 호환 경로로만 남긴다.
  const explicitDamageTargets = new Set<Entity>()
  for (const event of drainGameplayEvents(res.events)) {
    if (event.type === "skillCast") {
      const { payload } = event
      const kind: CombatEventKind = payload.phase === "windup"
        ? "skillWindup"
        : payload.skillId === "dash"
          ? "dash"
          : payload.skillId === "whirlwind"
            ? "whirlwind"
            : "skillRelease"
      events.push({
        kind,
        at: payload.position,
        yaw: payload.yaw,
        power: 1,
        entity: payload.caster,
        skillId: payload.skillId,
        phase: payload.phase,
        castId: payload.castId,
      })
      continue
    }
    if (event.type === "propBreak") {
      events.push({ kind: "propBreak", at: event.payload.position, power: 1, entity: event.payload.prop })
      continue
    }
    if (event.type !== "damageResolved") continue
    const { payload } = event
    explicitDamageTargets.add(payload.target)
    const pos = payload.position
    const power = attenuation(pos, playerPos)
    const kind = payload.target.player
      ? "playerHurt"
      : payload.critical
        ? "crit"
        : payload.focused
          ? "hitHeavy"
          : "hit"
    events.push({
      kind,
      at: pos,
      power: payload.target.player ? 1 : power,
      entity: payload.target,
      amount: payload.amount,
      critical: payload.critical,
      focused: payload.focused,
    })
  }

  for (const e of world.with("transform")) {
    const now = snapshot(e)
    const before = prev.get(e)
    prev.set(e, now)
    if (!before) continue

    const pos = e.transform?.position
    const power = attenuation(pos, playerPos)

    if (now.attackReadyAt > before.attackReadyAt) {
      events.push({ kind: "swing", at: pos, yaw: e.transform?.yaw, power, entity: e })
    }

    if (now.hitFlashUntil > before.hitFlashUntil && !explicitDamageTargets.has(e)) {
      if (e.player) events.push({ kind: "playerHurt", at: pos, power: 1, entity: e })
      else {
        const focused = !!e.breakable && res.time.now < e.breakable.vulnerabilityUntil
        events.push({ kind: focused ? "hitHeavy" : "hit", at: pos, power, entity: e })
      }
    }

    if (!before.dead && now.dead && !e.player) {
      events.push({ kind: "enemyDeath", at: pos, power, entity: e })
    }

    if (now.exposedUntil > before.exposedUntil) events.push({ kind: "breakOpen", at: pos, power, entity: e })
    if (now.brokenUntil > before.brokenUntil) events.push({ kind: "breakSuccess", at: pos, power: 1, entity: e })

    if (now.bossPhase !== before.bossPhase && now.bossPhase.endsWith("Telegraph")) {
      events.push({ kind: "bossTelegraph", at: pos, power, entity: e })
    }
  }

  if (pc && playerPos) {
    if (prevLevel && pc.level > prevLevel) events.push({ kind: "levelUp", at: playerPos, power: 1, entity: playerEntity })
    prevLevel = pc.level

    const inv = pc.inventory.length
    if (prevInventory >= 0 && inv > prevInventory) events.push({ kind: "lootPickup", at: playerPos, power: 1 })
    prevInventory = inv
  }

  let loot = 0
  let newestLoot: Vec3 | undefined
  for (const e of world.with("lootDrop", "transform")) {
    loot++
    newestLoot = e.transform.position
  }
  if (prevLootCount >= 0 && loot > prevLootCount) {
    events.push({ kind: "lootDrop", at: newestLoot, power: attenuation(newestLoot, playerPos) })
  }
  prevLootCount = loot

  return events
}

/** 존을 옮기면 기준선을 다시 잡는다. 안 그러면 전환 직후 신호가 한꺼번에 터진다. */
export function resetCombatEventBaseline(): void {
  prevLevel = 0
  prevLootCount = -1
  prevInventory = -1
}
