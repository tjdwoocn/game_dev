import type { DungeonMap } from "../content/map"
import { circleFits, findPath } from "../core/pathfind"
import type { Entity, GameWorld, Resources, Vec2 } from "../core/world"
import { ENEMY_DEFS } from "../content/enemies"

/** pos에서 target 방향으로 dist만큼 이동한 위치. 남은 거리가 짧으면 target에 스냅. */
export function stepToward(pos: Vec2, target: Vec2, dist: number): Vec2 {
  const dx = target.x - pos.x
  const dz = target.z - pos.z
  const len = Math.hypot(dx, dz)
  if (len <= dist || len === 0) return { x: target.x, z: target.z }
  return { x: pos.x + (dx / len) * dist, z: pos.z + (dz / len) * dist }
}

/** 벽 충돌을 고려한 이동. 축 분리 시도로 벽을 따라 미끄러진다. */
export function moveWithWalls(map: DungeonMap, pos: Vec2, delta: Vec2, radius: number): Vec2 {
  let x = pos.x
  let z = pos.z
  if (delta.x !== 0 && circleFits(map, x + delta.x, z, radius)) x += delta.x
  if (delta.z !== 0 && circleFits(map, x, z + delta.z, radius)) z += delta.z
  return { x, z }
}

/** 원 a가 원 b와 겹칠 때 a를 밀어낼 오프셋. 겹치지 않으면 0벡터. */
export function separate(a: Vec2, ra: number, b: Vec2, rb: number): Vec2 {
  const dx = a.x - b.x
  const dz = a.z - b.z
  const dist = Math.hypot(dx, dz)
  const minDist = ra + rb
  if (dist >= minDist) return { x: 0, z: 0 }
  if (dist === 0) return { x: minDist, z: 0 } // 완전 중첩: 임의 방향
  const push = minDist - dist
  return { x: (dx / dist) * push, z: (dz / dist) * push }
}

const NODE_ARRIVE = 0.3
const REPATH_DIST = 1.0
const STUCK_GIVEUP = 1.0

function stopMoving(world: GameWorld, e: Entity): void {
  if (e.moveTarget) world.removeComponent(e, "moveTarget")
  if (e.path) world.removeComponent(e, "path")
}

/** 적은 교전 중 플레이어가 직선으로 통과하지 못하도록 추격 속도를 사용한다. */
export function movementSpeed(e: Entity): number {
  if (e.player) return e.player.moveSpeed
  if (e.enemy) {
    const def = ENEMY_DEFS[e.enemy.kind]
    if (e.enemy.state === "chase") return def.chaseSpeed ?? def.speed
    return def.speed
  }
  return e.speed ?? 4
}

/** 일반 피격 경직을 적용하고 진행 중인 이동 명령을 즉시 끊는다. */
export function applyHitstun(world: GameWorld, e: Entity, until: number): void {
  if (e.hitstun) e.hitstun.until = Math.max(e.hitstun.until, until)
  else world.addComponent(e, "hitstun", { until })
  stopMoving(world, e)
}

export function applyKnockback(world: GameWorld, e: { knockback?: { dir: Vec2; speed: number; until: number } }, dir: Vec2, speed: number, until: number): void {
  const len = Math.hypot(dir.x, dir.z)
  if (len === 0 || speed <= 0 || until <= 0) return
  const normalized = { x: dir.x / len, z: dir.z / len }
  if (e.knockback) {
    e.knockback.dir = normalized
    e.knockback.speed = Math.max(e.knockback.speed, speed)
    e.knockback.until = Math.max(e.knockback.until, until)
  } else {
    world.addComponent(e, "knockback", { dir: normalized, speed, until })
  }
}

