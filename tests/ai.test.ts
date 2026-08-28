import { describe, it, expect } from "vitest"
import { aiTransition } from "../src/systems/ai"
import { ENEMY_DEFS } from "../src/content/enemies"

const def = ENEMY_DEFS.warrior
const base = { distToHome: 0, playerAlive: true, def }

describe("aiTransition (warrior)", () => {
  it("idle → chase: 어그로 범위 진입", () =>
    expect(aiTransition("idle", { ...base, distToPlayer: 7 })).toBe("chase"))

  it("idle 유지: 범위 밖", () =>
    expect(aiTransition("idle", { ...base, distToPlayer: 11 })).toBe("idle"))

  it("chase → attack: 공격 사거리 진입", () =>
    expect(aiTransition("chase", { ...base, distToPlayer: 1.5 })).toBe("attack"))

  it("chase → return: 리쉬 초과", () =>
    expect(aiTransition("chase", { ...base, distToPlayer: 21, distToHome: 21 })).toBe("return"))

  it("attack → chase: 사거리 이탈(x1.3 히스테리시스)", () =>
    expect(aiTransition("attack", { ...base, distToPlayer: 2.2 })).toBe("chase"))

  it("return → idle: 귀환 완료", () =>
    expect(aiTransition("return", { ...base, distToPlayer: 30, distToHome: 0.3 })).toBe("idle"))

  it("return 중에는 추적하지 않는다", () =>
    expect(aiTransition("return", { ...base, distToPlayer: 3, distToHome: 8 })).toBe("return"))

  it("플레이어 사망 시 chase → return", () =>
    expect(aiTransition("chase", { ...base, distToPlayer: 2, playerAlive: false })).toBe("return"))

  it("플레이어 사망 시 attack → return", () =>
    expect(aiTransition("attack", { ...base, distToPlayer: 1, playerAlive: false })).toBe("return"))
})

describe("아처는 preferredRange를 가진다", () => {
  it("정의 확인", () => {
    expect(ENEMY_DEFS.archer.preferredRange).toBeGreaterThan(0)
    expect(ENEMY_DEFS.archer.attackRange).toBeGreaterThan(ENEMY_DEFS.warrior.attackRange)
  })
})
