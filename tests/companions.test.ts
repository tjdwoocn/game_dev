import { describe, expect, it } from "vitest"
import { COMPANION_DEFS, spawnCompanion } from "../src/content/companions"
import { createWorld } from "../src/core/world"
import { selectPartyTarget } from "../src/systems/party"

describe("party companions", () => {
  it("세 역할은 서로 다른 전투 책임을 가진다", () => {
    expect(COMPANION_DEFS.tank.attackRange).toBeLessThan(COMPANION_DEFS.striker.attackRange)
    expect(COMPANION_DEFS.striker.breakPower).toBeGreaterThan(COMPANION_DEFS.support.breakPower)
    expect(COMPANION_DEFS.support.healPercent).toBeGreaterThan(0)
  })

  it("탱커가 가까우면 적의 파티 대상이 된다", () => {
    const world = createWorld()
    const player = world.add({ transform: { position: { x: 0, y: 0, z: 0 }, yaw: 0 }, player: {} as never, health: { current: 100, max: 100 } })
    spawnCompanion(world, "tank", 1, 0, { x: 1, z: 0 })
    const enemy = world.add({ transform: { position: { x: 2, y: 0, z: 0 }, yaw: 0 }, enemy: { kind: "warrior", state: "idle", home: { x: 2, y: 0, z: 0 }, stateSince: 0 }, health: { current: 10, max: 10 } })
    expect(selectPartyTarget(world, enemy)?.companion?.role).toBe("tank")
    expect(player).toBeDefined()
  })
})