export function movementSystem(world: GameWorld, res: Resources, dt: number): void {
  const now = res.time.now

  for (const e of world.with("transform")) {
    if (e.dead) continue
    const p = e.transform.position
    const radius = e.radius ?? 0.4
    const hitstunned = !!e.hitstun && now < e.hitstun.until
    if (e.hitstun && !hitstunned) world.removeComponent(e, "hitstun")

    // 넉백/돌진이 이동보다 우선
    if (e.knockback && now < e.knockback.until) {
      const kb = e.knockback
      const next = moveWithWalls(res.map, p, { x: kb.dir.x * kb.speed * dt, z: kb.dir.z * kb.speed * dt }, radius)
      p.x = next.x
      p.z = next.z
      continue
    }
    if (e.knockback) world.removeComponent(e, "knockback")
    if (hitstunned) {
      stopMoving(world, e)
      continue
    }

    // 돌진은 길찾기 이동과 분리된 직선 이동이다. 방향은 windup 시점에
    // 잠겼고, 벽에서 멈추므로 이동량과 실제 접촉 경로를 같은 값으로 추적할 수 있다.
    if (e.enemyAction?.actionId === "charge" && e.enemyAction.phase === "active" && e.enemy) {
      const charge = ENEMY_DEFS[e.enemy.kind].charge
      if (charge) {
        const next = moveWithWalls(
          res.map,
          p,
          { x: e.enemyAction.dir.x * charge.speed * dt, z: e.enemyAction.dir.z * charge.speed * dt },
          radius,
        )
        p.x = next.x
        p.z = next.z
        e.transform.yaw = Math.atan2(e.enemyAction.dir.x, e.enemyAction.dir.z)
        continue
      }
    }

    if (!e.moveTarget) {
      if (e.path) world.removeComponent(e, "path")
      continue
    }

    // 목표가 바뀌었거나 경로가 없으면 재계산
    const goal = e.moveTarget
    if (!e.path || Math.hypot(e.path.goal.x - goal.x, e.path.goal.z - goal.z) > REPATH_DIST) {
      const nodes = findPath(res.map, p, goal, radius)
      if (!nodes) {
        stopMoving(world, e)
        continue
      }
      if (e.path) {
        e.path.nodes = nodes
        e.path.index = 0
        e.path.goal = { x: goal.x, z: goal.z }
        e.path.stuck = 0
      } else {
        world.addComponent(e, "path", { nodes, index: 0, goal: { x: goal.x, z: goal.z }, stuck: 0 })
      }
    }

    const path = e.path!
    // 이미 지난 노드는 건너뛴다
    while (path.index < path.nodes.length) {
      const n = path.nodes[path.index]!
      if (Math.hypot(n.x - p.x, n.z - p.z) < NODE_ARRIVE) path.index++
      else break
    }
    const node = path.nodes[path.index]
    if (!node) {
      stopMoving(world, e)
      continue
    }

    const speed = movementSpeed(e)
    const desired = stepToward(p, node, speed * dt)
    const next = moveWithWalls(res.map, p, { x: desired.x - p.x, z: desired.z - p.z }, radius)
    const moved = Math.hypot(next.x - p.x, next.z - p.z)
    if (moved > 1e-6) {
      e.transform.yaw = Math.atan2(next.x - p.x, next.z - p.z)
      path.stuck = 0
    } else {
      // 유닛끼리 끼이는 경우가 대부분이라 잠시 기다렸다가 포기한다
      path.stuck += dt
      if (path.stuck > STUCK_GIVEUP) stopMoving(world, e)
    }
    p.x = next.x
    p.z = next.z
  }

  // 유닛 간 원형 밀어내기 (살아있는 유닛만)
  // 소품은 내구도와 충돌체를 가졌지만 생명체가 아니다. 파괴되지 않았고
  // `blocksMovement`인 소품만 원형 충돌 프록시로 참여시킨다.
  const units = [
    ...world.with("transform", "radius", "health"),
    ...world.with("transform", "radius", "destructible"),
  ].filter((e) => !e.dead && (!e.destructible || (e.destructible.state === "intact" && e.destructible.blocksMovement)))
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i]!
      const b = units[j]!
      // 소품은 정적인 환경물이다. 소품을 적·소품 쪽으로 밀어 버리면 벽가의
      // 장식이 전투 무리 안으로 떠밀려 들어가고, 적의 길찾기 기준선도 바뀐다.
      // 첫 버전에서는 플레이어/동료만 소품에 막히게 하고, 소품 자체와 적은
      // 움직이지 않는다.
      if (a.destructible || b.destructible) {
        if (a.destructible && b.destructible) continue
        const prop = a.destructible ? a : b
        const unit = a.destructible ? b : a
        if (!unit.player && !unit.companion) continue
        const pp = prop.transform!.position
        const up = unit.transform!.position
        const off = separate(up, unit.radius!, pp, prop.radius)
        if (off.x !== 0 || off.z !== 0) {
          const next = moveWithWalls(res.map, up, { x: off.x, z: off.z }, unit.radius!)
          up.x = next.x
          up.z = next.z
        }
        continue
      }
      const pa = a.transform!.position
      const pb = b.transform!.position
      const off = separate(pa, a.radius!, pb, b.radius!)
      if (off.x !== 0 || off.z !== 0) {
        const halfA = moveWithWalls(res.map, pa, { x: off.x * 0.5, z: off.z * 0.5 }, a.radius!)
        pa.x = halfA.x
        pa.z = halfA.z
        const halfB = moveWithWalls(res.map, pb, { x: -off.x * 0.5, z: -off.z * 0.5 }, b.radius!)
        pb.x = halfB.x
        pb.z = halfB.z
      }
    }
  }
}
