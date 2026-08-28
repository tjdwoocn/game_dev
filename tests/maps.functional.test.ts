import { describe, it, expect } from "vitest"
import { parseMap, isWalkable, worldToCell, TILE, DUNGEON_LAYOUT, type DungeonMap } from "../src/content/map"
import { findPath, circleFits } from "../src/core/pathfind"
import { ENEMY_DEFS } from "../src/content/enemies"
import { MAP_LAYOUTS } from "../src/content/maps"
import { ZONE_DEFS } from "../src/content/zones"

/**
 * 맵이 "그려졌다"와 "플레이할 수 있다"는 다른 문제다.
 *
 * 새 맵들은 아직 존 시스템이 없어 브라우저로 직접 플레이할 수 없으므로,
 * 게임이 실제로 쓰는 함수(findPath, circleFits, isWalkable)를 그대로 돌려
 * 기능적으로 성립하는지 검증한다. 밸런스가 아니라 동작 가능 여부만 본다.
 */

const PLAYER_RADIUS = 0.45
const MAX_UNIT_RADIUS = Math.max(
  PLAYER_RADIUS,
  ...Object.values(ENEMY_DEFS).map((d) => d.radius),
)

/**
 * 목표에 "실제로 닿는지" 판정한다.
 *
 * findPath 는 도달 불가일 때 null 이 아니라 갈 수 있는 데까지의 경로를 돌려준다
 * (벽을 클릭해도 최대한 접근하는 동작). 그래서 null 여부만 보면 절대 실패하지 않는
 * 검사가 되어 버린다. 경로의 마지막 지점이 목표에 닿았는지까지 봐야 한다.
 */
function canReach(map: DungeonMap, from: { x: number; z: number }, to: { x: number; z: number }, radius: number): boolean {
  const path = findPath(map, from, to, radius)
  if (!path || path.length === 0) return false
  const last = path[path.length - 1]!
  return Math.hypot(last.x - to.x, last.z - to.z) < TILE * 0.75
}

/** findPath 의 A* 와 같은 이웃 규칙 (8방향, 대각 모서리 끼임 금지) */
const DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]

function cellWalkable(map: DungeonMap, c: number, r: number): boolean {
  if (r < 0 || r >= map.rows || c < 0 || c >= map.cols) return false
  return !(map.walls[r]?.[c] ?? true)
}

function allWalkableCells(map: DungeonMap): { c: number; r: number }[] {
  const out: { c: number; r: number }[] = []
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) if (cellWalkable(map, c, r)) out.push({ c, r })
  }
  return out
}

/** 시작 칸에서 실제로 걸어서 닿을 수 있는 칸 집합 */
function reachableCells(map: DungeonMap, start: { c: number; r: number }): Set<number> {
  const key = (c: number, r: number) => r * map.cols + c
  const seen = new Set<number>([key(start.c, start.r)])
  const queue = [start]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const [dc, dr] of DIRS) {
      const nc = cur.c + dc
      const nr = cur.r + dr
      if (!cellWalkable(map, nc, nr)) continue
      if (dc !== 0 && dr !== 0) {
        if (!cellWalkable(map, cur.c + dc, cur.r) || !cellWalkable(map, cur.c, cur.r + dr)) continue
      }
      const k = key(nc, nr)
      if (seen.has(k)) continue
      seen.add(k)
      queue.push({ c: nc, r: nr })
    }
  }
  return seen
}

describe("유닛 크기와 격자 길찾기의 정합성", () => {
  it("모든 유닛 반지름이 타일 절반보다 작다", () => {
    // A* 는 칸 단위로 길을 찾고 반지름을 보지 않는다. 유닛이 타일 절반보다 크면
    // "길은 있는데 몸이 안 들어가는" 칸이 생긴다. 보스 반지름이 커지면 여기서 걸린다.
    expect(MAX_UNIT_RADIUS).toBeLessThan(TILE / 2)
  })
})

// 실제로 플레이되는 맵(DUNGEON)도 같은 기준으로 검증한다.
const ALL_LAYOUTS: [string, string[]][] = [
  ["dungeon(플레이중)", DUNGEON_LAYOUT],
  ...Object.entries(MAP_LAYOUTS),
]

