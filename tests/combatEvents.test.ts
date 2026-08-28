import { describe, expect, it } from "vitest"
import { createGame } from "../src/scenario/headless"
import { collectCombatEvents } from "../src/systems/combatEvents"
import { dealDamage } from "../src/systems/combat"

describe("명시적 피해 전투 이벤트", () => {
  it("치명타 피해는 crit 하나로 변환되고 hitFlash와 중복되지 않는다", () => {
    const game = createGame({ zoneId: "mine", seed: 17, companions: false })
    const player = game.player.player!
    player.critChance = 100
    player.critDamage = 200
    const target = game.world.with("enemy", "health", "transform").first!

    // 최초 스냅샷을 잡은 뒤 실제 피해를 한 번 적용한다.
    collectCombatEvents(game.world, game.res)
    dealDamage(game.world, game.res, game.player, target, 10)
    const events = collectCombatEvents(game.world, game.res)
    const hits = events.filter((event) => event.kind === "hit" || event.kind === "hitHeavy" || event.kind === "crit")

    expect(hits).toHaveLength(1)
    expect(hits[0]?.kind).toBe("crit")
    expect(hits[0]?.amount).toBe(20)
    expect(hits[0]?.critical).toBe(true)
  })

  it("일반 피해는 hit으로 한 번만 나온다", () => {
    const game = createGame({ zoneId: "mine", seed: 18, companions: false })
    const target = game.world.with("enemy", "health", "transform").first!

    collectCombatEvents(game.world, game.res)
    dealDamage(game.world, game.res, game.player, target, 10)
    const events = collectCombatEvents(game.world, game.res)
    const hits = events.filter((event) => event.kind === "hit" || event.kind === "hitHeavy" || event.kind === "crit")

    expect(hits).toHaveLength(1)
    expect(hits[0]?.kind).toBe("hit")
    expect(hits[0]?.amount).toBe(10)
  })
})
