import { isSkillUnlocked, SKILLS } from "../content/skills"
import { emitSkillCast } from "../core/events"
import type { ActionState, Entity, GameWorld, PlayerComp, Resources, SkillId, Vec2 } from "../core/world"
import { dealDamage, playerAttackTargets, pointInPath } from "./combat"
import { applyKnockback } from "./movement"

export { SKILLS }

export type SkillName = SkillId

export const SKILL_TIMING: Record<SkillName, { windup: number; recovery: number }> = {
  whirlwind: { windup: 0.14, recovery: 0.26 },
  dash: { windup: 0.09, recovery: 0.18 },
  guard: { windup: 0.12, recovery: 0.18 },
  execution: { windup: 0.28, recovery: 0.35 },
}

const INPUT_BUFFER_SECONDS = 0.18

export function effectiveSkillCooldown(skill: SkillName, player: PlayerComp): number {
  const base = SKILLS[skill].cooldown
  const reduction = Math.max(0, Math.min(40, player.cooldownReductionPct ?? 0))
  return base * (1 - reduction / 100)
}

export function canCast(skill: SkillName, player: PlayerComp, now: number): boolean {
  if (!isSkillUnlocked(skill, player.level)) return false
  const definition = SKILLS[skill]
  if (now < player.cooldowns[skill]) return false
  if ("rageCost" in definition && player.rage < definition.rageCost) return false
  return true
}

export function spendCost(skill: SkillName, player: PlayerComp, now: number): void {
  const definition = SKILLS[skill]
  if ("rageCost" in definition) player.rage -= definition.rageCost
  player.cooldowns[skill] = now + effectiveSkillCooldown(skill, player)
}

function isActiveSkill(skill: SkillId): skill is SkillName { return true }

function copyPoint(point: Vec2): Vec2 {
  return { x: point.x, z: point.z }
}

export function nearestExecutionTarget(world: GameWorld, player: Entity): Entity | undefined {
  const p = player.transform?.position
  if (!p) return undefined
  let nearest: Entity | undefined
  let nearestDistance = Infinity
  for (const entity of world.with("enemy", "health", "transform")) {
    if (entity.dead || entity.health.current <= 0) continue
    const fraction = entity.health.current / entity.health.max
    if (fraction > SKILLS.execution.healthFraction) continue
    const distance = Math.hypot(entity.transform.position.x - p.x, entity.transform.position.z - p.z)
    if (distance > SKILLS.execution.range + (entity.radius ?? 0.4)) continue
    if (distance < nearestDistance) {
      nearest = entity
      nearestDistance = distance
    }
  }
  return nearest
}

function removeSkillComponent(world: GameWorld, player: Entity, key: "action" | "skillBuffer" | "skillIntent"): void {
  if (player[key] !== undefined) world.removeComponent(player, key)
}

function clearSkillState(world: GameWorld, player: Entity): void {
  removeSkillComponent(world, player, "action")
  removeSkillComponent(world, player, "skillBuffer")
  removeSkillComponent(world, player, "skillIntent")
  if (player.guarding !== undefined) world.removeComponent(player, "guarding")
}

function emitSkillPhase(
  res: Resources,
  player: Entity,
  action: ActionState,
  phase: "windup" | "release",
): void {
  const position = player.transform!.position
  emitSkillCast(res.events, res.time.now, {
    castId: action.castId,
    skillId: action.skillId,
    phase,
    caster: player,
    position: { ...position },
    yaw: player.transform!.yaw,
    targetPoint: action.targetPoint ? copyPoint(action.targetPoint) : undefined,
  })
}

function beginSkill(
  world: GameWorld,
  res: Resources,
  player: Entity,
  skill: SkillName,
  point: Vec2,
): boolean {
  const pc = player.player
  if (!pc || !player.transform || !canCast(skill, pc, res.time.now)) return false
  if (player.guarding && res.time.now < player.guarding.until) return false
  const target = skill === "execution" ? nearestExecutionTarget(world, player) : undefined
  if (skill === "execution" && !target) return false

  spendCost(skill, pc, res.time.now)
  if (player.attackIntent) world.removeComponent(player, "attackIntent")
  if (player.moveTarget) world.removeComponent(player, "moveTarget")
  if (player.path) world.removeComponent(player, "path")

  const action: ActionState = {
    kind: "skill",
    skillId: skill,
    castId: res.events.nextCastId++,
    phase: "windup",
    phaseUntil: res.time.now + SKILL_TIMING[skill].windup,
    targetPoint: copyPoint(point),
    target,
  }
  world.addComponent(player, "action", action)
  emitSkillPhase(res, player, action, "windup")
  return true
}