describe.each(ALL_LAYOUTS)("맵 %s — 기능 검증", (id, layout) => {
  const map = parseMap(layout)
  const spawnCell = { c: worldToCell(map.playerSpawn.x), r: worldToCell(map.playerSpawn.z) }
  const hasBoss = layout.join("").includes("B")

  it("가장 큰 유닛이 모든 통행 칸에 실제로 설 수 있다", () => {
    const stuck: string[] = []
    for (const cell of allWalkableCells(map)) {
      if (!circleFits(map, cell.c * TILE, cell.r * TILE, MAX_UNIT_RADIUS)) {
        stuck.push(`(${cell.c},${cell.r})`)
      }
    }
    expect(stuck, `${id}: 몸이 들어가지 않는 칸 ${stuck.slice(0, 5).join(" ")}`).toEqual([])
  })

  it("고립된 구역이 없다 — 모든 통행 칸에 걸어서 닿는다", () => {
    const all = allWalkableCells(map)
    const reachable = reachableCells(map, spawnCell)
    const orphans = all.filter((cell) => !reachable.has(cell.r * map.cols + cell.c))
    expect(
      orphans.map((o) => `(${o.c},${o.r})`),
      `${id}: 시작 지점에서 닿지 않는 칸 ${orphans.length}개`,
    ).toEqual([])
  })

  it("모든 적이 플레이어 시작 지점까지 갈 수 있다", () => {
    for (const spawn of map.spawns) {
      const radius = ENEMY_DEFS[spawn.kind].radius
      expect(
        circleFits(map, spawn.x, spawn.z, radius),
        `${id}: ${spawn.kind} 스폰 (${spawn.x},${spawn.z}) 에 몸이 들어가지 않음`,
      ).toBe(true)
      expect(
        canReach(map, { x: spawn.x, z: spawn.z }, map.playerSpawn, radius),
        `${id}: ${spawn.kind} 가 플레이어에게 접근 불가`,
      ).toBe(true)
    }
  })

  it("모든 적이 자기 자리로 되돌아갈 수 있다", () => {
    // AI 는 리쉬를 벗어나면 home 으로 복귀한다. 편도만 되고 복귀가 안 되면 그 자리에 굳는다.
    for (const spawn of map.spawns) {
      const radius = ENEMY_DEFS[spawn.kind].radius
      expect(
        canReach(map, map.playerSpawn, { x: spawn.x, z: spawn.z }, radius),
        `${id}: ${spawn.kind} 가 (${spawn.x},${spawn.z}) 로 복귀 불가`,
      ).toBe(true)
    }
  })

  it("보스가 있으면 보스도 플레이어에게 접근할 수 있다", () => {
    if (!hasBoss) return
    const r = ENEMY_DEFS.boss.radius
    expect(
      circleFits(map, map.bossSpawn.x, map.bossSpawn.z, r),
      `${id}: 보스 스폰에 몸이 들어가지 않음`,
    ).toBe(true)
    expect(
      canReach(map, map.bossSpawn, map.playerSpawn, r),
      `${id}: 보스가 플레이어에게 접근 불가`,
    ).toBe(true)
  })

  it("적 스폰이 서로 겹치지 않는다", () => {
    const keys = map.spawns.map((s) => `${s.x},${s.z}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("시작 지점이 적의 코앞이 아니다", () => {
    // 진입하자마자 얻어맞기 시작하면 조작을 익힐 틈이 없다. 난이도가 아니라 진입 동선 문제다.
    for (const spawn of map.spawns) {
      const dist = Math.hypot(spawn.x - map.playerSpawn.x, spawn.z - map.playerSpawn.z)
      expect(dist, `${id}: ${spawn.kind} 가 시작 지점에서 ${dist.toFixed(1)} 거리`).toBeGreaterThan(TILE * 2)
    }
  })

  it("시작 지점 주변에 움직일 공간이 있다", () => {
    let open = 0
    for (const [dc, dr] of DIRS) {
      if (isWalkable(map, map.playerSpawn.x + dc * TILE, map.playerSpawn.z + dr * TILE)) open++
    }
    expect(open, `${id}: 시작 지점 주변 통행 칸 ${open}개`).toBeGreaterThanOrEqual(3)
  })
})

/**
 * 스폰 칸이 곧 출구 칸이면, 플레이어는 던전에 들어서자마자 나가는 문 위에 서 있게 된다.
 *
 * 실제로 보스존 3곳이 그랬다. 진입 즉시 튕기는 증상은 `blockedExit` 로 막았지만
 * 그건 진입 순간만 막을 뿐이라, 보스와 싸우다 뒤로 물러나면 **실수로 마을에 튕겨 나갔다.**
 * 출구 표식을 세우고 나서야 눈에 보였다 — 그 전까지는 아무 표시가 없어 원인도 안 보였다.
 *
 * 좌표가 겹치는 종류의 버그는 눈으로 검토해서는 다시 못 잡는다. 여기서 막는다.
 */
describe("스폰 지점과 출구 칸", () => {
  it("어떤 존에서도 시작 지점이 물리 출구 위가 아니다", () => {
    // zone.ts 의 EXIT_RELEASE_RADIUS(2.5). 이보다 가까우면 출구 판정 안에서 시작한다.
    const RELEASE_RADIUS = 2.5
    const tooClose: string[] = []
    for (const zone of Object.values(ZONE_DEFS)) {
      const layout = MAP_LAYOUTS[zone.mapId]
      if (!layout) continue
      const map = parseMap(layout)
      for (const exit of zone.exits) {
        if (exit.interactionOnly || !exit.fromCell) continue
        const d = Math.hypot(
          map.playerSpawn.x - exit.fromCell.col * TILE,
          map.playerSpawn.z - exit.fromCell.row * TILE,
        )
        if (d <= RELEASE_RADIUS) {
          tooClose.push(`${zone.id}: 시작(${map.playerSpawn.x / TILE}, ${map.playerSpawn.z / TILE}) ↔ 출구(${exit.fromCell.col}, ${exit.fromCell.row}) 거리 ${d.toFixed(1)}`)
        }
      }
    }
    expect(tooClose, `출구 위에서 시작하는 존: ${tooClose.join(" / ")}`).toEqual([])
  })

  it("출구 칸 자체는 통행 가능하다", () => {
    // 벽 안에 출구를 두면 영원히 못 나간다
    const blocked: string[] = []
    for (const zone of Object.values(ZONE_DEFS)) {
      const layout = MAP_LAYOUTS[zone.mapId]
      if (!layout) continue
      const map = parseMap(layout)
      for (const exit of zone.exits) {
        if (exit.interactionOnly || !exit.fromCell) continue
        if (!isWalkable(map, exit.fromCell.col * TILE, exit.fromCell.row * TILE)) {
          blocked.push(`${zone.id} → (${exit.fromCell.col}, ${exit.fromCell.row})`)
        }
      }
    }
    expect(blocked, `벽 안에 있는 출구: ${blocked.join(", ")}`).toEqual([])
  })
})
