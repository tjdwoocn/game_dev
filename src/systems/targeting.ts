import type { Entity, GameWorld, Vec2 } from "../core/world"

/**
 * 클릭 관대함 — "적을 정확히 찍어야만 공격이 나간다" 를 없앤다.
 *
 * 지금까지는 레이캐스트가 적 메시를 정확히 맞춰야만 공격이었고, 조금이라도 빗나가면
 * 그대로 **이동 명령**이 됐다. 적 옆으로 걸어가 버리니 조작이 답답할 수밖에 없다.
 * 디아블로류는 적 근처를 찍으면 공격이 나간다.
 *
 * 두 겹으로 관대하게 잡는다.
 *  1. 화면상 `GRAB_PX` 픽셀 안 — 사람이 "저기 찍었다" 고 느끼는 기준은 픽셀이다.
 *  2. 그 클릭이 가리키는 지면 지점에서 월드 `GRAB_WORLD` 안 — 저각 카메라에서
 *     화면상으로만 겹쳐 보이는 먼 적을 잘못 집는 것을 막는다.
 *
 * 그리고 **코앞의 적은 방향만 맞으면 잡는다.** 사거리 안에 적이 붙어 있는데 클릭이
 * 빗나가 뒤로 걸어가 버리는 것이 가장 답답한 경우라서다.
 *
 * 투영은 인자로 받는다. 렌더 모듈(카메라)에 묶이지 않아야 규칙만 따로 테스트할 수 있고,
 * `render.ts` 는 지금 다른 사람이 쓰는 파일이라 의존을 만들지 않는 편이 안전하다.
 */
export const GRAB_PX = 52
export const GRAB_WORLD = 3
/** 코앞 판정: 사거리에 이만큼 여유를 준다 */
export const ADJACENT_SLACK = 0.9
/** 코앞 적을 잡을 클릭 방향 허용각(라디안). 뒤쪽을 찍으면 잡지 않는다. */
export const ADJACENT_ARC = Math.PI * 0.55

export type Project = (x: number, y: number, z: number) => { x: number; y: number }

/** 클릭 지점 근처의 적을 고른다. 없으면 null — 호출 측이 이동으로 처리한다. */
export function grabEnemyNear(
  world: GameWorld,
  player: Entity,
  clickPx: { x: number; y: number },
  ground: Vec2 | null,
  project: Project,
): Entity | null {
  const pp = player.transform?.position
  if (!pp) return null
  const reach = (player.attack?.range ?? 1.6) + ADJACENT_SLACK

  let best: Entity | null = null
  let bestScore = Infinity

  for (const e of world.with("enemy", "transform", "health")) {
    if (e.dead) continue
    const ep = e.transform.position
    const s = project(ep.x, 1, ep.z)
    const pxDist = Math.hypot(s.x - clickPx.x, s.y - clickPx.y)

    // 1) 화면 근접 + 지면 근접
    if (pxDist <= GRAB_PX) {
      const worldOk = !ground || Math.hypot(ep.x - ground.x, ep.z - ground.z) <= GRAB_WORLD
      if (worldOk && pxDist < bestScore) {
        best = e
        bestScore = pxDist
      }
      continue
    }

    // 2) 코앞의 적 — 클릭이 그쪽을 향하고 있으면 잡는다
    if (!ground) continue
    if (Math.hypot(ep.x - pp.x, ep.z - pp.z) > reach) continue
    const clickYaw = Math.atan2(ground.x - pp.x, ground.z - pp.z)
    const enemyYaw = Math.atan2(ep.x - pp.x, ep.z - pp.z)
    let d = Math.abs(clickYaw - enemyYaw)
    if (d > Math.PI) d = Math.PI * 2 - d
    if (d > ADJACENT_ARC) continue
    // 화면 근접(0~52)과 섞이지 않도록 별도 점수대를 준다 — 화면 근접이 항상 우선이다
    const score = 1000 + d
    if (score < bestScore) {
      best = e
      bestScore = score
    }
  }
  return best
}
