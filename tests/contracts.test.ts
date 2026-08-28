import { describe, expect, it } from "vitest"
import { PARTY_CONFIG, maxCompanionSlots } from "../src/content/party"
import { CORE_BOSS_PATTERNS, selectPattern } from "../src/content/patterns"
import { matchesDropCondition, rollDropRules } from "../src/content/drops"
import { isPlannedSkillUnlocked } from "../src/content/skills"
import { canEquipItem } from "../src/content/equipment"
import { validateZoneMaps, ZONE_DEFS } from "../src/content/zones"

describe("content contracts", () => {
  it("현재 파티는 2명이고 최대 3명까지 확장된다", () => {
    expect(PARTY_CONFIG.activeCompanionRoles).toEqual(["tank"])
    expect(maxCompanionSlots()).toBe(2)
  })

  it("존과 맵 참조가 유효하다", () => {
    expect(validateZoneMaps()).toEqual([])
    expect(ZONE_DEFS.town?.exits.some((exit) => exit.targetZoneId === "throne")).toBe(true)
  })

  it("보스 패턴 계약은 예고와 브레이크 창을 함께 표현한다", () => {
    expect(CORE_BOSS_PATTERNS.slam.opensBreakWindow).toBe(true)
    expect(CORE_BOSS_PATTERNS.charge.telegraph).toBeGreaterThan(0)
    expect(CORE_BOSS_PATTERNS.charge.active).toBe(
      CORE_BOSS_PATTERNS.charge.range! / Number(CORE_BOSS_PATTERNS.charge.parameters?.speed),
    )
  })

  it("보스 패턴은 조건과 우선순위를 결정적으로 적용한다", () => {
    const patterns = [
      { ...CORE_BOSS_PATTERNS.slam, id: "normal", weight: 1 },
      { ...CORE_BOSS_PATTERNS.charge, id: "enrage", priority: 1, requires: { maxHealthFraction: 0.5 } },
    ] as const
    const context = { healthFraction: 0.4, summonCount: 0, previousPatternId: "normal" }
    expect(selectPattern(patterns, context, 0)).toMatchObject({ id: "enrage" })
    expect(selectPattern(patterns, { ...context, healthFraction: 0.8 }, 0)).toMatchObject({ id: "normal" })
    expect(selectPattern(patterns, { ...context, healthFraction: 0.4, previousPatternId: "enrage" }, 0)).toBeDefined()
  })

  it("드랍 조건은 레벨·종류·태그를 모두 검사한다", () => {
    const condition = { minPlayerLevel: 3, enemyKinds: ["boss"] as const, enemyTags: ["undead"] as const }
    expect(matchesDropCondition({ playerLevel: 2, enemyKind: "boss", enemyTags: ["undead"] }, condition)).toBe(false)
    expect(matchesDropCondition({ playerLevel: 3, enemyKind: "boss", enemyTags: ["undead", "elite"] }, condition)).toBe(true)
    const drops = rollDropRules(() => 0.1, [{ id: "boss-relic", itemId: "relic", chance: 1, condition }], {
      playerLevel: 3, enemyKind: "boss", enemyTags: ["undead"], zoneId: "throne",
    })
    expect(drops.map((drop) => drop.itemId)).toEqual(["relic"])
  })

  it("스킬과 장비의 성장 조건을 판정한다", () => {
    expect(isPlannedSkillUnlocked("guard", 1)).toBe(false)
    expect(isPlannedSkillUnlocked("guard", 2)).toBe(true)
    expect(canEquipItem({ minLevel: 3, allowedClasses: ["ranger"] }, { level: 3, characterClass: "warrior" })).toBe(false)
    expect(canEquipItem({ minLevel: 3, allowedClasses: ["ranger"] }, { level: 3, characterClass: "ranger" })).toBe(true)
  })
})
