import { describe, it, expect } from "vitest"
import { nextBossPhase, BOSS } from "../src/systems/boss"
import { pointInPath } from "../src/systems/combat"
import type { BossComp } from "../src/core/world"

const mkBoss = (over: Partial<BossComp> = {}): BossComp => ({
  phase: "idle", phaseUntil: 0, slamCount: 0,
  nextPatternAt: 10, chargeDir: { x: 0, z: 1 }, engaged: true, ...over,
})

describe("nextBossPhase", () => {
  it("쿨다운 전에는 idle 유지", () =>
    expect(nextBossPhase(mkBoss(), 5, 0.3)).toBeNull())

  it("engaged 전에는 패턴을 시작하지 않는다", () =>
    expect(nextBossPhase(mkBoss({ engaged: false }), 11, 0.3)).toBeNull())

  // 예전 계약은 `rng<0.5 면 slam, 아니면 charge` 였다. 패턴이 둘뿐이던 시절의 규칙이다.
  // 지금은 `content/patterns.ts` 의 우선순위·가중치·조건으로 고른다 —
  // 보스를 여러 방법으로 잡게 하려면 상황에 따라 다른 패턴이 나와야 한다.
  it("쿨다운 후 예고 페이즈로 들어간다", () => {
    const phase = nextBossPhase(mkBoss(), 11, 0.3)
    expect(phase).not.toBeNull()
    expect(phase!.endsWith("Telegraph")).toBe(true)
  })

  it("rng 값에 따라 서로 다른 패턴이 나온다 — 한 패턴만 반복되지 않는다", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) seen.add(String(nextBossPhase(mkBoss(), 11, i / 20)))
    expect(seen.size).toBeGreaterThan(1)
  })

  it("체력이 낮으면 균열 국면으로 넘어간다", () => {
    const phase = nextBossPhase(mkBoss(), 11, 0.5, { healthFraction: 0.3, summonCount: 0 })
    expect(phase).toBe("quakeTelegraph")
  })

  it("직전 패턴은 연달아 나오지 않는다", () => {
    for (let i = 0; i < 20; i++) {
      const phase = nextBossPhase(mkBoss({ lastPatternId: "slam" }), 11, i / 20)
      expect(phase).not.toBe("slamTelegraph")
    }
  })

  it("slam telegraph 만료 → slamming", () =>
    expect(nextBossPhase(mkBoss({ phase: "slamTelegraph", phaseUntil: 11 }), 11.01, 0)).toBe("slamming"))

  it("slam 횟수 남음 → 다시 telegraph", () =>
    expect(nextBossPhase(mkBoss({ phase: "slamming", phaseUntil: 11, slamCount: 1 }), 11.01, 0)).toBe("slamTelegraph"))

  it("slam 3회 소진 → idle", () =>
    expect(nextBossPhase(mkBoss({ phase: "slamming", phaseUntil: 11, slamCount: BOSS.slam.count }), 11.01, 0)).toBe("idle"))

  it("charge telegraph 만료 → charging", () =>
    expect(nextBossPhase(mkBoss({ phase: "chargeTelegraph", phaseUntil: 11 }), 11.01, 0)).toBe("charging"))

  it("charging 만료 → idle", () =>
    expect(nextBossPhase(mkBoss({ phase: "charging", phaseUntil: 11 }), 11.01, 0)).toBe("idle"))

  it("만료 전에는 유지", () =>
    expect(nextBossPhase(mkBoss({ phase: "slamTelegraph", phaseUntil: 11 }), 10.5, 0)).toBeNull())
})

describe("pointInPath (충전 경로 판정)", () => {
  it("경로 중앙 → true", () =>
    expect(pointInPath({ x: 0, z: 0 }, { x: 0, z: 1 }, 1.2, 12, { x: 0.5, z: 5 }, 0.45)).toBe(true))

  it("측면 이탈 → false", () =>
    expect(pointInPath({ x: 0, z: 0 }, { x: 0, z: 1 }, 1.2, 12, { x: 3, z: 5 }, 0.45)).toBe(false))

  it("뒤쪽 → false", () =>
    expect(pointInPath({ x: 0, z: 0 }, { x: 0, z: 1 }, 1.2, 12, { x: 0, z: -2 }, 0.45)).toBe(false))
})
