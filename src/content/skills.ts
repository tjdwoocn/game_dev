export interface SkillUnlock {
  requiredLevel: number
  description: string
}

export const SKILL_UNLOCKS = {
  whirlwind: { requiredLevel: 1, description: "주변의 적을 휩쓸어 공격한다." },
  dash: { requiredLevel: 1, description: "지정한 방향으로 돌진한다." },
} as const satisfies Record<string, SkillUnlock>

/** 입력·연출·전투 판정이 붙기 전까지는 카탈로그에만 존재하던 예정 스킬. */
export const PLANNED_SKILL_UNLOCKS = {
  guard: { requiredLevel: 2, description: "잠시 받는 피해를 줄인다." },
  execution: { requiredLevel: 3, description: "부상한 적에게 강한 일격을 가한다." },
} as const satisfies Record<string, SkillUnlock>

export const ALL_SKILL_UNLOCKS = {
  ...SKILL_UNLOCKS,
  ...PLANNED_SKILL_UNLOCKS,
} as const

export const SKILLS = {
  // **쿨다운은 필수다.** 처음엔 분노 비용만 있었는데, 분노가 계속 차서 사실상 무한
  // 시전이었고 초당 피해가 기본 공격의 네 배를 넘었다. 시나리오 하니스로 보스전을
  // 재 보니 1000 HP 보스가 8.2초에 녹았고, **다섯 패턴 중 두 개만 화면에 나왔다.**
  // 한 수단이 나머지를 전부 압도하면 "여러 방법으로 잡는다" 가 성립하지 않는다.
  whirlwind: { ...SKILL_UNLOCKS.whirlwind, rageCost: 25, cooldown: 2.6, damage: 20, radius: 3, breakPower: 28 },
  dash: { ...SKILL_UNLOCKS.dash, cooldown: 5, damage: 15, breakPower: 36, distance: 6, speed: 24, knockback: { speed: 12, duration: 0.18 } },
  guard: { ...PLANNED_SKILL_UNLOCKS.guard, rageCost: 20, cooldown: 6, windup: 0.12, duration: 1.25, damageMultiplier: 0.5, recovery: 0.18 },
  execution: { ...PLANNED_SKILL_UNLOCKS.execution, rageCost: 35, cooldown: 6, range: 2, windup: 0.28, recovery: 0.35, healthFraction: 0.35, damageBase: 35, attackMultiplier: 1.2, breakPower: 18 },
} as const

export type SkillId = keyof typeof ALL_SKILL_UNLOCKS

export function isSkillUnlocked(skill: SkillId, level: number): boolean {
  return level >= ALL_SKILL_UNLOCKS[skill].requiredLevel
}

export function isPlannedSkillUnlocked(skill: keyof typeof PLANNED_SKILL_UNLOCKS, level: number): boolean {
  return level >= PLANNED_SKILL_UNLOCKS[skill].requiredLevel
}
