import { describe, it, expect } from "vitest"
import { stepToward, moveWithWalls, separate } from "../src/systems/movement"
import { parseMap, TILE } from "../src/content/map"

describe("stepToward", () => {
  it("목표 방향으로 정확히 dist만큼 이동", () => {
    const p = stepToward({ x: 0, z: 0 }, { x: 10, z: 0 }, 1)
    expect(p.x).toBeCloseTo(1)
    expect(p.z).toBeCloseTo(0)
  })

  it("남은 거리가 dist보다 짧으면 목표에 스냅", () => {
    expect(stepToward({ x: 0, z: 0 }, { x: 0.5, z: 0 }, 1)).toEqual({ x: 0.5, z: 0 })
  })
})

describe("moveWithWalls", () => {
  const m = parseMap(["#####", "#P..#", "#####"])

  it("벽으로 파고들지 못하고, 평행 성분은 유지(슬라이드)", () => {
    const start = { x: 1 * TILE, z: 1 * TILE }
    const out = moveWithWalls(m, start, { x: 0.5, z: -5 }, 0.45) // 위쪽(z-)은 벽
    expect(out.x).toBeCloseTo(start.x + 0.5)
    expect(out.z).toBe(start.z)
  })

  it("열린 방향은 그대로 통과", () => {
    const start = { x: 1 * TILE, z: 1 * TILE }
    const out = moveWithWalls(m, start, { x: 1, z: 0 }, 0.45)
    expect(out.x).toBeCloseTo(start.x + 1)
  })
})

describe("separate", () => {
  it("겹친 두 원에서 a를 밀어낼 오프셋 반환", () => {
    const off = separate({ x: 0, z: 0 }, 0.5, { x: 0.6, z: 0 }, 0.5)
    expect(off.x).toBeCloseTo(-0.4, 5)
    expect(off.z).toBeCloseTo(0)
  })

  it("안 겹치면 0", () => {
    expect(separate({ x: 0, z: 0 }, 0.4, { x: 2, z: 0 }, 0.4)).toEqual({ x: 0, z: 0 })
  })

  it("완전히 같은 위치면 임의 방향으로라도 밀어낸다", () => {
    const off = separate({ x: 1, z: 1 }, 0.4, { x: 1, z: 1 }, 0.4)
    expect(Math.hypot(off.x, off.z)).toBeGreaterThan(0)
  })
})
