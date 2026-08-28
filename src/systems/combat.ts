import { isWalkable } from "../content/map"
import { HITSTOP, requestHitstop } from "../core/hitstop"
import type { Entity, GameWorld, Resources, Vec2 } from "../core/world"
import { worldToScreen } from "./render"
import { rollDrop } from "./loot"
import { applyBreakDamage, BREAK, isFocused, triggerBreak } from "./break"
import { applyHitstun, applyKnockback, moveWithWalls } from "./movement"
import { emitDamageResolved, emitPropBreak } from "../core/events"
import { rollPropDrops } from "./destructibles"
import { ENEMY_DEFS } from "../content/enemies"
import { getZone } from "../content/zones"
import { completeEncounter, createRunProgress } from "../core/runState"

const RAGE_PER_HIT = 10
const CORPSE_LINGER = 1.2
const PLAYER_RESPAWN_DELAY = 3
const PROJECTILE_SPEED = 10
const PROJECTILE_TTL = 3
const HITSTUN_MS = { player: 160, companion: 120, enemy: 120, boss: 80 } as const
export const PLAYER_ATTACK_WINDUP = 0.12
export const PLAYER_ATTACK_LUNGE = 0.18
const KNOCKBACK = {
  player: { speed: 1.8, duration: 0.12 },
  companion: { speed: 1.4, duration: 0.1 },
  enemy: { speed: 4.8, duration: 0.16 },
} as const

export function effectiveAttackCooldown(baseCooldown: number, attackSpeedPct = 0): number {
  return baseCooldown / (1 + Math.max(0, attackSpeedPct) / 100)
}

/** 공격 모션을 먼저 시작하고 판정은 windup 뒤에 발생시킨다. */
export function queueMeleeAttack(
  attack: NonNullable<Entity["attack"]>,
  now: number,
  windup = PLAYER_ATTACK_WINDUP,
  attackSpeedPct = 0,
): void {
  attack.readyAt = now + effectiveAttackCooldown(attack.cooldown, attackSpeedPct)
  attack.windupUntil = now + Math.max(0, windup)
}

/** 타격 프레임에 짧게 전진하되 벽을 통과하거나 타겟과 겹치지 않게 한다. */
function lungePlayer(res: Resources, player: Entity, target: Entity): void {
  if (!player.transform || !target.transform) return
  const dx = target.transform.position.x - player.transform.position.x
  const dz = target.transform.position.z - player.transform.position.z
  const distance = Math.hypot(dx, dz)
  if (distance <= 1e-6) return
  const clearance = (player.radius ?? 0.4) + (target.radius ?? 0.4) + 0.05
  const travel = Math.min(PLAYER_ATTACK_LUNGE, Math.max(0, distance - clearance))
  if (travel <= 0) return
  const next = moveWithWalls(
    res.map,
    player.transform.position,
    { x: (dx / distance) * travel, z: (dz / distance) * travel },
    player.radius ?? 0.4,
  )
  player.transform.position.x = next.x
  player.transform.position.z = next.z
}

/** 부채꼴 근접 판정. yaw=0 은 +z 방향(atan2(dx, dz) 규약). */
export function inMeleeArc(
  origin: Vec2, yaw: number, target: Vec2, range: number, arc: number, targetRadius: number,
): boolean {
  const dx = target.x - origin.x
  const dz = target.z - origin.z
  const dist = Math.hypot(dx, dz)
  if (dist > range + targetRadius) return false
  if (dist === 0) return true
  let ang = Math.atan2(dx, dz) - yaw
  while (ang > Math.PI) ang -= 2 * Math.PI
  while (ang < -Math.PI) ang += 2 * Math.PI
  return Math.abs(ang) <= arc / 2
}

/** origin에서 dir 방향으로 뻗은 폭 2*halfWidth, 길이 maxDist 경로 위에 원(p, pRadius)이 걸치는지. */
export function pointInPath(
  origin: Vec2, dir: Vec2, halfWidth: number, maxDist: number, p: Vec2, pRadius: number,
): boolean {
  const dx = p.x - origin.x
  const dz = p.z - origin.z
  const along = dx * dir.x + dz * dir.z
  if (along < -pRadius || along > maxDist + pRadius) return false
  const perp = Math.abs(dx * dir.z - dz * dir.x)
  return perp <= halfWidth + pRadius
}

