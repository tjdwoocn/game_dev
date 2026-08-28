import { describe, it, expect } from "vitest"
import { parseMap, isWalkable, TILE, DUNGEON } from "../src/content/map"

const MINI = ["#####", "#P.w#", "#..B#", "#####"]

describe("parseMap", () => {
  const m = parseMap(MINI)

  it("스폰 추출", () => {
    expect(m.playerSpawn).toEqual({ x: 1 * TILE, z: 1 * TILE })
    expect(m.spawns).toEqual([{ kind: "warrior", x: 3 * TILE, z: 1 * TILE }])
    expect(m.bossSpawn).toEqual({ x: 3 * TILE, z: 2 * TILE })
  })

  it("통행 판정: 벽/바닥/경계 밖", () => {
    expect(isWalkable(m, 1 * TILE, 1 * TILE)).toBe(true)
    expect(isWalkable(m, 0, 0)).toBe(false)
    expect(isWalkable(m, -999, 0)).toBe(false)
  })

  it("스폰 지점 문자는 바닥으로 취급", () => {
    expect(isWalkable(m, 3 * TILE, 2 * TILE)).toBe(true)
  })

  it("정예 좌표는 맵 문자와 분리해 스폰에 표시한다", () => {
    const eliteMap = parseMap(["#####", "#P.w#", "#..B#"], [{ col: 3, row: 1 }])
    expect(eliteMap.spawns).toEqual([{ kind: "warrior", x: 3 * TILE, z: 1 * TILE, isElite: true }])
  })
})

describe("DUNGEON", () => {
  it("실전 맵은 플레이어/보스/적 스폰을 모두 가진다", () => {
    expect(DUNGEON.playerSpawn).toBeDefined()
    expect(DUNGEON.bossSpawn).toBeDefined()
    expect(DUNGEON.spawns.filter((s) => s.kind === "warrior").length).toBeGreaterThanOrEqual(4)
    expect(DUNGEON.spawns.filter((s) => s.kind === "archer").length).toBeGreaterThanOrEqual(2)
  })

  it("모든 행의 길이가 동일하다", () => {
    expect(DUNGEON.cols).toBe(36)
    expect(DUNGEON.rows).toBe(33)
  })

  it("플레이어/보스 스폰 지점은 통행 가능하다", () => {
    expect(isWalkable(DUNGEON, DUNGEON.playerSpawn.x, DUNGEON.playerSpawn.z)).toBe(true)
    expect(isWalkable(DUNGEON, DUNGEON.bossSpawn.x, DUNGEON.bossSpawn.z)).toBe(true)
  })
})
