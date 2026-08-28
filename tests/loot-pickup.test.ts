import { describe, expect, it } from "vitest"
import { PICKUP_RADIUS } from "../src/systems/loot"

describe("loot pickup range", () => {
  it("근접 공격 사거리보다 넓다", () => {
    expect(PICKUP_RADIUS).toBeGreaterThanOrEqual(1.6)
  })
})