/** 플레이어의 공격 스킬이 판정할 수 있는 살아 있는 대상. */
export function playerAttackTargets(world: GameWorld): Entity[] {
  return [
    ...world.with("enemy", "health", "transform"),
    ...world.with("destructible", "transform"),
  ].filter((entity) => !entity.dead && (!entity.destructible || entity.destructible.state === "intact"))
}

export function applyDamage(health: { current: number; max: number }, amount: number): { died: boolean } {
  health.current = Math.max(0, health.current - amount)
  return { died: health.current <= 0 }
}

export interface DamageResolution {
  amount: number
  critical: boolean
  focused: boolean
}

/** 플레이어 공격에만 장비 치명타를 적용한다. */
export function resolveOutgoingDamage(
  baseAmount: number,
  attacker: Entity,
  target: Entity,
  rng: () => number,
  focused: boolean,
  allowCritical = true,
): DamageResolution {
  const player = attacker.player
  const chance = player ? Math.max(0, Math.min(100, player.critChance)) : 0
  const critical = allowCritical && !!player && chance > 0 && rng() < chance / 100
  const critMultiplier = critical ? Math.max(100, player.critDamage) / 100 : 1
  const amount = baseAmount * critMultiplier * (focused ? BREAK.focusMultiplier : 1)
  return { amount, critical, focused }
}

function flash(world: GameWorld, e: Entity, until: number) {
  if (e.hitFlash) e.hitFlash.until = until
  else world.addComponent(e, "hitFlash", { until })
}

export function showDamageAt(res: Resources, pos: { x: number; z: number }, text: string, cls?: string) {
  const s = worldToScreen(res, pos.x, 1.6, pos.z)
  res.hud.showDamage(s.x, s.y, text, cls)
}

/** 사망 처리 공통 진입점. 드롭/XP 수거는 각 시스템이 dead 컴포넌트를 보고 처리한다. */
export function kill(world: GameWorld, res: Resources, e: Entity): void {
  if (e.dead) return
  if (e.player) requestHitstop(res.hitstop, HITSTOP.playerHitMs)
  else if (e.enemy) {
    requestHitstop(
      res.hitstop,
      e.enemy.kind === "boss" ? HITSTOP.bossDefeatedMs : HITSTOP.enemyDefeatedMs,
    )
  }
  world.addComponent(e, "dead", {
    at: res.time.now,
    ...(e.player ? { respawnAt: res.time.now + PLAYER_RESPAWN_DELAY } : {}),
  })
  if (e.moveTarget) world.removeComponent(e, "moveTarget")
  if (e.attackIntent) world.removeComponent(e, "attackIntent")
  if (e.enemy?.kind === "boss") {
    // 보스 처치는 현재 엔티티의 수명이 아니라 encounter 진행으로 기록한다.
    // 그래야 마을에 다녀온 뒤 같은 보스와 보상이 다시 생성되지 않는다.
    const encounterId = getZone(res.zoneId)?.encounterId
    if (encounterId) {
      completeEncounter(res.runProgress ?? (res.runProgress = createRunProgress()), encounterId)
    }
  }
  if (e.enemy) rollDrop(world, res, e)
  if (e.enemy?.kind === "boss") {
    res.flags.bossDefeated = true
    res.hud.setBossBar(null)
    res.hud.setOverlay(`던전 클리어!<div class="sub">해골 군주를 처치했습니다</div>`, "clear")
    setTimeout(() => res.hud.setOverlay(null), 5000)
  }
  if (e.player) {
    res.hud.setOverlay(`당신은 죽었습니다<div class="sub">잠시 후 입구에서 부활합니다</div>`)
  }
}

