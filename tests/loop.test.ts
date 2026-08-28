import { describe, it, expect } from "vitest"
import { stepAccumulator, STEP } from "../src/core/loop"

describe("stepAccumulator", () => {
  it("누적 시간에서 고정 스텝 횟수를 뽑아낸다", () => {
    const r = stepAccumulator(0.05)
    expect(r.steps).toBe(3)
    expect(r.remainder).toBeCloseTo(0.05 - 3 * STEP, 10)
  })

  it("스텝 미만의 누적은 스텝 0회, 잔여 유지", () => {
    const r = stepAccumulator(0.01)
    expect(r.steps).toBe(0)
    expect(r.remainder).toBeCloseTo(0.01, 10)
  })

  it("프레임 스파이크는 최대 5스텝으로 클램프", () => {
    const r = stepAccumulator(1.0)
    expect(r.steps).toBe(5)
    expect(r.remainder).toBe(0)
  })
})
