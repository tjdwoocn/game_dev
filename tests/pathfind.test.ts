import { describe, it, expect } from "vitest"
import { findPath, hasLineOfSight, circleFits } from "../src/core/pathfind"
import { parseMap, TILE, isWalkable } from "../src/content/map"

const R = 0.45

// 좌우 두 방이 col 4 벽으로 나뉘고, 아래쪽 row 5 로만 통행 가능
const TWO_ROOMS = parseMap([
  "#########",
  "#...#...#",
  "#...#...#",
  "#...#...#",
  "#...#...#",
  "#.......#",
  "#########",
])

const OPEN = parseMap([
  "#######",
  "#.....#",
  "#.....#",
  "#.....#",
  "#######",
])

const cell = (c: number, r: number) => ({ x: c * TILE, z: r * TILE })

describe("circleFits", () => {
  it("개활지 중심은 통과", () => {
    expect(circleFits(OPEN, 2 * TILE, 2 * TILE, R)).toBe(true)
  })
  it("벽에 붙으면 실패", () => {
    expect(circleFits(OPEN, 1 * TILE, 1 * TILE - 0.9, R)).toBe(false)
  })
})

describe("hasLineOfSight", () => {
  it("같은 방 안에서는 시야 확보", () => {
    expect(hasLineOfSight(OPEN, cell(1, 1), cell(5, 3), R)).toBe(true)
  })

  it("벽 너머는 시야 차단", () => {
    expect(hasLineOfSight(TWO_ROOMS, cell(1, 1), cell(7, 1), R)).toBe(false)
  })

  it("자기 자신은 항상 보임", () => {
    expect(hasLineOfSight(TWO_ROOMS, cell(1, 1), cell(1, 1), R)).toBe(true)
  })
})

describe("findPath", () => {
  it("시야가 트인 목표는 중간 경유 없이 한 노드", () => {
    const path = findPath(OPEN, cell(1, 1), cell(5, 3), R)
    expect(path).not.toBeNull()
    expect(path!.length).toBe(1)
    expect(path![0]!.x).toBeCloseTo(5 * TILE)
    expect(path![0]!.z).toBeCloseTo(3 * TILE)
  })

  it("벽은 우회 경로를 만든다", () => {
    const start = cell(1, 1)
    const path = findPath(TWO_ROOMS, start, cell(7, 1), R)
    expect(path).not.toBeNull()
    expect(path!.length).toBeGreaterThan(1)
    // 마지막 노드는 목표
    const last = path![path!.length - 1]!
    expect(last.x).toBeCloseTo(7 * TILE)
    expect(last.z).toBeCloseTo(1 * TILE)
  })

  it("우회 경로의 모든 구간은 실제로 이동 가능하다", () => {
    const start = cell(1, 1)
    const path = findPath(TWO_ROOMS, start, cell(7, 1), R)!
    let from = start
    for (const node of path) {
      expect(isWalkable(TWO_ROOMS, node.x, node.z)).toBe(true)
      expect(hasLineOfSight(TWO_ROOMS, from, node, R)).toBe(true)
      from = node
    }
  })

  it("도달 불가능한 목표는 null", () => {
    const walled = parseMap([
      "#####",
      "#.#.#",
      "#.#.#",
      "#####",
    ])
    expect(findPath(walled, cell(1, 1), cell(3, 1), R)).toBeNull()
  })

  it("목표가 벽이라도 인접한 통행 가능 지점까지는 간다", () => {
    // cell(3,0) 은 위쪽 벽. 바로 아래 cell(3,1) 로 붙어야 한다.
    const path = findPath(OPEN, cell(1, 1), cell(3, 0), R)
    expect(path).not.toBeNull()
    const last = path![path!.length - 1]!
    expect(isWalkable(OPEN, last.x, last.z)).toBe(true)
    expect(Math.hypot(last.x - 3 * TILE, last.z - 0 * TILE)).toBeLessThanOrEqual(TILE * 1.5)
  })

  it("목표가 벽이고 다가갈 여지도 없으면 null", () => {
    // 시작 지점이 곧 최선인 경우 — 전진할 이유가 없다
    expect(findPath(OPEN, cell(1, 1), cell(0, 0), R)).toBeNull()
  })
})
