/**
 * 한 플레이 세션에서 던전 진행을 보존하는 순수 데이터 계약.
 *
 * 전투 엔티티는 존을 나갈 때 제거되지만, encounter 완료와 보상 수령은
 * 플레이어 진행으로 남아야 한다. 배열을 사용해 JSON 저장과 결정적 비교가
 * 가능하도록 했고, 변경은 전용 함수로만 수행한다.
 */

export const RUN_STATE_VERSION = 1 as const

export interface RunProgress {
  version: typeof RUN_STATE_VERSION
  completedEncounters: string[]
  claimedRewards: string[]
}

export function createRunProgress(): RunProgress {
  return {
    version: RUN_STATE_VERSION,
    completedEncounters: [],
    claimedRewards: [],
  }
}

function addUnique(list: string[], value: string): boolean {
  if (!value || list.includes(value)) return false
  list.push(value)
  return true
}

export function isEncounterCompleted(progress: RunProgress, encounterId: string | undefined): boolean {
  return !!encounterId && progress.completedEncounters.includes(encounterId)
}

export function completeEncounter(progress: RunProgress, encounterId: string | undefined): boolean {
  return !!encounterId && addUnique(progress.completedEncounters, encounterId)
}

/** 보상 종류가 바뀌어도 encounter마다 한 번만 받을 수 있게 하는 안정적인 키. */
export function rewardKey(encounterId: string, rewardId: string): string {
  return `${encounterId}:${rewardId}`
}

export function hasClaimedReward(progress: RunProgress, key: string): boolean {
  return progress.claimedRewards.includes(key)
}

export function claimReward(progress: RunProgress, key: string): boolean {
  return addUnique(progress.claimedRewards, key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) return null
  return [...new Set(value)]
}

/** 저장·비교 시 배열 순서를 정규화해 같은 진행 상태가 같은 문자열이 되게 한다. */
export function serializeRunProgress(progress: RunProgress): string {
  return JSON.stringify({
    version: RUN_STATE_VERSION,
    completedEncounters: [...new Set(progress.completedEncounters)].sort(),
    claimedRewards: [...new Set(progress.claimedRewards)].sort(),
  })
}

/** 외부 입력은 신뢰하지 않는다. 버전·형태가 맞지 않으면 null을 반환한다. */
export function deserializeRunProgress(raw: string): RunProgress | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== RUN_STATE_VERSION) return null
    const completedEncounters = stringList(parsed.completedEncounters)
    const claimedRewards = stringList(parsed.claimedRewards)
    if (!completedEncounters || !claimedRewards) return null
    return { version: RUN_STATE_VERSION, completedEncounters, claimedRewards }
  } catch {
    return null
  }
}
