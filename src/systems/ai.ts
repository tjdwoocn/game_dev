import { ENEMY_DEFS, type EnemyDef } from "../content/enemies"
import type { AIState, Entity, GameWorld, Resources, Vec2 } from "../core/world"
import { fireProjectile, meleeStrike } from "./combat"
import { selectPartyTarget } from "./party"

export interface AIContext {
  distToPlayer: number
  distToHome: number
  def: EnemyDef
  playerAlive: boolean
}

const ARRIVE_HOME = 0.5
const ATTACK_HYSTERESIS = 1.3

export function aiTransition(state: AIState, ctx: AIContext): AIState {
  if (!ctx.playerAlive) {
    if (state === "chase" || state === "attack") return "return"
    if (state === "return") return ctx.distToHome < ARRIVE_HOME ? "idle" : "return"
    return state
  }
  switch (state) {
    case "idle":
      return ctx.distToPlayer <= ctx.def.aggroRange ? "chase" : "idle"
    case "chase":
      if (ctx.distToHome > ctx.def.leashRange) return "return"
      if (ctx.distToPlayer <= ctx.def.attackRange) return "attack"
      return "chase"
    case "attack":
      if (ctx.distToPlayer > ctx.def.attackRange * ATTACK_HYSTERESIS) return "chase"
      return "attack"
    case "return":
      return ctx.distToHome < ARRIVE_HOME ? "idle" : "return"
  }
}

function setMoveTarget(world: GameWorld, e: Entity, target: Vec2) {
  if (e.moveTarget) {
    e.moveTarget.x = target.x
    e.moveTarget.z = target.z
  } else {
    world.addComponent(e, "moveTarget", target)
  }
}

function clearMoveTarget(world: GameWorld, e: Entity) {
  if (e.moveTarget) world.removeComponent(e, "moveTarget")
}

export function aiSystem(world: GameWorld, res: Resources, dt: number): void {
  void dt
  for (const e of world.with("enemy", "transform", "health")) {
    if (e.dead || e.boss) continue // 보스는 bossSystem이 전담
    const def = ENEMY_DEFS[e.enemy.kind]
    const p = e.transform.position
    const target = selectPartyTarget(world, e)
    const pp = target?.transform?.position
    const distToPlayer = pp ? Math.hypot(pp.x - p.x, pp.z - p.z) : Infinity
    const distToHome = Math.hypot(e.enemy.home.x - p.x, e.enemy.home.z - p.z)
    const playerAlive = !!target

    if (e.hitstun && res.time.now < e.hitstun.until) {
      if (e.moveTarget) world.removeComponent(e, "moveTarget")
      continue
    }
    if (e.hitstun) world.removeComponent(e, "hitstun")

    if (e.stunned) {
      if (e.moveTarget) world.removeComponent(e, "moveTarget")
      continue
    }

    const prev = e.enemy.state
    const next = aiTransition(prev, { distToPlayer, distToHome, def, playerAlive })
    if (next !== prev) {
      e.enemy.state = next
      e.enemy.stateSince = res.time.now
      if (prev === "return" && next === "idle") e.health.current = e.health.max
    }

    switch (next) {
      case "idle":
        clearMoveTarget(world, e)
        break
      case "chase": {
        if (!pp) break
        setMoveTarget(world, e, { x: pp.x, z: pp.z })
        break
      }
      case "attack": {
        if (!pp) break
        e.transform.yaw = Math.atan2(pp.x - p.x, pp.z - p.z)
        // 원거리형: 너무 가까우면 거리를 벌리면서 싸운다
        if (def.preferredRange && distToPlayer < def.preferredRange - 3) {
          const dx = p.x - pp.x
          const dz = p.z - pp.z
          const len = Math.hypot(dx, dz) || 1
          setMoveTarget(world, e, { x: p.x + (dx / len) * 2, z: p.z + (dz / len) * 2 })
        } else {
          clearMoveTarget(world, e)
        }
        if (e.attack && playerAlive && res.time.now >= e.attack.readyAt) {
          e.attack.readyAt = res.time.now + e.attack.cooldown
          if (e.enemy.kind === "archer") {
            fireProjectile(world, e, { x: pp.x, z: pp.z }, target)
          } else if (target) {
            meleeStrike(world, res, e, [target])
          }
        }
        break
      }
      case "return":
        setMoveTarget(world, e, { x: e.enemy.home.x, z: e.enemy.home.z })
        break
    }
  }
}
