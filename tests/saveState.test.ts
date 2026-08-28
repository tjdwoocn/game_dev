import { describe, expect, it } from "vitest"
import { applyEquip, rollItem } from "../src/content/items"
import { completeEncounter } from "../src/core/runState"
import {
  applySaveSnapshot,
  createSaveSnapshot,
  deserializeSaveSnapshot,
  serializeSaveSnapshot,
} from "../src/core/saveState"
import { createGame } from "../src/scenario/headless"

describe("save snapshot", () => {
  it("플레이어 위치·체력·장비·레벨과 encounter 진행을 왕복한다", () => {
    const source = createGame({ zoneId: "mine", seed: 801, companions: false })
    const pc = source.player.player!
    const weapon = rollItem(() => 0.8, 3)
    const armor = rollItem(() => 0.2, 3)
    pc.inventory.push(weapon, armor)
    applyEquip(pc, weapon)
    pc.level = 3
    pc.xp = 47
    pc.rage = 18
    source.player.health!.current = 61
    source.player.transform!.position.x = 24
    source.player.transform!.position.z = 18
    source.player.transform!.yaw = 1.25
    completeEncounter(source.res.runProgress!, "mine-encounter")

    const snapshot = createSaveSnapshot(source.player, source.res.zoneId, source.res.runProgress)
    expect(snapshot).not.toBeNull()
    const restored = deserializeSaveSnapshot(serializeSaveSnapshot(snapshot!))
    expect(restored).not.toBeNull()

    const target = createGame({ zoneId: "town", seed: 802, companions: false })
    expect(applySaveSnapshot(restored!, target.player)).toBe(true)
    target.res.runProgress = restored!.runProgress
    expect(target.player.transform).toMatchObject({ position: { x: 24, z: 18 }, yaw: 1.25 })
    expect(target.player.health).toEqual({ current: 61, max: 100 })
    expect(target.player.player).toMatchObject({ level: 3, xp: 47, rage: 18 })
    expect(target.player.player!.equipment[weapon.slot]?.id).toBe(weapon.id)
    expect(target.player.player!.inventory).toHaveLength(1)
    expect(target.res.runProgress.completedEncounters).toEqual(["mine-encounter"])
  })

  it("진행 상태가 없으면 빈 진행으로 만들고 손상된 슬롯은 거부한다", () => {
    const game = createGame({ zoneId: "town", seed: 803, companions: false })
    const snapshot = createSaveSnapshot(game.player, game.res.zoneId)
    expect(snapshot?.runProgress.completedEncounters).toEqual([])
    expect(deserializeSaveSnapshot(JSON.stringify({ ...snapshot, player: { ...snapshot!.player, health: { current: 101, max: 100 } } }))).toBeNull()
    expect(deserializeSaveSnapshot("{}")) .toBeNull()
  })
})
