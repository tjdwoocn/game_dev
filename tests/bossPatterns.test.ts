import { describe, expect, it } from "vitest"
import { MINE_BOSS_PATTERNS, selectPattern } from "../src/content/patterns"

/**
 * 보스 패턴 선택 규칙.
 *
 * 이 보스의 목표는 **여러 방법으로 잡히는 것**이다. 그러려면 패턴마다 요구하는 대응이
 * 달라야 하고, 상황에 따라 다른 패턴이 나와야 한다. 그 규칙을 여기서 고정한다.
 */
describe("갱도 보스 패턴", () => {
  const full = { healthFraction: 1, summonCount: 0 }
  const low = { healthFraction: 0.3, summonCount: 0 }

  it("다섯 종류가 정의돼 있고 id 가 겹치지 않는다", () => {
    expect(MINE_BOSS_PATTERNS).toHaveLength(5)
    expect(new Set(MINE_BOSS_PATTERNS.map((p) => p.id)).size).toBe(5)
  })

  it("체력이 많을 때는 균열(quake)이 나오지 않는다", () => {
    for (let i = 0; i < 40; i++) {
      const p = selectPattern(MINE_BOSS_PATTERNS, full, i / 40)
      expect(p?.id).not.toBe("quake")
    }
  })

  it("저체력에서는 균열이 최우선이다 — 마지막 국면의 성격이 바뀐다", () => {
    for (let i = 0; i < 20; i++) {
      const p = selectPattern(MINE_BOSS_PATTERNS, low, i / 20)
      expect(p?.id).toBe("quake")
    }
  })

  it("같은 패턴이 연달아 나오지 않는다", () => {
    for (const prev of MINE_BOSS_PATTERNS) {
      for (let i = 0; i < 20; i++) {
        const p = selectPattern(MINE_BOSS_PATTERNS, { ...full, previousPatternId: prev.id }, i / 20)
        expect(p?.id, `${prev.id} 다음에 ${p?.id}`).not.toBe(prev.id)
      }
    }
  })

  it("하수인이 둘 이상이면 더 소환하지 않는다", () => {
    for (let i = 0; i < 30; i++) {
      const p = selectPattern(MINE_BOSS_PATTERNS, { healthFraction: 1, summonCount: 2 }, i / 30)
      expect(p?.id).not.toBe("summon")
    }
  })

  it("체력이 많을 때 네 종류가 모두 나온다 — 한 패턴만 반복되지 않는다", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) {
      const p = selectPattern(MINE_BOSS_PATTERNS, full, i / 60)
      if (p) seen.add(p.id)
    }
    expect(seen).toEqual(new Set(["slam", "charge", "sweep", "summon"]))
  })

  it("내려찍기와 균열은 정반대를 요구한다 — 안전지대가 뒤집힌다", () => {
    // 규칙 자체를 문서화하는 테스트다. slam 은 반경 안이 위험, quake 는 반경 안이 안전.
    const slam = MINE_BOSS_PATTERNS.find((p) => p.id === "slam")!
    const quake = MINE_BOSS_PATTERNS.find((p) => p.id === "quake")!
    expect(slam.radius).toBeGreaterThan(0)
    expect(quake.radius).toBeGreaterThan(0)
    expect(quake.telegraph).toBeGreaterThan(slam.telegraph) // 뒤집힌 규칙이라 읽을 시간을 더 준다
  })
})