export function dealDamage(
  world: GameWorld, res: Resources, attacker: Entity, target: Entity, amount: number, breakPower?: number,
): void {
  if (target.destructible) {
    dealDestructibleDamage(world, res, attacker, target, amount)
    return
  }
  if (!target.health || target.dead) return
  const focused = isFocused(target.breakable, res.time.now)
  const resolution = resolveOutgoingDamage(amount, attacker, target, res.rng, focused)
  const guardMultiplier = target.player && target.guarding && res.time.now < target.guarding.until
    ? Math.max(0, Math.min(1, target.guarding.damageMultiplier))
    : 1
  const finalAmount = resolution.amount * guardMultiplier
  const { died } = applyDamage(target.health, finalAmount)
  if (!died && target.transform) {
    const durationMs = target.player
      ? HITSTUN_MS.player
      : target.companion
        ? HITSTUN_MS.companion
        : target.boss
          ? HITSTUN_MS.boss
          : HITSTUN_MS.enemy
    applyHitstun(world, target, res.time.now + durationMs / 1000)

    if (attacker.transform && (attacker.player || attacker.enemy || target.player || target.companion)) {
      const dx = target.transform.position.x - attacker.transform.position.x
      const dz = target.transform.position.z - attacker.transform.position.z
      const distance = Math.hypot(dx, dz)
      // 기본 공격은 보스를 밀지 않는다. 보스 전용 패턴과 돌진은 별도 넉백을 사용한다.
      if (distance > 1e-6 && !target.boss) {
        const reaction = target.player
          ? KNOCKBACK.player
          : target.companion
            ? KNOCKBACK.companion
            : KNOCKBACK.enemy
        applyKnockback(
          world,
          target,
          { x: dx / distance, z: dz / distance },
          reaction.speed,
          res.time.now + reaction.duration,
        )
      }
    }
  }
  if (target.player) requestHitstop(res.hitstop, HITSTOP.playerHitMs)
  else if (attacker.player && !died) requestHitstop(res.hitstop, HITSTOP.lightHitMs)
  flash(world, target, res.time.now + 0.12)
  if (target.transform) {
    showDamageAt(
      res,
      target.transform.position,
      `${Math.round(finalAmount)}`,
      resolution.critical ? "critical-hit" : focused ? "focus-hit" : target.player ? "player-hit" : undefined,
    )
  }
  const sourceRole = attacker.player ? "player" : attacker.companion ? "companion" : attacker.enemy ? "enemy" : "environment"
  emitDamageResolved(res.events, res.time.now, {
    source: attacker,
    target,
    sourceRole,
    amount: finalAmount,
    critical: resolution.critical,
    focused,
    killed: died,
    position: target.transform ? { ...target.transform.position } : undefined,
  })
  const rageOwner = attacker.player
    ? attacker
    : attacker.companion
      ? world.with("player").entities[0]
      : undefined
  if (rageOwner?.player && rageOwner.player.rage < rageOwner.player.maxRage) {
    const gain = attacker.player ? RAGE_PER_HIT : 3
    rageOwner.player.rage = Math.min(rageOwner.player.maxRage, rageOwner.player.rage + gain)
  }
  const playerBreakPower = attacker.player?.breakPower ?? 0
  const actualBreakPower = (breakPower ?? attacker.attack?.breakPower ?? attacker.projectile?.breakPower ?? 0) + playerBreakPower
  if (!died && target.breakable && actualBreakPower > 0) {
    const result = applyBreakDamage(target.breakable, actualBreakPower, res.time.now)
    if (result.broke) {
      triggerBreak(world, res, target)
      if (target.transform) showDamageAt(res, target.transform.position, "BREAK!", "break-hit")
    }
  }
  if (died) kill(world, res, target)
}

/** 생명체 규칙과 분리된 환경 소품 피해 경로. */
function dealDestructibleDamage(
  world: GameWorld,
  res: Resources,
  attacker: Entity,
  target: Entity,
  amount: number,
): void {
  const prop = target.destructible
  if (!prop || prop.state === "broken" || !attacker.player || !target.transform) return

  const resolution = resolveOutgoingDamage(amount, attacker, target, res.rng, false, false)
  prop.currentHp = Math.max(0, prop.currentHp - resolution.amount)
  flash(world, target, res.time.now + 0.12)
  requestHitstop(res.hitstop, HITSTOP.lightHitMs)
  showDamageAt(res, target.transform.position, `${Math.round(resolution.amount)}`)
  emitDamageResolved(res.events, res.time.now, {
    source: attacker,
    target,
    sourceRole: "player",
    amount: resolution.amount,
    critical: false,
    focused: false,
    killed: false,
    position: { ...target.transform.position },
  })

  if (prop.currentHp > 0) return
  prop.state = "broken"
  prop.currentHp = 0
  const sourcePosition = attacker.transform?.position
  const dx = target.transform.position.x - (sourcePosition?.x ?? target.transform.position.x)
  const dz = target.transform.position.z - (sourcePosition?.z ?? target.transform.position.z)
  const length = Math.hypot(dx, dz)
  const impulse = length > 1e-6 ? { x: dx / length, z: dz / length } : { x: 0, z: 1 }
  const droppedItemIds = rollPropDrops(world, res, target)
  emitPropBreak(res.events, res.time.now, {
    prop: target,
    propKind: prop.kind,
    source: attacker,
    position: { ...target.transform.position },
    impulse,
    droppedItemIds,
  })
}

