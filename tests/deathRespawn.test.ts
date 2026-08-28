import { describe, expect, it } from "vitest"
import { createGame } from "../src/scenario/headless"
import { advance, livingEnemies } from "../src/scenario/run"
import { dealDamage } from "../src/systems/combat"

describe("death and respawn", () => {
  it("부활 예약은 플레이어별 상태로 격리된다", () => {
    const first = createGame({ zoneId: "mine", seed: 1001, companions: false })
    const second = createGame({ zoneId: "mine", seed: 1002, companions: false })
    const source = livingEnemies(first)[0]!

    dealDamage(first.world, first.res, source, first.player, 99_999)
    expect(first.player.dead?.respawnAt).toBeDefined()
    expect(second.player.dead).toBeUndefined()

    advance(second, 3.2)
    expect(second.player.dead).toBeUndefined()
    expect(second.player.health!.current).toBe(second.player.health!.max)

    advance(first, 2.9)
    expect(first.player.dead).toBeDefined()
    advance(first, 0.2)
    expect(first.player.dead).toBeUndefined()
    expect(first.player.health!.current).toBe(first.player.health!.max)
    expect(first.player.transform!.position).toMatchObject(first.res.map.playerSpawn)
    expect(first.player.player!.rage).toBe(0)
  })
})
