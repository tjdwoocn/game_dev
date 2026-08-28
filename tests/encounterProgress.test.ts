import { describe, expect, it } from "vitest"
import { completeEncounter, isEncounterCompleted, rewardKey } from "../src/core/runState"
import { createGame } from "../src/scenario/headless"
import { enterZone } from "../src/systems/zone"
import { dealDamage } from "../src/systems/combat"
import { rollDrop } from "../src/systems/loot"
import { livingEnemies } from "../src/scenario/run"

describe("encounter 진행", () => {
  it("보스 처치 후 진행과 보상은 마을 왕복 뒤에도 중복되지 않는다", () => {
    const game = createGame({ zoneId: "mine", seed: 710, companions: false })
    const boss = game.world.with("enemy", "boss", "health", "transform").first
    expect(boss).toBeDefined()

    dealDamage(game.world, game.res, game.player, boss!, 99_999)
    expect(boss!.dead).toBeDefined()
    expect(isEncounterCompleted(game.res.runProgress!, "mine-encounter")).toBe(true)
    expect(game.res.runProgress!.claimedRewards).toContain(rewardKey("mine-encounter", "boss-drop"))

    const dropsAfterKill = game.world.with("lootDrop").entities.length
    expect(dropsAfterKill).toBeGreaterThan(0)

    expect(enterZone(game.world, game.res, game.runtime, "town")).toBe(true)
    expect(enterZone(game.world, game.res, game.runtime, "mine")).toBe(true)
    expect(game.res.flags.bossDefeated).toBe(true)
    expect(livingEnemies(game).filter((entity) => entity.boss)).toHaveLength(0)
    expect(game.world.with("lootDrop").entities).toHaveLength(0)

    // 보호 장치가 있어도 같은 엔티티를 다시 굴리면 보상이 늘어나지 않아야 한다.
    rollDrop(game.world, game.res, boss!)
    expect(game.world.with("lootDrop").entities).toHaveLength(0)
  })

  it("미완료 존은 첫 진입에서 정상적으로 전투 엔티티를 만든다", () => {
    const game = createGame({ zoneId: "mine", seed: 711, companions: false })
    expect(game.res.runProgress).toBeDefined()
    expect(game.res.flags.bossDefeated).toBe(false)
    expect(livingEnemies(game).length).toBeGreaterThan(0)
  })

  it("저장된 완료 상태를 적용한 존은 전투를 다시 활성화하지 않는다", () => {
    const game = createGame({ zoneId: "mine", seed: 712, companions: false })
    completeEncounter(game.res.runProgress!, "mine-encounter")
    expect(enterZone(game.world, game.res, game.runtime, "mine")).toBe(true)
    expect(game.res.flags.bossDefeated).toBe(true)
    expect(livingEnemies(game)).toHaveLength(0)
  })
})