export function meleeStrike(world: GameWorld, res: Resources, attacker: Entity, targets: Iterable<Entity>): void {
  if (!attacker.transform || !attacker.attack) return
  const origin = attacker.transform.position
  const damage = attacker.player ? attacker.player.attackPower : attacker.attack.damage
  for (const target of targets) {
    if (target === attacker || target.dead || (!target.health && !target.destructible) || !target.transform) continue
    if (inMeleeArc(origin, attacker.transform.yaw, target.transform.position, attacker.attack.range, attacker.attack.arc, target.radius ?? 0.4)) {
      dealDamage(world, res, attacker, target, damage)
    }
  }
}

export function fireProjectile(world: GameWorld, attacker: Entity, targetPos: Vec2, target?: Entity): void {
  if (!attacker.transform || !attacker.attack) return
  const p = attacker.transform.position
  const dx = targetPos.x - p.x
  const dz = targetPos.z - p.z
  const len = Math.hypot(dx, dz) || 1
  const dir = { x: dx / len, z: dz / len }
  world.add({
    transform: { position: { x: p.x + dir.x * 0.6, y: 0, z: p.z + dir.z * 0.6 }, yaw: Math.atan2(dir.x, dir.z) },
    projectile: { damage: attacker.attack.damage, breakPower: attacker.attack.breakPower ?? 0, dir, speed: PROJECTILE_SPEED, diesAt: -1, target },
    model: { kind: "projectile" },
  })
}

function removeEntity(world: GameWorld, res: Resources, e: Entity) {
  if (e.model?.object) res.scene.remove(e.model.object)
  world.remove(e)
}

/**
 * 돌진의 접촉은 이동 경로의 현재 진행량으로 판정한다. 현재 위치까지만
 * sweep하므로 벽에 막힌 돌진이 벽 너머의 플레이어를 맞히지 않는다.
 */
function resolveEnemyChargeContacts(world: GameWorld, res: Resources): void {
  for (const e of world.with("enemy", "enemyAction", "transform", "health")) {
    if (e.dead || e.enemyAction.phase !== "active" || e.enemyAction.hasHit) continue
    const charge = ENEMY_DEFS[e.enemy.kind].charge
    const target = e.enemyAction.target
    if (!charge || !target || target.dead || !target.transform) continue

    const p = e.transform.position
    const traveled = Math.hypot(p.x - e.enemyAction.origin.x, p.z - e.enemyAction.origin.z)
    const targetPos = target.transform.position
    // 원형 분리로 대상이 돌진 방향으로 살짝 밀릴 수 있다. 대상 반경과
    // 공격자 반경만큼 sweep 끝을 열어 주되, 벽에 막힌 실제 진행량을
    // 넘어서는 판정은 만들지 않는다.
    const contactTravel = traveled + (target.radius ?? 0.4) + (e.radius ?? 0.4)
    if (!pointInPath(
      e.enemyAction.origin,
      e.enemyAction.dir,
      charge.halfWidth,
      contactTravel,
      targetPos,
      target.radius ?? 0.4,
    )) continue

    e.enemyAction.hasHit = true
    dealDamage(world, res, e, target, e.attack!.damage * charge.damageMultiplier)
  }
}

