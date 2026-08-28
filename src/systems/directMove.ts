import type { GameWorld, Resources, Vec2 } from "../core/world"
import { moveWithWalls } from "./movement"

/**
 * WASD 직접 이동.
 *
 * 클릭 이동(길찾기)과 달리 누른 방향으로 즉시 움직인다. 둘은 공존하되
 * **키가 눌려 있는 동안에는 직접 이동이 우선**한다 — 그렇지 않으면 클릭으로 잡아 둔
 * 목표와 키 입력이 서로 잡아당겨 캐릭터가 떨린다.
 *
 * 카메라가 회전하지 않으므로 화면 기준과 월드 기준이 고정 대응한다.
 *   W/↑ = -Z (화면 위) · S/↓ = +Z · A/← = -X · D/→ = +X
 */

const KEY_DIRS: Record<string, Vec2> = {
  KeyW: { x: 0, z: -1 },
  ArrowUp: { x: 0, z: -1 },
  KeyS: { x: 0, z: 1 },
  ArrowDown: { x: 0, z: 1 },
  KeyA: { x: -1, z: 0 },
  ArrowLeft: { x: -1, z: 0 },
  KeyD: { x: 1, z: 0 },
  ArrowRight: { x: 1, z: 0 },
}

/** 눌린 키들을 합쳐 정규화된 방향을 만든다. 대각선이 더 빠르지 않도록 한다. */
export function directionFromKeys(held: Iterable<string>): Vec2 | null {
  let x = 0
  let z = 0
  for (const code of held) {
    const dir = KEY_DIRS[code]
    if (!dir) continue
    x += dir.x
    z += dir.z
  }
  const len = Math.hypot(x, z)
  if (len === 0) return null
  return { x: x / len, z: z / len }
}

export function directMoveSystem(world: GameWorld, res: Resources, dt: number): void {
  const player = world.with("player", "transform").entities[0]
  if (!player || player.dead) return

  const dir = directionFromKeys(res.input.held)
  if (!dir) return

  // 돌진·넉백 중에는 조작을 빼앗지 않는다
  if (player.knockback && res.time.now < player.knockback.until) return
  if (player.hitstun && res.time.now < player.hitstun.until) return
  // 스킬 windup/recovery 동안에는 이동 입력이 시전 상태를 덮어쓰지 않게 한다.
  if (player.action?.kind === "skill") return

  // 키를 잡은 순간 클릭 이동과 자동 추격을 놓는다
  if (player.moveTarget) world.removeComponent(player, "moveTarget")
  if (player.path) world.removeComponent(player, "path")
  if (player.attackIntent) world.removeComponent(player, "attackIntent")

  const p = player.transform.position
  const speed = player.player.moveSpeed
  const next = moveWithWalls(
    res.map,
    { x: p.x, z: p.z },
    { x: dir.x * speed * dt, z: dir.z * speed * dt },
    player.radius ?? 0.45,
  )
  if (Math.hypot(next.x - p.x, next.z - p.z) > 1e-6) {
    player.transform.yaw = Math.atan2(dir.x, dir.z)
  }
  p.x = next.x
  p.z = next.z
}
