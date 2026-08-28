import { describe, expect, it } from "vitest"
import {
  claimReward,
  completeEncounter,
  createRunProgress,
  deserializeRunProgress,
  hasClaimedReward,
  isEncounterCompleted,
  rewardKey,
  serializeRunProgress,
} from "../src/core/runState"

describe("run progress", () => {
  it("encounter와 보상은 중복 없이 한 번만 기록한다", () => {
    const progress = createRunProgress()
    expect(completeEncounter(progress, "mine-encounter")).toBe(true)
    expect(completeEncounter(progress, "mine-encounter")).toBe(false)
    expect(isEncounterCompleted(progress, "mine-encounter")).toBe(true)

    const key = rewardKey("mine-encounter", "boss-drop")
    expect(claimReward(progress, key)).toBe(true)
    expect(claimReward(progress, key)).toBe(false)
    expect(hasClaimedReward(progress, key)).toBe(true)
  })

  it("저장 문자열은 정렬된 결정적 상태로 왕복한다", () => {
    const progress = createRunProgress()
    completeEncounter(progress, "zeta")
    completeEncounter(progress, "alpha")
    claimReward(progress, rewardKey("zeta", "boss-drop"))
    claimReward(progress, rewardKey("alpha", "boss-drop"))

    const raw = serializeRunProgress(progress)
    expect(raw).toBe(JSON.stringify({
      version: 1,
      completedEncounters: ["alpha", "zeta"],
      claimedRewards: ["alpha:boss-drop", "zeta:boss-drop"],
    }))
    expect(deserializeRunProgress(raw)).toEqual({
      version: 1,
      completedEncounters: ["alpha", "zeta"],
      claimedRewards: ["alpha:boss-drop", "zeta:boss-drop"],
    })
  })

  it("손상되거나 다른 버전의 저장 데이터는 거부한다", () => {
    expect(deserializeRunProgress("not-json")).toBeNull()
    expect(deserializeRunProgress(JSON.stringify({ version: 2, completedEncounters: [], claimedRewards: [] }))).toBeNull()
    expect(deserializeRunProgress(JSON.stringify({ version: 1, completedEncounters: [1], claimedRewards: [] }))).toBeNull()
    expect(deserializeRunProgress(JSON.stringify({ version: 1, completedEncounters: [], claimedRewards: [""] }))).toBeNull()
  })
})