export function combatSystem(world: GameWorld, res: Resources, dt: number): void {
  const now = res.time.now
  const player = world.with("player", "transform", "health").entities[0]
  if (player?.hitstun && now >= player.hitstun.until) world.removeComponent(player, "hitstun")

  // 준비동작이 끝난 프레임에만 플레이어 기본 공격 판정을 낸다.
  if (player && !player.dead && player.attack?.windupUntil !== undefined) {
    const target = player.attackIntent?.target
    if (player.hitstun || target?.dead || !target?.transform) {
      delete player.attack.windupUntil
    } else if (now >= player.attack.windupUntil) {
      delete player.attack.windupUntil
      lungePlayer(res, player, target)
    meleeStrike(world, res, player, playerAttackTargets(world))
    }
  }

  resolveEnemyChargeContacts(world, res)

  // 1. 플레이어 기본 공격 (attackIntent)
  if (player && !player.dead && !player.hitstun && !player.action && player.attackIntent) {
    const target = player.attackIntent.target
    if (target.dead || !target.transform) {
      world.removeComponent(player, "attackIntent")
    } else {
      const pp = player.transform.position
      const tp = target.transform.position
      const dist = Math.hypot(tp.x - pp.x, tp.z - pp.z)
      const reach = player.attack!.range + (target.radius ?? 0.4)
      const windingUp = player.attack!.windupUntil !== undefined && now < player.attack!.windupUntil
      if (windingUp) {
        if (player.moveTarget) world.removeComponent(player, "moveTarget")
        player.transform.yaw = Math.atan2(tp.x - pp.x, tp.z - pp.z)
      } else if (dist > reach * 0.9) {
        if (player.moveTarget) {
          player.moveTarget.x = tp.x
          player.moveTarget.z = tp.z
        } else {
          world.addComponent(player, "moveTarget", { x: tp.x, z: tp.z })
        }
      } else {
        if (player.moveTarget) world.removeComponent(player, "moveTarget")
        player.transform.yaw = Math.atan2(tp.x - pp.x, tp.z - pp.z)
        if (now >= player.attack!.readyAt) {
          queueMeleeAttack(player.attack!, now, PLAYER_ATTACK_WINDUP, player.player?.attackSpeedPct ?? 0)
        }
      }
    }
  }

  // 2. 투사체 비행/명중
  for (const proj of world.with("projectile", "transform")) {
    if (proj.projectile.diesAt < 0) proj.projectile.diesAt = now + PROJECTILE_TTL
    const p = proj.transform.position
    p.x += proj.projectile.dir.x * proj.projectile.speed * dt
    p.z += proj.projectile.dir.z * proj.projectile.speed * dt
    if (now > proj.projectile.diesAt || !isWalkable(res.map, p.x, p.z)) {
      removeEntity(world, res, proj)
      continue
    }
    const target = proj.projectile.target && !proj.projectile.target.dead ? proj.projectile.target : player
    if (target && !target.dead) {
      const pp = target.transform!.position
      if (Math.hypot(pp.x - p.x, pp.z - p.z) < 0.15 + (target.radius ?? 0.45)) {
        dealDamage(world, res, proj, target, proj.projectile.damage)
        removeEntity(world, res, proj)
      }
    }
  }

  // 3. 시체 정리 / 플레이어 부활
  for (const e of [...world.with("dead")]) {
    if (e.player || e.companion) continue
    if (now - e.dead.at > CORPSE_LINGER) removeEntity(world, res, e)
  }
  if (player?.dead?.respawnAt !== undefined && now >= player.dead.respawnAt) {
    world.removeComponent(player, "dead")
    player.transform.position.x = res.map.playerSpawn.x
    player.transform.position.z = res.map.playerSpawn.z
    player.health.current = player.health.max
    player.player.rage = 0
    res.hud.setOverlay(null)
  }

  // 4. HUD 동기화 (체력/분노 구슬, 피해 입은 적 체력바)
  if (player) {
    res.hud.setHp(player.health.current, player.health.max)
    res.hud.setRage(player.player.rage, player.player.maxRage)
  }
  const bars: { key: object; x: number; y: number; frac: number }[] = []
  for (const e of world.with("enemy", "health", "transform")) {
    if (e.dead || e.boss || e.health.current >= e.health.max) continue
    const s = worldToScreen(res, e.transform.position.x, 2.3, e.transform.position.z)
    bars.push({ key: e, x: s.x, y: s.y, frac: e.health.current / e.health.max })
  }
  res.hud.syncEnemyBars(bars)
}
