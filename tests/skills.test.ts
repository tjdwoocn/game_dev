import { describe, it, expect } from "vitest"
import { canCast, effectiveSkillCooldown, spendCost, SKILLS } from "../src/systems/skills"
import type { PlayerComp } from "../src/core/world"

const mkPlayer = (over: Partial<PlayerComp> = {}): PlayerComp => ({
  rage: 30, maxRage: 100, level: 1, xp: 0,
  baseAttack: 12, baseMaxHp: 100, baseSpeed: 6,
  attackPower: 12, moveSpeed: 6,
  critChance: 0, critDamage: 150, attackSpeedPct: 0, breakPower: 0, cooldownReductionPct: 0, lifeOnKill: 0,
  inventory: [], equipment: {}, cooldowns: { dash: 0, whirlwind: 0, guard: 0, execution: 0 }, ...over,
})

describe("whirlwind 자원", () => {
  it("해금 레벨 미달이면 자원이 충분해도 시전 불가", () => {
    const p = mkPlayer({ level: 0, rage: 100 })
    expect(canCast("whirlwind", p, 0)).toBe(false)
  })

  it("분노 충분 → 시전 가능, 차감", () => {
    const p = mkPlayer({ rage: 30 })
    expect(canCast("whirlwind", p, 0)).toBe(true)
    spendCost("whirlwind", p, 0)
    expect(p.rage).toBe(30 - SKILLS.whirlwind.rageCost)
  })

  it("분노 부족 → 불가", () =>
    expect(canCast("whirlwind", mkPlayer({ rage: 10 }), 0)).toBe(false))
})

describe("dash 쿨다운", () => {
  it("준비됨 → 시전 후 readyAt = now + cooldown", () => {
    const p = mkPlayer()
    expect(canCast("dash", p, 10)).toBe(true)
    spendCost("dash", p, 10)
    expect(p.cooldowns.dash).toBe(10 + SKILLS.dash.cooldown)
    expect(canCast("dash", p, 12)).toBe(false)
    expect(canCast("dash", p, 15.1)).toBe(true)
  })

  it("쿨다운 감소 접사는 상한 안에서 실제 쿨다운을 줄인다", () => {
    const p = mkPlayer({ cooldownReductionPct: 40 })
    expect(effectiveSkillCooldown("dash", p)).toBeCloseTo(SKILLS.dash.cooldown * 0.6)
    spendCost("dash", p, 10)
    expect(p.cooldowns.dash).toBeCloseTo(13)
  })
})
