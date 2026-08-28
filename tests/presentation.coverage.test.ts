import { describe, expect, it } from "vitest"
import type { CombatEventKind } from "../src/systems/combatEvents"
import type { SkillId } from "../src/core/world"
import { CHARGE_IMPACT, RELEASE, RING, SLASH, SPARK, WINDUP } from "../src/systems/combatVfx"
import { SOUNDS } from "../src/systems/audio"
import { SHAKE } from "../src/systems/feedback"

/**
 * 표현 커버리지 — **모든 전투 이벤트에 눈이나 귀에 걸리는 것이 하나는 있어야 한다.**
 *
 * 이 테스트가 있는 이유. S1 에서 `crit` 이벤트가 새로 생겼는데 내 표현 테이블
 * 어디에도 `crit` 키가 없었다. `combatEvents` 의 분기는 치명타일 때 `hit` 을
 * **대체**하므로, 결과적으로 **치명타가 일반 타격보다 조용해졌다** — 피해는 더
 * 들어가는데 불꽃도 소리도 흔들림도 0. 타입도 테스트도 통과했고 아무도 못 잡았다.
 *
 * 시스템 쪽에서 이벤트 종류를 추가하면 여기가 먼저 깨진다.
 * `ALL_KINDS` 는 `Record<CombatEventKind, ...>` 라서 **컴파일 단계에서** 누락을 잡는다.
 * 새 종류를 추가하려면 이 표에 한 줄을 쓰면서 "무엇으로 보여줄 것인가" 를 정하게 된다.
 */

/**
 * 각 이벤트를 무엇으로 보여주는지. 값은 "이건 의도적으로 조용하다" 를 적는 자리다.
 * `null` 이면 표현이 없어도 통과하지만, 이유를 반드시 남긴다.
 */
const ALL_KINDS: Record<CombatEventKind, string | null> = {
  swing: "헛휘두르기 궤적 + 바람소리",
  hit: "불꽃 + 타격음 + 카메라",
  hitHeavy: "큰 불꽃 + 낮은 타격음 + 카메라 + 자국",
  crit: "가장 큰 불꽃 + 흰 고리 + 금속성 링 + 카메라",
  enemyDeath: "파문 + 하강음 + 카메라",
  playerHurt: "붉은 불꽃 + 피격음 + 최대 흔들림 + 피격 방향",
  lootDrop: "고리 + 핑",
  lootPickup: "획득음",
  breakOpen: "노란 고리 + 종소리",
  breakSuccess: "가장 큰 파문 + 두꺼운 타격음 + 최대 카메라",
  levelUp: "금색 파문 + 아르페지오",
  dash: "돌진 궤적 + 바람소리",
  whirlwind: "회전 칼날 3장 + 고리 + 회전음 + 카메라",
  skillWindup: "안으로 모이는 고리 + 얇은 상승음",
  skillRelease: "밖으로 퍼지는 고리 + 발동음 (방어·처형)",
  propBreak: "파편 + 먼지 고리 + 쪼개지는 소리 + 얕은 카메라",
  bossTelegraph: "경고음",
  // 예고의 본체는 `telegraph.ts` 의 방향성 위험 구역이다(이벤트가 아니라 상태로 그린다).
  // 여기 표에는 이벤트로 나가는 소리만 걸린다.
  enemyWindup: "상승하는 예고음 + 방향성 위험 구역(telegraph.ts)",
  enemyRelease: "흙먼지 고리 + 흙먼지 입자 + 바람 가르는 소리 + 얕은 카메라",
  enemyRecovery: "차가운 고리(= 반격 기회) + 낮은 숨소리",
}

/** 스킬별 준비/발동 연출이 필요한 스킬. 회전베기·돌진은 전용 경로가 따로 있다. */
const SKILL_IDS: Record<SkillId, true> = {
  whirlwind: true, dash: true, guard: true, execution: true,
}

function presentedBy(kind: string): string[] {
  const where: string[] = []
  if (kind in SLASH) where.push("slash")
  if (kind in RING) where.push("ring")
  if (kind in SPARK) where.push("spark")
  if (kind in SOUNDS) where.push("sound")
  if (kind in SHAKE) where.push("shake")
  return where
}

