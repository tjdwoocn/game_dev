import { TILE, isWalkable, worldToCell, type DungeonMap } from "../content/map"
import type { Vec2 } from "./world"

/** 반지름 radius 인 원이 (x,z)에 놓일 수 있는지 (벽에 겹치지 않는지) */
export function circleFits(map: DungeonMap, x: number, z: number, radius: number): boolean {
  return (
    isWalkable(map, x + radius, z) &&
    isWalkable(map, x - radius, z) &&
    isWalkable(map, x, z + radius) &&
    isWalkable(map, x, z - radius)
  )
}

/** a에서 b까지 직선으로 이동 가능한지 (경로 스무딩과 직선 이동 판정에 사용) */
export function hasLineOfSight(map: DungeonMap, a: Vec2, b: Vec2, radius: number): boolean {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const dist = Math.hypot(dx, dz)
  if (dist === 0) return circleFits(map, a.x, a.z, radius)
  const steps = Math.ceil(dist / (TILE * 0.35))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    if (!circleFits(map, a.x + dx * t, a.z + dz * t, radius)) return false
  }
  return true
}

interface CellNode {
  c: number
  r: number
  g: number
  f: number
  parent: CellNode | null
}

const DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]

function cellWalkable(map: DungeonMap, c: number, r: number): boolean {
  if (r < 0 || r >= map.rows || c < 0 || c >= map.cols) return false
  return !(map.walls[r]?.[c] ?? true)
}

function octile(ac: number, ar: number, bc: number, br: number): number {
  const dc = Math.abs(ac - bc)
  const dr = Math.abs(ar - br)
  return dc + dr + (Math.SQRT2 - 2) * Math.min(dc, dr)
}

/**
 * 격자 A* 로 start → goal 경로를 찾고, 시야 기반 스무딩으로 불필요한 경유점을 제거한다.
 * 반환값은 순서대로 향할 월드 좌표 목록(start 제외, goal 포함). 도달 불가면 null.
 */
const SNAP_SEARCH_RADIUS = 6

/** 목표 셀이 벽이면 주변에서 가장 가까운 통행 가능 셀을 찾는다. */
function snapToWalkable(map: DungeonMap, gc: number, gr: number): { c: number; r: number } | null {
  if (cellWalkable(map, gc, gr)) return { c: gc, r: gr }
  for (let ring = 1; ring <= SNAP_SEARCH_RADIUS; ring++) {
    let bestCell: { c: number; r: number } | null = null
    let bestDist = Infinity
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue
        const c = gc + dc
        const r = gr + dr
        if (!cellWalkable(map, c, r)) continue
        const d = Math.hypot(dc, dr)
        if (d < bestDist) {
          bestDist = d
          bestCell = { c, r }
        }
      }
    }
    if (bestCell) return bestCell
  }
  return null
}

export function findPath(map: DungeonMap, start: Vec2, goal: Vec2, radius: number): Vec2[] | null {
  const rawC = worldToCell(goal.x)
  const rawR = worldToCell(goal.z)
  const snapped = snapToWalkable(map, rawC, rawR)
  if (!snapped) return null
  const goalBlocked = snapped.c !== rawC || snapped.r !== rawR
  const gc = snapped.c
  const gr = snapped.r
  // 목표가 벽이었다면 대신 스냅된 셀 중심을 향한다
  const target: Vec2 = goalBlocked ? { x: gc * TILE, z: gr * TILE } : { x: goal.x, z: goal.z }

  const sc = worldToCell(start.x)
  const sr = worldToCell(start.z)
  if (sc === gc && sr === gr && goalBlocked) return null // 이미 최선의 위치

  // 직선으로 갈 수 있으면 A* 생략
  if (hasLineOfSight(map, start, target, radius)) return [target]

  if (!cellWalkable(map, sc, sr)) return null

  const open: CellNode[] = [{ c: sc, r: sr, g: 0, f: octile(sc, sr, gc, gr), parent: null }]
  const best = new Map<number, number>()
  const key = (c: number, r: number) => r * map.cols + c
  best.set(key(sc, sr), 0)

  let goalNode: CellNode | null = null
  // 도달 불가일 때를 대비해, 목표에 가장 가까웠던 지점을 기억해 둔다 (차선 경로)
  let closest: CellNode = open[0]!
  let closestH = octile(sc, sr, gc, gr)
  const startH = closestH

  while (open.length > 0) {
    let bi = 0
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i
    const cur = open.splice(bi, 1)[0]!
    const h = octile(cur.c, cur.r, gc, gr)
    if (h < closestH) {
      closestH = h
      closest = cur
    }
    if (cur.c === gc && cur.r === gr) {
      goalNode = cur
      break
    }
    for (const [dc, dr] of DIRS) {
      const nc = cur.c + dc
      const nr = cur.r + dr
      if (!cellWalkable(map, nc, nr)) continue
      // 대각 이동 시 모서리 끼임 방지
      if (dc !== 0 && dr !== 0) {
        if (!cellWalkable(map, cur.c + dc, cur.r) || !cellWalkable(map, cur.c, cur.r + dr)) continue
      }
      const step = dc !== 0 && dr !== 0 ? Math.SQRT2 : 1
      const ng = cur.g + step
      const k = key(nc, nr)
      if (ng >= (best.get(k) ?? Infinity)) continue
      best.set(k, ng)
      open.push({ c: nc, r: nr, g: ng, f: ng + octile(nc, nr, gc, gr), parent: cur })
    }
  }
  // 목표에 못 닿으면 가장 가까이 갔던 지점까지라도 간다 (벽 클릭 시 최대한 접근)
  const endNode = goalNode ?? closest
  if (!goalNode && closestH >= startH - 0.5) return null // 전진할 여지가 없음

  // 셀 경로 → 월드 좌표
  const cells: Vec2[] = []
  for (let n: CellNode | null = endNode; n; n = n.parent) {
    cells.push({ x: n.c * TILE, z: n.r * TILE })
  }
  cells.reverse()
  cells.shift() // 시작 셀 제거
  if (goalNode) cells.push(target) // 정확한 목표 지점
  if (cells.length === 0) return null

  // 시야 스무딩: 멀리 있는 노드로 바로 갈 수 있으면 중간 노드 생략
  const points: Vec2[] = [{ x: start.x, z: start.z }, ...cells]
  const out: Vec2[] = []
  let i = 0
  while (i < points.length - 1) {
    let j = points.length - 1
    while (j > i + 1 && !hasLineOfSight(map, points[i]!, points[j]!, radius)) j--
    out.push(points[j]!)
    i = j
  }
  return out
}
