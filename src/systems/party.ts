import { COMPANION_DEFS } from "../content/companions"
import type { Entity, GameWorld, Resources } from "../core/world"
import { fireProjectile, meleeStrike, showDamageAt } from "./combat"

export function partyMembers(world: GameWorld): Entity[] {
  return [
    ...world.with("player", "transform", "health").entities,
    ...world.with("companion", "transform", "health").entities,
  ].filter((e) => !e.dead)
}

/** 적이 파티를 공격할 때 탱커를 우선하고, 탱커가 없으면 가장 가까운 생존자를 선택한다. */
export function selectPartyTarget(world: GameWorld, from: Entity): Entity | null {
  const targets = partyMembers(world).filter((e) => e !== from && e.transform)
  const player = targets.find((e) => !!e.player)
  const tank = targets.find((e) => e.companion?.role === "tank")
  const tankPosition = tank?.transform?.position
  if (tankPosition && from.transform) {
    const tankDistance = Math.hypot(tankPosition.x - from.transform.position.x, tankPosition.z - from.transform.position.z)
    const playerPosition = player?.transform?.position
    const playerDistance = playerPosition
      ? Math.hypot(playerPosition.x - from.transform.position.x, playerPosition.z - from.transform.position.z)
      : Infinity
    // 탱커가 실제로 가까울 때만 우선한다. 뒤에 남은 탱커 때문에 적이
    // 플레이어를 등지고 돌아서는 것을 막고, 탱커 역할은 그대로 유지한다.
    if (tankDistance <= 10 && tankDistance <= playerDistance + 1) return tank
  }
  let best: Entity | null = null
  let bestDist = Infinity
  for (const target of targets) {
    const d = Math.hypot(target.transform!.position.x - from.transform!.position.x, target.transform!.position.z - from.transform!.position.z)
    if (d < bestDist) { best = target; bestDist = d }
  }
  return best
}

function nearestEnemy(world: GameWorld, e: Entity): Entity | null {
  if (!e.transform) return null
  let best: Entity | null = null
  let bestDist = Infinity
  for (const enemy of world.with("enemy", "transform", "health")) {
    if (enemy.dead) continue
    const p = enemy.transform.position
    const d = Math.hypot(p.x - e.transform.position.x, p.z - e.transform.position.z)
    if (d < bestDist) { best = enemy; bestDist = d }
  }
  return best
}

function setMoveTarget(world: GameWorld, e: Entity, x: number, z: number): void {
  if (e.moveTarget) { e.moveTarget.x = x; e.moveTarget.z = z }
  else world.addComponent(e, "moveTarget", { x, z })
}

function clearMoveTarget(world: GameWorld, e: Entity): void {
  if (e.moveTarget) world.removeComponent(e, "moveTarget")
}

export function partySystem(world: GameWorld, res: Resources, dt: number): void {
  void dt
  const now = res.time.now
  const player = world.with("player", "transform", "health").entities[0]
  if (!player) return

  const entries = []
  for (const companion of world.with("companion", "transform", "health")) {
    const c = companion.companion
    const def = COMPANION_DEFS[c.role]
    if (companion.dead) {
      if (now - companion.dead.at > 4) {
        world.removeComponent(companion, "dead")
        companion.health.current = companion.health.max
        companion.transform.position.x = player.transform.position.x + c.homeOffset.x
        companion.transform.position.z = player.transform.position.z + c.homeOffset.z
      }
      entries.push({ name: c.name, role: c.role, hp: 0, maxHp: companion.health.max })
      continue
    }
    entries.push({ name: c.name, role: c.role, hp: companion.health.current, maxHp: companion.health.max })
    if (companion.hitstun && now < companion.hitstun.until) continue
    if (companion.hitstun) world.removeComponent(companion, "hitstun")
    if (companion.stunned) continue

    const cp = companion.transform.position
    const target = nearestEnemy(world, companion)
    const tp = target?.transform?.position
    const targetDist = tp ? Math.hypot(tp.x - cp.x, tp.z - cp.z) : Infinity
    if (target && tp && targetDist <= 12) {
      c.state = "engage"
      if (targetDist > (companion.attack?.range ?? 2) * 0.9) {
        setMoveTarget(world, companion, tp.x, tp.z)
      } else {
        clearMoveTarget(world, companion)
        companion.transform.yaw = Math.atan2(tp.x - cp.x, tp.z - cp.z)
        if (companion.attack && now >= c.attackReadyAt) {
          c.attackReadyAt = now + companion.attack.cooldown
          if (c.role === "tank") meleeStrike(world, res, companion, [target])
          else fireProjectile(world, companion, { x: tp.x, z: tp.z }, target)
        }
      }
    } else {
      c.state = "follow"
      const fx = player.transform.position.x + c.homeOffset.x
      const fz = player.transform.position.z + c.homeOffset.z
      if (Math.hypot(fx - cp.x, fz - cp.z) > 2.2) setMoveTarget(world, companion, fx, fz)
      else clearMoveTarget(world, companion)
    }

    if (c.role === "support" && def.healPercent && def.healCooldown && now >= c.supportReadyAt && player.health.current < player.health.max) {
      c.supportReadyAt = now + def.healCooldown
      const amount = Math.max(1, Math.round(player.health.max * def.healPercent))
      const before = player.health.current
      player.health.current = Math.min(player.health.max, player.health.current + amount)
      if (player.transform && player.health.current > before) showDamageAt(res, player.transform.position, `+${player.health.current - before}`, "heal")
    }
  }
  res.hud.setPartyStatus(entries)
}
