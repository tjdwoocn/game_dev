import { describe, expect, it } from "vitest"
import { saveGame, loadGame, SAVE_SLOT_KEY, type SaveStore, canSaveAtTown } from "../src/systems/persistence"
import { createGame } from "../src/scenario/headless"

class MemoryStore implements SaveStore {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe("persistence", () => {
  it("마을 안전 지점에서 저장하고 플레이어·진행 상태를 복원한다", () => {
    const game = createGame({ zoneId: "town", seed: 901, companions: false })
    const store = new MemoryStore()
    game.player.player!.level = 4
    game.player.player!.xp = 12
    game.player.player!.rage = 27
    game.player.health!.current = 73
    game.player.transform!.position.x = 20

    expect(canSaveAtTown(game.world, game.res, game.runtime)).toBe(true)
    expect(saveGame(game.world, game.res, game.runtime, store)).toBe(true)
    expect(store.getItem(SAVE_SLOT_KEY)).toContain('"version":1')

    game.player.player!.level = 1
    game.player.player!.xp = 0
    game.player.player!.rage = 0
    game.player.health!.current = 1
    game.player.transform!.position.x = 0
    expect(loadGame(game.world, game.res, game.runtime, store)).toBe(true)
    expect(game.player.player).toMatchObject({ level: 4, xp: 12, rage: 27 })
    expect(game.player.health!.current).toBe(73)
    expect(game.player.transform!.position.x).toBe(20)
  })

  it("전투 중인 던전에서는 저장하지 않고 손상된 슬롯은 불러오지 않는다", () => {
    const game = createGame({ zoneId: "mine", seed: 902, companions: false })
    const store = new MemoryStore()
    expect(canSaveAtTown(game.world, game.res, game.runtime)).toBe(false)
    expect(saveGame(game.world, game.res, game.runtime, store)).toBe(false)

    const town = createGame({ zoneId: "town", seed: 903, companions: false })
    store.setItem(SAVE_SLOT_KEY, "{broken")
    expect(loadGame(town.world, town.res, town.runtime, store)).toBe(false)
    expect(town.res.zoneId).toBe("town")
  })
})
