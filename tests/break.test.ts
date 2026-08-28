import { describe, expect, it } from "vitest"
import { applyBreakDamage, beginBreakWindow, isBreakExposed, isFocused } from "../src/systems/break"

const makeBreakable = () => ({
  current: 100, max: 100, exposedUntil: 0, brokenUntil: 0, vulnerabilityUntil: 0,
})

describe("boss break windows", () => {
  it("예고 시간 안에서만 브레이크 게이지가 줄어든다", () => {
    const b = makeBreakable()
    beginBreakWindow(b, 10, 0.8)
    expect(isBreakExposed(b, 10.4)).toBe(true)
    expect(applyBreakDamage(b, 28, 10.4)).toMatchObject({ applied: true, broke: false, remaining: 72 })
    expect(applyBreakDamage(b, 28, 11)).toMatchObject({ applied: false, broke: false, remaining: 72 })
  })

  it("게이지를 모두 깎으면 무력화와 집중 공격 시간이 열린다", () => {
    const b = makeBreakable()
    beginBreakWindow(b, 20, 1)
    const result = applyBreakDamage(b, 100, 20.5)
    expect(result).toMatchObject({ applied: true, broke: true, remaining: 0 })
    expect(b.brokenUntil).toBe(23.5)
    expect(isFocused(b, 22)).toBe(true)
    expect(isBreakExposed(b, 22)).toBe(false)
  })
})
