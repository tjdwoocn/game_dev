import { describe, it, expect } from "vitest"
import { ITEM_CATALOG, ITEM_BY_ID, createCatalogItemInstance, getCatalogItem } from "../src/content/itemCatalog"
import { DROP_TABLE } from "../src/content/dropTables"
import { canEquipItem } from "../src/content/equipment"
import { matchesDropCondition, rollDropRules } from "../src/content/drops"
import { ZONE_DEFS } from "../src/content/zones"
import { rollItem } from "../src/content/items"
import { mulberry32 } from "../src/core/rng"
import type { Affix } from "../src/core/world"

/**
 * 아이템 데이터는 눈으로 검사할 수 없다. 오타 하나로 영원히 안 나오는 아이템이 생기고,
 * 그건 플레이해도 "원래 잘 안 나오나 보다" 로 넘어가 버린다.
 */

describe("아이템 카탈로그", () => {
  it("id 가 중복되지 않는다", () => {
    const ids = ITEM_CATALOG.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("이름이 중복되지 않는다", () => {
    const names = ITEM_CATALOG.map((i) => i.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it("모든 아이템이 기본 스탯을 가진다", () => {
    for (const item of ITEM_CATALOG) {
      expect(item.base.value, `${item.name}`).toBeGreaterThan(0)
    }
  })

  it("현재 유일한 플레이 클래스(전사)가 모든 아이템을 쓸 수 있다", () => {
    // 전사 전용 게임에 궁수 전용 아이템을 넣으면 영원히 못 쓰는 죽은 드랍이 된다.
    for (const item of ITEM_CATALOG) {
      const usable = canEquipItem(item, { level: item.minLevel, characterClass: "warrior" })
      expect(usable, `${item.name} 을 전사가 쓸 수 없다`).toBe(true)
    }
  })

  it("등급이 올라갈수록 같은 부위에서 기본 스탯이 강해진다", () => {
    const order = { common: 0, magic: 1, rare: 2 }
    for (const slot of ["weapon", "armor", "ring"] as const) {
      const bySlot = ITEM_CATALOG.filter((i) => i.slot === slot && i.base.stat !== "moveSpeedPct")
      for (const a of bySlot) {
        for (const b of bySlot) {
          if (a.base.stat !== b.base.stat) continue
          if (order[a.rarity] < order[b.rarity] && a.minLevel >= b.minLevel) {
            expect(a.base.value, `${a.name}(${a.rarity}) 가 ${b.name}(${b.rarity}) 보다 약해야 한다`)
              .toBeLessThan(b.base.value)
          }
        }
      }
    }
  })

  it("모든 부위가 각 깊이대에 존재한다", () => {
    const bands: [string, number, number][] = [["깊이1", 1, 3], ["깊이2", 4, 6], ["깊이3", 7, 10]]
    for (const [label, lo, hi] of bands) {
      for (const slot of ["weapon", "armor", "ring"] as const) {
        const found = ITEM_CATALOG.filter((i) => i.slot === slot && i.minLevel >= lo && i.minLevel <= hi)
        expect(found.length, `${label} 에 ${slot} 아이템이 없다`).toBeGreaterThan(0)
      }
    }
  })

  it("getCatalogItem 은 없는 id 에 undefined 를 준다", () => {
    expect(getCatalogItem("없는아이템")).toBeUndefined()
  })

  it("등급에 맞는 접사가 붙는다 (일반 0 / 마법 1 / 희귀 2)", () => {
    const rng = mulberry32(3)
    const expected = { common: 0, magic: 1, rare: 2 }
    for (const item of ITEM_CATALOG) {
      const inst = createCatalogItemInstance(item, rng)
      expect(inst.affixes.length, `${item.name}`).toBe(expected[item.rarity])
    }
  })

  /**
   * 카탈로그 아이템은 "목표" 다. 길에서 줍는 절차적 잡템보다 약하면 존재 이유가 없다.
   * 실제로 처음 작성했을 때 대부분이 잡템보다 약했다 — 접사가 안 붙었고 기본값이
   * 레벨에 비례해 커지지 않아서였다. 그 실수를 다시 하지 않도록 여기서 막는다.
   *
   * 비교는 **각 아이템의 요구 레벨에서, 같은 등급의 잡템 평균** 과 한다.
   * (1레벨 아이템을 3레벨 잡템과 비교하면 당연히 지므로 그건 올바른 비교가 아니다)
   */
  it("모든 카탈로그 아이템이 같은 레벨·등급의 잡템보다 강하다", () => {
    const rng = mulberry32(7)
    const score = (i: { base: Affix; affixes: Affix[] }) => {
      let s = 0
      for (const a of [i.base, ...i.affixes]) {
        if (a.stat === "attackPower") s += a.value
        else if (a.stat === "maxHp") s += a.value / 4
        else s += a.value * 2
      }
      return s
    }
    const weak: string[] = []
    for (const item of ITEM_CATALOG) {
      let cat = 0
      for (let k = 0; k < 200; k++) cat += score(createCatalogItemInstance(item, rng))
      cat /= 200
      let junk = 0
      for (let k = 0; k < 300; k++) junk += score(rollItem(rng, item.minLevel, { guaranteed: item.rarity }))
      junk /= 300
      if (cat / junk < 1.1) weak.push(`${item.name} (${(cat / junk).toFixed(2)}배)`)
    }
    expect(weak, `잡템보다 약한 아이템: ${weak.join(", ")}`).toEqual([])
  })

  it("카탈로그 정의를 드랍 가능한 인스턴스로 변환하며 장착 조건을 보존한다", () => {
    const source = ITEM_CATALOG.find((item) => item.minLevel > 1)!
    const instance = createCatalogItemInstance(source)
    expect(instance.id).toBeGreaterThan(0)
    expect(instance.requiredLevel).toBe(source.minLevel)
    expect(instance.allowedClasses).toEqual(source.allowedClasses)
    expect(instance.base).toEqual(source.base)
  })
})

describe("드랍 테이블", () => {
  it("룰 id 가 중복되지 않는다", () => {
    const ids = DROP_TABLE.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("모든 룰이 실제 존재하는 아이템을 가리킨다", () => {
    for (const rule of DROP_TABLE) {
      expect(ITEM_BY_ID[rule.itemId], `${rule.id} → ${rule.itemId} 없음`).toBeDefined()
    }
  })

  it("모든 룰이 실제 존재하는 존을 가리킨다", () => {
    for (const rule of DROP_TABLE) {
      for (const zoneId of rule.condition?.zoneIds ?? []) {
        expect(ZONE_DEFS[zoneId], `${rule.id} → 존 ${zoneId} 없음`).toBeDefined()
      }
    }
  })

  it("모든 카탈로그 아이템이 최소 한 곳에서는 나온다", () => {
    const dropped = new Set(DROP_TABLE.map((r) => r.itemId))
    const orphans = ITEM_CATALOG.filter((i) => !dropped.has(i.id)).map((i) => i.name)
    expect(orphans, `어디서도 나오지 않는 아이템: ${orphans.join(", ")}`).toEqual([])
  })

  it("확률이 0과 1 사이다", () => {
    for (const rule of DROP_TABLE) {
      expect(rule.chance, rule.id).toBeGreaterThan(0)
      expect(rule.chance, rule.id).toBeLessThanOrEqual(1)
    }
  })

  it("보스 전용 룰은 일반 적에게 걸리지 않는다", () => {
    const bossRules = DROP_TABLE.filter((r) => r.condition?.bossOnly)
    expect(bossRules.length).toBeGreaterThan(0)
    for (const rule of bossRules) {
      const zoneId = rule.condition!.zoneIds![0]!
      const asTrash = matchesDropCondition(
        { playerLevel: 99, enemyKind: "warrior", zoneId },
        rule.condition,
      )
      expect(asTrash, `${rule.id} 가 일반 적에게도 걸린다`).toBe(false)
    }
  })

  it("아이템의 요구 레벨보다 낮은 레벨에서 드랍되지 않는다", () => {
    for (const rule of DROP_TABLE) {
      const item = ITEM_BY_ID[rule.itemId]!
      const gate = rule.condition?.minPlayerLevel ?? 1
      // 요구 레벨보다 한참 일찍 나오면 주워도 못 낀 채 인벤토리만 채운다
      expect(item.minLevel - gate, `${item.name}: 드랍 ${gate} / 착용 ${item.minLevel}`)
        .toBeLessThanOrEqual(2)
    }
  })

  it("각 전투 존에서 실제로 무언가 나온다", () => {
    const rng = mulberry32(1234)
    const combatZones = Object.values(ZONE_DEFS).filter((z) => z.kind !== "town")
    for (const zone of combatZones) {
      let got = 0
      for (let i = 0; i < 400; i++) {
        got += rollDropRules(rng, DROP_TABLE, {
          playerLevel: 10,
          enemyKind: zone.hasBoss ? "boss" : "warrior",
          zoneId: zone.id,
        }).length
      }
      expect(got, `${zone.name}(${zone.id}) 에서 400회 굴려 아무것도 안 나온다`).toBeGreaterThan(0)
    }
  })
})
