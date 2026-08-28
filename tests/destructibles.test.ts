import { describe, expect, it } from "vitest"
import type { Entity } from "../src/core/world"
import { createGame, mulberry32 } from "../src/scenario/headless"
import { advance, cast } from "../src/scenario/run"
import { dealDamage } from "../src/systems/combat"
import { collectCombatEvents } from "../src/systems/combatEvents"
import { enterZone } from "../src/systems/zone"
import { rollPropDrops } from "../src/systems/destructibles"

function firstProp(game: ReturnType<typeof createGame>): Entity {
  const prop = game.world.with("destructible", "transform").first
  if (!prop) throw new Error("테스트용 소품이 생성되지 않았다")
  return prop
}

function enemySource(x: number, z: number): Entity {
  return {
    transform: { position: { x, y: 0, z }, yaw: 0 },
    enemy: { kind: "warrior", state: "attack", home: { x, y: 0, z }, stateSince: 0 },
  }
}

describe("파괴 가능 소품", () => {
  it("플레이어 기본 피해는 내구도를 줄이고 치명타 없이 명시 타격 이벤트를 낸다", () => {
    const game = createGame({ zoneId: "mine", seed: 301, companions: false })
    const prop = firstProp(game)
    prop.destructible!.currentHp = 40
    game.player.player!.critChance = 100
    game.player.player!.critDamage = 300

    dealDamage(game.world, game.res, game.player, prop, 10)
    const events = collectCombatEvents(game.world, game.res)

    expect(prop.destructible!.currentHp).toBe(30)
    expect(game.player.player!.rage).toBe(0)
    expect(events.find((event) => event.kind === "hit" && event.entity === prop)?.critical).toBe(false)
    expect(events.some((event) => event.kind === "crit" && event.entity === prop)).toBe(false)
  })

  it("적 피해는 무시하고, 내구도 0에서는 한 번만 깨지며 propBreak를 낸다", () => {
    const game = createGame({ zoneId: "mine", seed: 302, companions: false })
    const prop = firstProp(game)
    prop.destructible!.currentHp = 8
    const enemy = enemySource(game.player.transform!.position.x, game.player.transform!.position.z - 1)

    dealDamage(game.world, game.res, enemy, prop, 999)
    expect(prop.destructible!.currentHp).toBe(8)

    dealDamage(game.world, game.res, game.player, prop, 10)
    dealDamage(game.world, game.res, game.player, prop, 10)
    const events = collectCombatEvents(game.world, game.res)
    expect(prop.destructible!.state).toBe("broken")
    expect(prop.destructible!.currentHp).toBe(0)
    expect(events.filter((event) => event.kind === "propBreak" && event.entity === prop)).toHaveLength(1)
  })

  it("회전베기와 돌진은 살아 있는 소품을 공격 경로에 포함한다", () => {
    const whirlwind = createGame({ zoneId: "mine", seed: 303, companions: false })
    const wp = whirlwind.player.transform!.position
    const wprop = firstProp(whirlwind)
    wprop.transform!.position.x = wp.x + 1
    wprop.transform!.position.z = wp.z
    wprop.destructible!.currentHp = 100
    whirlwind.player.player!.rage = 20
    cast(whirlwind, "whirlwind", { x: wp.x, z: wp.z })
    advance(whirlwind, 0.2)
    expect(wprop.destructible!.currentHp).toBeLessThan(100)

    const dash = createGame({ zoneId: "mine", seed: 304, companions: false })
    const dp = dash.player.transform!.position
    const dprop = firstProp(dash)
    dprop.transform!.position.x = dp.x + 2
    dprop.transform!.position.z = dp.z
    dprop.destructible!.currentHp = 100
    dash.player.player!.rage = 20
    cast(dash, "dash", { x: dp.x + 4, z: dp.z })
    advance(dash, 0.15)
    expect(dprop.destructible!.currentHp).toBeLessThan(100)
  })

  it("파괴 후에는 동적 충돌에서 빠지고 존 전환 시 소품 상태가 정리된다", () => {
    const game = createGame({ zoneId: "mine", seed: 305, companions: false })
    const prop = firstProp(game)
    const p = game.player.transform!.position
    prop.transform!.position.x = p.x + 0.8
    prop.transform!.position.z = p.z
    const intactDistance = Math.hypot(prop.transform!.position.x - p.x, prop.transform!.position.z - p.z)

    advance(game, 0.05)
    expect(Math.hypot(prop.transform!.position.x - p.x, prop.transform!.position.z - p.z)).toBeGreaterThanOrEqual(intactDistance)

    dealDamage(game.world, game.res, game.player, prop, 999)
    expect(prop.destructible!.state).toBe("broken")
    expect(enterZone(game.world, game.res, game.runtime, "town")).toBe(true)
    expect(game.world.with("destructible").entities).toHaveLength(0)
  })

  it("소품 드랍은 같은 RNG 시드에서 같은 결과를 낸다", () => {
    const a = createGame({ zoneId: "mine", seed: 306, companions: false })
    const b = createGame({ zoneId: "mine", seed: 306, companions: false })
    const ap = firstProp(a)
    const bp = firstProp(b)
    ap.destructible!.dropTableId = "prop-cache"
    bp.destructible!.dropTableId = "prop-cache"
    a.res.rng = mulberry32(0)
    b.res.rng = mulberry32(0)

    const aIds = rollPropDrops(a.world, a.res, ap)
    const bIds = rollPropDrops(b.world, b.res, bp)
    const aItem = a.world.with("lootDrop").first?.lootDrop?.item
    const bItem = b.world.with("lootDrop").first?.lootDrop?.item

    expect(aIds.length).toBe(1)
    expect(bIds.length).toBe(1)
    expect(aItem && { name: aItem.name, rarity: aItem.rarity, base: aItem.base, affixes: aItem.affixes })
      .toEqual(bItem && { name: bItem.name, rarity: bItem.rarity, base: bItem.base, affixes: bItem.affixes })
  })
})