function releaseWhirlwind(world: GameWorld, res: Resources, player: Entity): void {
  const p = player.transform!.position
  const pc = player.player!
  const damage = SKILLS.whirlwind.damage + Math.round(pc.attackPower * 0.5)
  for (const e of playerAttackTargets(world)) {
    if (e.dead) continue
    const ep = e.transform?.position
    if (!ep) continue
    const d = Math.hypot(ep.x - p.x, ep.z - p.z)
    if (d <= SKILLS.whirlwind.radius + (e.radius ?? 0.4)) {
      dealDamage(world, res, player, e, damage, SKILLS.whirlwind.breakPower)
      if (!e.dead && d > 0) {
        applyKnockback(world, e, { x: (ep.x - p.x) / d, z: (ep.z - p.z) / d }, 6, res.time.now + 0.12)
      }
    }
  }
}

function releaseDash(world: GameWorld, res: Resources, player: Entity, point: Vec2): void {
  const transform = player.transform
  if (!transform) return
  const p = transform.position
  const dx = point.x - p.x
  const dz = point.z - p.z
  const len = Math.hypot(dx, dz) || 1
  const dir: Vec2 = { x: dx / len, z: dz / len }
  transform.yaw = Math.atan2(dir.x, dir.z)
  applyKnockback(world, player, dir, SKILLS.dash.speed, res.time.now + SKILLS.dash.distance / SKILLS.dash.speed)

  const damage = SKILLS.dash.damage + Math.round(player.player!.attackPower * 0.5)
  for (const e of playerAttackTargets(world)) {
    if (e.dead) continue
    const ep = e.transform?.position
    if (!ep) continue
    if (pointInPath(p, dir, 1.0, SKILLS.dash.distance, ep, e.radius ?? 0.4)) {
      dealDamage(world, res, player, e, damage, SKILLS.dash.breakPower)
      if (!e.dead) {
        applyKnockback(world, e, dir, SKILLS.dash.knockback.speed, res.time.now + SKILLS.dash.knockback.duration)
      }
    }
  }
}

function releaseGuard(world: GameWorld, res: Resources, player: Entity): void {
  const definition = SKILLS.guard
  if (player.guarding) {
    player.guarding.until = res.time.now + definition.duration
    player.guarding.damageMultiplier = definition.damageMultiplier
  } else {
    world.addComponent(player, "guarding", {
      until: res.time.now + definition.duration,
      damageMultiplier: definition.damageMultiplier,
    })
  }
}

function releaseExecution(world: GameWorld, res: Resources, player: Entity, target: Entity | undefined): void {
  if (!target || target.dead || !target.health || !target.transform || !player.transform) return
  const p = player.transform.position
  const tp = target.transform.position
  const distance = Math.hypot(tp.x - p.x, tp.z - p.z)
  if (distance > SKILLS.execution.range + (target.radius ?? 0.4)) return

  player.transform.yaw = Math.atan2(tp.x - p.x, tp.z - p.z)
  const damage = SKILLS.execution.damageBase + Math.round(player.player!.attackPower * SKILLS.execution.attackMultiplier)
  dealDamage(world, res, player, target, damage, SKILLS.execution.breakPower)
}

function releaseSkill(world: GameWorld, res: Resources, player: Entity, action: ActionState): void {
  if (!isActiveSkill(action.skillId)) return
  const skill = action.skillId
  emitSkillPhase(res, player, action, "release")
  if (skill === "whirlwind") releaseWhirlwind(world, res, player)
  else if (skill === "dash") releaseDash(world, res, player, action.targetPoint ?? { x: player.transform!.position.x, z: player.transform!.position.z })
  else if (skill === "guard") releaseGuard(world, res, player)
  else if (skill === "execution") releaseExecution(world, res, player, action.target)
  action.phase = "recovery"
  action.phaseUntil = res.time.now + SKILL_TIMING[skill].recovery
}

