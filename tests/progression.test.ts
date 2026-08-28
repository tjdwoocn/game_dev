import { describe, it, expect } from "vitest"
import { xpForLevel, applyXp, lifeOnKill, LIFE_ON_KILL_PCT } from "../src/systems/progression"
import type { PlayerComp } from "../src/core/world"

describe("xpForLevel", () => {
  it("지수 곡선 (floor(100 * level^1.5))", () => {
    expect(xpForLevel(1)).toBe(100)
    expect(xpForLevel(2)).toBe(282)
    expect(xpForLevel(4)).toBe(800)
  })
})

const mk = (): PlayerComp => ({
  rage: 0, maxRage: 100, level: 1, xp: 0,
  baseAttack: 12, baseMaxHp: 100, baseSpeed: 6,
  attackPower: 12, moveSpeed: 6,
  critChance: 0, critDamage: 150, attackSpeedPct: 0, breakPower: 0, cooldownReductionPct: 0, lifeOnKill: 0,
  inventory: [], equipment: {}, cooldowns: { dash: 0, whirlwind: 0, guard: 0, execution: 0 },
})

describe("applyXp", () => {
  it("미달 시 xp만 누적", () => {
    const p = mk()
    expect(applyXp(p, 50).levelsGained).toBe(0)
    expect(p.xp).toBe(50)
    expect(p.level).toBe(1)
  })

  it("초과분 이월 + 스탯 상승", () => {
    const p = mk()
    expect(applyXp(p, 120).levelsGained).toBe(1)
    expect(p.level).toBe(2)
    expect(p.xp).toBe(20)
    expect(p.baseAttack).toBe(14)
    expect(p.baseMaxHp).toBe(115)
  })

  it("한 번에 여러 레벨", () => {
    const p = mk()
    expect(applyXp(p, 100 + 282 + 10).levelsGained).toBe(2)
    expect(p.level).toBe(3)
    expect(p.xp).toBe(10)
  })
})

describe("lifeOnKill", () => {
  // 비율을 숫자로 박아 두면 밸런스를 만질 때마다 테스트가 깨진다.
  // 지켜야 할 계약은 "최대 체력 비례" 와 "처치 수에 비례" 두 가지다.
  it("처치 1건당 최대 체력 비례로 회복한다", () => {
    expect(lifeOnKill(100, 1)).toBe(Math.round(100 * LIFE_ON_KILL_PCT))
    expect(lifeOnKill(200, 1)).toBe(Math.round(200 * LIFE_ON_KILL_PCT))
  })

  it("동시 처치는 합산", () => {
    expect(lifeOnKill(100, 3)).toBe(Math.round(100 * LIFE_ON_KILL_PCT) * 3)
  })

  it("회복량이 한 판의 총 피해를 넘지 않을 만큼 작다", () => {
    // 실측: 갱도 한 판에서 단독 플레이가 받는 피해가 약 190. 잡몹 18마리를 잡으므로
    // 처치 회복 총량이 그보다 크면 위험이 성립하지 않는다 (0.08 일 때 실제로 그랬다).
    expect(lifeOnKill(115, 18)).toBeLessThan(190)
  })

  it("처치 없으면 0", () => {
    expect(lifeOnKill(100, 0)).toBe(0)
  })

  it("장비의 처치 회복은 기존 비율 회복에 더해진다", () => {
    expect(lifeOnKill(100, 2, 4)).toBe((3 + 4) * 2)
  })
})