describe("전투 이벤트 표현 커버리지", () => {
  it("모든 이벤트 종류에 표현이 하나 이상 있다", () => {
    const silent: string[] = []
    for (const kind of Object.keys(ALL_KINDS) as CombatEventKind[]) {
      // 스킬 시전은 skillId 로 갈라지므로 WINDUP/RELEASE 표를 함께 본다.
      const special = kind === "skillWindup" || kind === "skillRelease"
      const where = presentedBy(kind)
      if (where.length === 0 && !special) silent.push(kind)
    }
    expect(silent, `표현이 없는 이벤트: ${silent.join(", ")}`).toEqual([])
  })

  it("치명타가 일반 타격보다 조용하지 않다", () => {
    // 이게 실제로 났던 결함이다. 치명타는 hit 을 대체하므로 hit 이상이어야 한다.
    expect(SPARK.crit, "치명타 불꽃 없음").toBeDefined()
    expect(SOUNDS.crit, "치명타 소리 없음").toBeDefined()
    expect(SHAKE.crit, "치명타 카메라 반응 없음").toBeDefined()

    expect(SPARK.crit!.size!).toBeGreaterThan(SPARK.hit!.size!)
    expect(SPARK.crit!.spread!).toBeGreaterThan(SPARK.hit!.spread!)
    expect(SHAKE.crit!).toBeGreaterThan(SHAKE.hit!)
    // 흰 고리가 치명타를 난전에서 읽히게 하는 핵심이다.
    expect(RING.crit, "치명타 고리 없음").toBeDefined()
  })

  it("치명타가 집중 타격보다도 세다", () => {
    // 집중(브레이크 중)과 치명타가 둘 다 강조라면 서열이 있어야 한다.
    expect(SPARK.crit!.size!).toBeGreaterThan(SPARK.hitHeavy!.size!)
    expect(SHAKE.crit!).toBeGreaterThan(SHAKE.hitHeavy!)
  })

  it("시전 준비 연출이 모든 스킬에 있다", () => {
    for (const id of Object.keys(SKILL_IDS) as SkillId[]) {
      expect(WINDUP[id], `${id} 준비 연출 없음`).toBeDefined()
    }
  })

  it("전용 연출이 없는 스킬은 범용 발동 연출을 받는다", () => {
    // 회전베기·돌진은 spawnCombatVfx 에 전용 분기가 있어 RELEASE 를 쓰지 않는다.
    expect(RELEASE.guard, "방어 발동 연출 없음").toBeDefined()
    expect(RELEASE.execution, "처형 발동 연출 없음").toBeDefined()
  })

  it("준비 연출의 길이가 실제 windup 시간과 어긋나지 않는다", () => {
    // S2 계약: 회전베기 140ms, 돌진 90ms. 연출이 더 길면 이미 나간 스킬에 예고가 남는다.
    expect(WINDUP.whirlwind!.life).toBeCloseTo(0.14, 2)
    expect(WINDUP.dash!.life).toBeCloseTo(0.09, 2)
  })

  it("돌진 예고가 보스 예고와 같은 소리를 쓰지 않는다", () => {
    // 첫 버전은 잡몹 돌진을 `bossTelegraph` 훅으로 흘려보냈다. 그러면 잡몹 하나가
    // 자세만 잡아도 보스 경고음이 울려 **위협의 등급이 잘못 전달된다.**
    expect(SOUNDS.enemyWindup, "돌진 예고음 없음").toBeDefined()
    expect(SOUNDS.enemyWindup).not.toBe(SOUNDS.bossTelegraph)
  })

  it("돌진의 세 단계가 서로 다른 표현을 받는다", () => {
    // 예고 / 발동 / 회복은 플레이어의 선택이 다른 순간이다(피한다 / 맞는다 / 때린다).
    // 셋이 같은 연출이면 단계가 읽히지 않는다.
    expect(SOUNDS.enemyWindup, "예고음 없음").toBeDefined()
    expect(SOUNDS.enemyRelease, "발동음 없음").toBeDefined()
    expect(SOUNDS.enemyRecovery, "회복음 없음").toBeDefined()
    expect(RING.enemyRelease, "발동 고리 없음").toBeDefined()
    expect(RING.enemyRecovery, "회복 고리 없음").toBeDefined()
    expect(RING.enemyRelease!.color).not.toBe(RING.enemyRecovery!.color)
  })

  it("돌진 충돌이 평타 피격보다 크게 튄다", () => {
    // 같은 playerHurt 라도 예고를 못 읽고 몸으로 받은 쪽이 더 아파 보여야
    // 다음에 예고를 읽게 된다.
    expect(CHARGE_IMPACT.size!).toBeGreaterThan(SPARK.playerHurt!.size!)
    expect(CHARGE_IMPACT.spread!).toBeGreaterThan(SPARK.playerHurt!.spread!)
    expect(SOUNDS.chargeImpact, "돌진 충돌음 없음").toBeDefined()
  })

  it("준비와 발동이 같은 색으로 묶인다", () => {
    // castId 로 이어진 한 동작이 색까지 이어져야 눈이 따라간다.
    expect(RELEASE.guard!.color).toBe(WINDUP.guard!.color)
    expect(RELEASE.execution!.color).toBe(WINDUP.execution!.color)
  })
})
