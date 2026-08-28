import { MINE_BOSS_PATTERNS, selectPattern, type PatternDef } from "../content/patterns"
import type { BossComp, BossPhase } from "../core/world"

/**
 * 보스 패턴 선택·페이즈 전이만 담당하는 순수 시스템 모듈.
 * Three.js, HUD, 카메라와 분리되어 헤드리스 시나리오와 콘텐츠 계약을 같은 코드로 검증한다.
 */

const TELEGRAPH_PHASE: Record<string, BossPhase> = {
  slam: "slamTelegraph",
  charge: "chargeTelegraph",
  sweep: "sweepTelegraph",
  summon: "summonTelegraph",
  quake: "quakeTelegraph",
}

const PATTERN_BY_ID = new Map(MINE_BOSS_PATTERNS.map((pattern) => [pattern.id, pattern]))

export function patternOf(id: string | undefined): PatternDef | undefined {
  return id ? PATTERN_BY_ID.get(id) : undefined
}

/** 페이즈 전이 결정. null이면 현재 페이즈를 유지하고, 부수효과는 호출자가 담당한다. */
export function nextBossPhase(
  boss: BossComp,
  now: number,
  rngPick: number,
  ctx: { healthFraction: number; summonCount: number } = { healthFraction: 1, summonCount: 0 },
): BossPhase | null {
  switch (boss.phase) {
    case "idle": {
      if (!boss.engaged || now < boss.nextPatternAt) return null
      const picked = selectPattern(MINE_BOSS_PATTERNS, {
        healthFraction: ctx.healthFraction,
        summonCount: ctx.summonCount,
        previousPatternId: boss.lastPatternId,
      }, rngPick)
      if (!picked) return null
      boss.lastPatternId = picked.id
      return TELEGRAPH_PHASE[picked.id] ?? "slamTelegraph"
    }
    case "slamTelegraph":
      return now >= boss.phaseUntil ? "slamming" : null
    case "slamming":
      return now < boss.phaseUntil
        ? null
        : boss.slamCount < (patternOf("slam")?.repeatCount ?? 3) ? "slamTelegraph" : "idle"
    case "chargeTelegraph":
      return now >= boss.phaseUntil ? "charging" : null
    case "charging":
      return now >= boss.phaseUntil ? "idle" : null
    case "sweepTelegraph":
      return now >= boss.phaseUntil ? "sweeping" : null
    case "sweeping":
      return now >= boss.phaseUntil ? "idle" : null
    case "summonTelegraph":
      return now >= boss.phaseUntil ? "summoning" : null
    case "summoning":
      return now >= boss.phaseUntil ? "idle" : null
    case "quakeTelegraph":
      return now >= boss.phaseUntil ? "quaking" : null
    case "quaking":
      return now >= boss.phaseUntil ? "idle" : null
  }
}
