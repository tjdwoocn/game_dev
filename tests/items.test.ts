import { describe, it, expect } from "vitest"
import { rollRarity, rollItem, computeDerived, applyEquip, DROP_CHANCE } from "../src/content/items"
import { mulberry32 } from "../src/core/rng"
import type { ItemInstance, PlayerComp } from "../src/core/world"

describe("rollRarity", () => {
  it("guaranteed 옵션은 항상 그 등급", () =>
    expect(rollRarity(mulberry32(1), { guaranteed: "rare" })).toBe("rare"))

  it("1000회 분포가 대략 60/30/10", () => {
    const rng = mulberry32(42)
    const c = { common: 0, magic: 0, rare: 0 }
    for (let i = 0; i < 1000; i++) c[rollRarity(rng)]++
    expect(c.common).toBeGreaterThan(500)
    expect(c.magic).toBeGreaterThan(200)
    expect(c.rare).toBeGreaterThan(50)
    expect(c.rare).toBeLessThan(200)
  })
})

describe("rollItem", () => {
  it("등급별 접사 개수: common 0 / magic 1 / rare 2", () => {
    const rng = mulberry32(7)
    expect(rollItem(rng, 1, { guaranteed: "common" }).affixes.length).toBe(0)
    expect(rollItem(rng, 1, { guaranteed: "magic" }).affixes.length).toBe(1)
    expect(rollItem(rng, 1, { guaranteed: "rare" }).affixes.length).toBe(2)
  })

  it("아이템 id는 굴림마다 고유", () => {
    const rng = mulberry32(9)
    const a = rollItem(rng, 1)
    const b = rollItem(rng, 1)
    expect(a.id).not.toBe(b.id)
  })

  it("무기 기본 스탯은 attackPower", () => {
    const rng = mulberry32(11)
    for (let i = 0; i < 30; i++) {
      const item = rollItem(rng, 2)
      if (item.slot === "weapon") expect(item.base.stat).toBe("attackPower")
      if (item.slot === "armor") expect(item.base.stat).toBe("maxHp")
    }
  })
})

const mkPlayer = (): PlayerComp => ({
  rage: 0, maxRage: 100, level: 1, xp: 0,
  baseAttack: 12, baseMaxHp: 100, baseSpeed: 6,
  attackPower: 12, moveSpeed: 6,
  critChance: 0, critDamage: 150, attackSpeedPct: 0, breakPower: 0, cooldownReductionPct: 0, lifeOnKill: 0,
  inventory: [], equipment: {}, cooldowns: { dash: 0, whirlwind: 0, guard: 0, execution: 0 },
})

describe("computeDerived / applyEquip", () => {
  it("무기 장착 시 공격력 = base + 무기 base + 접사 합", () => {
    const p = mkPlayer()
    p.equipment.weapon = {
      id: 1, name: "t", slot: "weapon", rarity: "magic",
      base: { stat: "attackPower", value: 7 },
      affixes: [{ stat: "attackPower", value: 3 }],
    }
    expect(computeDerived(p).attackPower).toBe(12 + 7 + 3)
  })

  it("moveSpeedPct는 곱연산", () => {
    const p = mkPlayer()
    p.equipment.ring = {
      id: 2, name: "t", slot: "ring", rarity: "magic",
      base: { stat: "maxHp", value: 5 },
      affixes: [{ stat: "moveSpeedPct", value: 10 }],
    }
    expect(computeDerived(p).moveSpeed).toBeCloseTo(6 * 1.1)
    expect(computeDerived(p).maxHp).toBe(105)
  })

  it("신규 접사 6축은 파생 스탯에 반영된다", () => {
    const p = mkPlayer()
    p.equipment.ring = {
      id: 3, name: "t", slot: "ring", rarity: "rare",
      base: { stat: "critChance", value: 7 },
      affixes: [
        { stat: "critDamage", value: 20 },
        { stat: "attackSpeedPct", value: 8 },
        { stat: "breakPower", value: 6 },
        { stat: "cooldownReductionPct", value: 5 },
        { stat: "lifeOnKill", value: 3 },
      ],
    }
    expect(computeDerived(p)).toMatchObject({
      critChance: 7,
      critDamage: 170,
      attackSpeedPct: 8,
      breakPower: 6,
      cooldownReductionPct: 5,
      lifeOnKill: 3,
    })
  })

  it("전투 파생 스탯의 상한을 적용한다", () => {
    const p = mkPlayer()
    p.equipment.weapon = {
      id: 4, name: "t", slot: "weapon", rarity: "rare",
      base: { stat: "critChance", value: 100 },
      affixes: [
        { stat: "critDamage", value: 500 },
        { stat: "attackSpeedPct", value: 100 },
        { stat: "cooldownReductionPct", value: 100 },
        { stat: "lifeOnKill", value: 100 },
      ],
    }
    expect(computeDerived(p).critChance).toBe(60)
    expect(computeDerived(p).critDamage).toBe(300)
    expect(computeDerived(p).attackSpeedPct).toBe(50)
    expect(computeDerived(p).cooldownReductionPct).toBe(40)
    expect(computeDerived(p).lifeOnKill).toBe(30)
  })

  it("applyEquip은 같은 슬롯을 교체하고 기존 장비를 반환", () => {
    const p = mkPlayer()
    const a: ItemInstance = { id: 1, name: "a", slot: "weapon", rarity: "common", base: { stat: "attackPower", value: 5 }, affixes: [] }
    const b: ItemInstance = { ...a, id: 2, name: "b" }
    p.inventory = [a, b]
    expect(applyEquip(p, a)).toBeUndefined()
    expect(p.equipment.weapon).toBe(a)
    expect(p.inventory).not.toContain(a)
    expect(applyEquip(p, b)).toBe(a)
    expect(p.equipment.weapon).toBe(b)
    expect(p.inventory).toContain(a)
  })
})

describe("DROP_CHANCE", () => {
  it("보스는 확정 드롭", () => expect(DROP_CHANCE.boss).toBe(1))
})