function bufferSkillIntent(world: GameWorld, player: Entity, skill: SkillName, point: Vec2, now: number): void {
  if (player.skillBuffer) return
  world.addComponent(player, "skillBuffer", {
    skillId: skill,
    point: copyPoint(point),
    expiresAt: now + INPUT_BUFFER_SECONDS,
  })
}

/**
 * 회전베기 시전 이펙트는 여기 없다 — `systems/combatVfx.ts` 의 풀링 이펙트가 담당한다.
 *
 * 예전엔 이 파일에서 시전마다 `new Mesh` + `new RingGeometry` + `new MeshBasicMaterial` 을
 * 만들어 씬에 붙이고 `requestAnimationFrame` 으로 지웠다. 문제가 셋이었다:
 *   1. 시전할 때마다 지오메트리·머티리얼이 새로 생겨 존을 오갈수록 쌓였다
 *   2. `requestAnimationFrame` 때문에 **헤드리스 시나리오 하니스에서 전투가 통째로 멈췄다**
 *   3. 다른 전투 이펙트와 파이프라인이 갈라져 타이밍·히트스톱 처리가 따로 놀았다
 *
 * 지금은 `combatEvents` 가 분노 감소를 관측해 `whirlwind` 이벤트를 내고,
 * `combatVfx` 의 회전 칼날 3장 + 충격파 + 불꽃이 풀에서 나온다.
 */

export function skillsSystem(world: GameWorld, res: Resources, dt: number): void {
  void dt
  const now = res.time.now
  const player = world.with("player", "transform").entities[0]
  if (!player) return
  const pc = player.player

  if (player.guarding && now >= player.guarding.until) world.removeComponent(player, "guarding")

  // 스킬바 HUD
  res.hud.setSkillCooldown("dash", Math.max(0, (pc.cooldowns.dash - now) / effectiveSkillCooldown("dash", pc)))
  res.hud.setSkillInsufficient(pc.rage < SKILLS.whirlwind.rageCost)

  if (player.dead) {
    clearSkillState(world, player)
    return
  }

  if (player.hitstun && now < player.hitstun.until) {
    // 이번 계약에서는 경직 시 입력 버퍼만 폐기한다. 진행 중인 시전까지
    // 취소하려면 다음 계약에서 cancel 이벤트와 환불 규칙을 먼저 정의해야 한다.
    removeSkillComponent(world, player, "skillBuffer")
    removeSkillComponent(world, player, "skillIntent")
    return
  }

  const action = player.action
  if (action) {
    if (!isActiveSkill(action.skillId)) {
      // 아직 구현되지 않은 스킬 상태가 외부 데이터로 주입돼도 영구 잠금되지 않는다.
      removeSkillComponent(world, player, "action")
      return
    }
    if (action.phase === "windup") {
      // 이번 배치의 버퍼는 recovery 동안만 받는다. windup 중 입력은 한 번의
      // 시전을 여러 번 만들지 않도록 버린다.
      removeSkillComponent(world, player, "skillIntent")
      if (now >= action.phaseUntil) releaseSkill(world, res, player, action)
      return
    }

    const intent = player.skillIntent
    if (intent) {
      removeSkillComponent(world, player, "skillIntent")
      if (isActiveSkill(intent.skill)) bufferSkillIntent(world, player, intent.skill, intent.point, now)
    }
    if (now < action.phaseUntil) return

    const buffered = player.skillBuffer
    removeSkillComponent(world, player, "action")
    removeSkillComponent(world, player, "skillBuffer")
    if (buffered && now <= buffered.expiresAt && isActiveSkill(buffered.skillId)) {
      beginSkill(world, res, player, buffered.skillId, buffered.point)
    }
    return
  }

  if (player.skillBuffer) {
    const buffered = player.skillBuffer
    removeSkillComponent(world, player, "skillBuffer")
    if (now <= buffered.expiresAt && isActiveSkill(buffered.skillId)) {
      beginSkill(world, res, player, buffered.skillId, buffered.point)
      return
    }
  }

  const intent = player.skillIntent
  if (!intent) return
  world.removeComponent(player, "skillIntent")
  if (!isActiveSkill(intent.skill)) return
  beginSkill(world, res, player, intent.skill, intent.point)
}
