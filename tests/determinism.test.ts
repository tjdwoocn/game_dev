import { describe, expect, it } from "vitest"
import { createGame } from "../src/scenario/headless"
import { dealDamage } from "../src/systems/combat"

function lootShape(game: ReturnType<typeof createGame>) {
  return game.world.with("lootDrop").entities.map((entity) => entity.lootDrop.item).map((item) => ({
    id: item.id,
    name: item.name,
    slot: item.slot,
    rarity: item.rarity,
    base: item.base,
    affixes: item.affixes,
  }))
}

describe("runtime determinism", () => {
  it("같은 seed의 독립 게임은 드랍 내용과 ID를 동일하게 만든다", () => {
    const first = createGame({ zoneId: "mine", seed: 1101, companions: false })
    const second = createGame({ zoneId: "mine", seed: 1101, companions: false })
    const firstEnemy = first.world.with("enemy", "health", "transform").first
    const secondEnemy = second.world.with("enemy", "health", "transform").first
    expect(firstEnemy).toBeDefined()
    expect(secondEnemy).toBeDefined()

    dealDamage(first.world, first.res, first.player, firstEnemy!, 99_999)
    dealDamage(second.world, second.res, second.player, secondEnemy!, 99_999)
    expect(lootShape(first)).toEqual(lootShape(second))
  })
})
