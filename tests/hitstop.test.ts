import { describe, expect, it } from "vitest"
import { advanceHitstop, createHitstop, isHitstopActive, requestHitstop } from "../src/core/hitstop"

describe("hitstop", () => {
  it("slows simulation time while real time continues", () => {
    const state = createHitstop()
    requestHitstop(state, 100)

    expect(isHitstopActive(state)).toBe(true)
    expect(advanceHitstop(state, 0.016)).toBeCloseTo(0.0008)
    expect(state.remaining).toBeCloseTo(0.084)
  })

  it("preserves the normal part of a step that crosses the end", () => {
    const state = createHitstop()
    requestHitstop(state, 20, 0.5)

    expect(advanceHitstop(state, 0.05)).toBeCloseTo(0.04)
    expect(isHitstopActive(state)).toBe(false)
    expect(state.scale).toBe(1)
  })

  it("keeps the longer overlapping request", () => {
    const state = createHitstop()
    requestHitstop(state, 40)
    requestHitstop(state, 90)

    expect(state.remaining).toBeCloseTo(0.09)
    expect(advanceHitstop(state, 0.09)).toBeCloseTo(0.0045)
    expect(isHitstopActive(state)).toBe(false)
  })
})
