import { SKILLS } from "../content/skills"
import { hasLineOfSight } from "../core/pathfind"
import type { Entity, GameWorld, Resources, Vec2 } from "../core/world"

/**
 * 개발용 자동 플레이 봇. `?autoplay=1` 로 활성화된다.
 * 입구에서 보스방까지 웨이포인트를 따라가며 마주치는 적을 처리한다.
 * 사람이 지켜보며 전체 플레이 루프를 검증하는 용도.
 */

// 던전 동선: 입구홀 → 복도 → 전투방 3개 → 보스방
const WAYPOINTS: Vec2[] = [
  { x: 30, z: 56 },
  { x: 30, z: 52 },
  { x: 30, z: 48 },
  { x: 38, z: 46 },
  { x: 37, z: 42 },
  { x: 37, z: 40 },
  { x: 21, z: 36 },
  { x: 21, z: 32 },
  { x: 21, z: 28 },
  { x: 35, z: 22 },
  { x: 35, z: 16 },
  { x: 35, z: 12 },
  { x: 34, z: 8 },
]

const TICK = 0.25
const ENGAGE_RANGE = 13
const WHIRLWIND_RANGE = 3.5
const WAYPOINT_ARRIVE = 2.5

let waypointIndex = 0
let nextTickAt = 0

function setComponent<K extends keyof Entity>(world: GameWorld, e: Entity, key: K, value: NonNullable<Entity[K]>) {
  if (e[key] !== undefined) world.removeComponent(e, key)
  world.addComponent(e, key, value)
}

export function autoplaySystem(world: GameWorld, res: Resources, dt: number): void {
  void dt
  const now = res.time.now
  if (now < nextTickAt) return
  nextTickAt = now + TICK

  const player = world.with("player", "transform", "health").entities[0]
  if (!player || player.dead) return
  const pc = player.player
  const pp = player.transform.position

  const living: { e: Entity; dist: number }[] = []
  for (const e of world.with("enemy", "transform", "health")) {
    if (e.dead) continue
    const ep = e.transform.position
    const dist = Math.hypot(ep.x - pp.x, ep.z - pp.z)
    // 일반 적은 벽 너머로 끌려가지 않게 시야를 확인하되, 보스는
    // 보스방 연출용 벽 때문에 시야가 잠깐 끊겨도 계속 추적한다.
    if (dist > ENGAGE_RANGE || (!e.boss && !hasLineOfSight(res.map, pp, ep, player.radius ?? 0.45))) continue
    living.push({ e, dist })
  }
  living.sort((a, b) => a.dist - b.dist)

  const engaged = living
  if (engaged.length > 0) {
    const nearest = engaged[0]!
    const boss = engaged.find((t) => t.e.boss)
    if (boss) {
      const bossEntity = boss.e
      const bossPos = bossEntity.transform!.position
      const bossBreak = bossEntity.breakable
      // 보스 예고 중에는 공격을 아껴두지 않고 실제 스킬로 브레이크를 시도한다.
      if (bossBreak && bossBreak.exposedUntil > now && bossBreak.brokenUntil <= now) {
        if (pc.rage >= SKILLS.whirlwind.rageCost && boss.dist <= WHIRLWIND_RANGE + 1.5) {
          setComponent(world, player, "skillIntent", { skill: "whirlwind", point: { x: bossPos.x, z: bossPos.z } })
        } else if (now >= pc.cooldowns.dash) {
          setComponent(world, player, "skillIntent", { skill: "dash", point: { x: bossPos.x, z: bossPos.z } })
        } else {
          setComponent(world, player, "attackIntent", { target: bossEntity })
        }
        return
      }
      setComponent(world, player, "attackIntent", { target: bossEntity })
      return
    }
    const clustered = engaged.filter((t) => t.dist <= WHIRLWIND_RANGE).length

    if (clustered >= 2 && pc.rage >= SKILLS.whirlwind.rageCost) {
      setComponent(world, player, "skillIntent", { skill: "whirlwind", point: { x: pp.x, z: pp.z } })
      return
    }

    const np = nearest.e.transform!.position
    if (nearest.dist > 5 && nearest.dist < 11 && now >= pc.cooldowns.dash) {
      setComponent(world, player, "skillIntent", { skill: "dash", point: { x: np.x, z: np.z } })
      return
    }

    setComponent(world, player, "attackIntent", { target: nearest.e })
    return
  }

  // 적이 없으면 다음 웨이포인트로 전진
  if (player.attackIntent) world.removeComponent(player, "attackIntent")
  const wp = WAYPOINTS[waypointIndex]
  if (!wp) return
  if (Math.hypot(wp.x - pp.x, wp.z - pp.z) < WAYPOINT_ARRIVE) {
    waypointIndex = Math.min(waypointIndex + 1, WAYPOINTS.length - 1)
    return
  }
  setComponent(world, player, "moveTarget", { x: wp.x, z: wp.z })
}

export function isAutoplayEnabled(): boolean {
  return new URLSearchParams(location.search).get("autoplay") === "1"
}
