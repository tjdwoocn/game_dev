export interface PatternRequirements {
  /** 현재 체력 비율이 이 값 이상이어야 한다. 0..1 범위의 콘텐츠 값. */
  minHealthFraction?: number
  /** 현재 체력 비율이 이 값 이하이어야 한다. 0..1 범위의 콘텐츠 값. */
  maxHealthFraction?: number
  /** 살아 있는 소환물 수가 이 값 이상이어야 한다. */
  minSummonCount?: number
  /** 살아 있는 소환물 수가 이 값 이하여야 한다. */
  maxSummonCount?: number
  /** 직전 패턴이 이 목록에 포함되면 선택하지 않는다. */
  notAfter?: readonly string[]
}

export interface PatternContext {
  healthFraction: number
  summonCount: number
  previousPatternId?: string
}

export type PatternShape = "circle" | "line" | "cone" | "summon"
export type PatternKind = "area" | "charge" | "summon"

export function deriveActiveDuration(range: number, speed: number): number {
  if (speed <= 0) return 0
  return range / speed
}

/**
 * 보스 패턴의 공통 데이터 계약.
 * 특수한 행동은 kind와 parameters를 확장하되, 예고·판정·브레이크 창은 공통으로 유지한다.
 */
export interface PatternDef {
  id: string
  kind: PatternKind
  shape: PatternShape
  telegraph: number
  active: number
  cooldown: number
  damage: number
  opensBreakWindow: boolean
  /** 높은 우선순위 패턴 그룹을 먼저 고려한다. 기본값은 0. */
  priority?: number
  /** 같은 우선순위 그룹 안에서 선택될 상대적 빈도. 기본값은 1. */
  weight?: number
  requires?: PatternRequirements
  radius?: number
  range?: number
  width?: number
  repeatCount?: number
  repeatInterval?: number
  parameters?: Record<string, number | string | boolean>
}

function inRange(value: number, min?: number, max?: number): boolean {
  if (min !== undefined && value < min) return false
  if (max !== undefined && value > max) return false
  return true
}

export function matchesPatternRequirements(pattern: PatternDef, context: PatternContext): boolean {
  const req = pattern.requires
  if (!req) return true
  if (!inRange(context.healthFraction, req.minHealthFraction, req.maxHealthFraction)) return false
  if (!inRange(context.summonCount, req.minSummonCount, req.maxSummonCount)) return false
  if (req.notAfter?.includes(context.previousPatternId ?? "")) return false
  return true
}

/** 조건을 만족하는 최고 우선순위 그룹에서 weight 기반으로 패턴을 고른다. */
export function selectPattern(
  patterns: readonly PatternDef[],
  context: PatternContext,
  rngPick: number,
): PatternDef | undefined {
  const eligible = patterns.filter((pattern) => matchesPatternRequirements(pattern, context))
  if (eligible.length === 0) return undefined

  const maxPriority = Math.max(...eligible.map((pattern) => pattern.priority ?? 0))
  const candidates = eligible.filter((pattern) => (pattern.priority ?? 0) === maxPriority)
  const weights = candidates.map((pattern) => Math.max(0, pattern.weight ?? 1))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return candidates[0]

  const roll = Math.min(1 - Number.EPSILON, Math.max(0, rngPick)) * total
  let cursor = 0
  for (let i = 0; i < candidates.length; i++) {
    cursor += weights[i] ?? 0
    if (roll < cursor) return candidates[i]
  }
  return candidates[candidates.length - 1]
}

export const CORE_BOSS_PATTERNS = {
  slam: {
    id: "slam",
    kind: "area",
    shape: "circle",
    telegraph: 1.4,
    active: 0,
    cooldown: 4,
    damage: 25,
    opensBreakWindow: true,
    weight: 1,
    radius: 3.5,
    repeatCount: 3,
    repeatInterval: 1.8,
  },
  charge: {
    id: "charge",
    kind: "charge",
    shape: "line",
    telegraph: 1.4,
    active: deriveActiveDuration(12, 18),
    cooldown: 4,
    damage: 30,
    opensBreakWindow: true,
    weight: 1,
    range: 12,
    width: 2.4,
    parameters: { speed: 18 },
  },
} as const satisfies Record<string, PatternDef>

/**
 * 갱도 보스 — 해골 군주의 패턴 묶음.
 *
 * **설계 원칙: 패턴마다 요구하는 대응이 달라야 한다.**
 * 전부 "장판 밖으로 피해라" 면 패턴을 다섯 개 만들어도 하나짜리 보스다.
 * 특히 `slam`(멀어져라)과 `quake`(붙어라)는 정반대를 요구한다 — 저체력에서
 * 평소의 본능을 뒤집게 만드는 게 이 보스의 핵심이다.
 *
 * | 패턴 | 요구하는 대응 | 잘 듣는 수단 |
 * |---|---|---|
 * | slam | 표시된 원 밖으로 이동 | 걷기 |
 * | charge | 직선 옆으로 빠지기 | 돌진 |
 * | sweep | 앞이 위험. 뒤로 돌거나 물러서기 | 돌진(관통), 회전베기(뒤에서) |
 * | summon | 하수인을 빨리 정리 | 회전베기 |
 * | quake | **보스 곁이 안전지대** | 붙어서 계속 때리기 |
 */
export const MINE_BOSS_PATTERNS: readonly PatternDef[] = [
  {
    ...CORE_BOSS_PATTERNS.slam,
    weight: 1.2,
    requires: { notAfter: ["slam"] },
  },
  {
    ...CORE_BOSS_PATTERNS.charge,
    weight: 1,
    requires: { notAfter: ["charge"] },
  },
  {
    // 앞쪽 부채꼴을 훑는다. 원과 달리 **뒤가 안전**하므로 돌아 들어가는 선택지가 생긴다.
    id: "sweep",
    kind: "area",
    shape: "cone",
    telegraph: 1.1,
    active: 0,
    cooldown: 3.5,
    damage: 22,
    opensBreakWindow: true,
    weight: 1.1,
    range: 6.5,
    // 부채꼴 반각(라디안). 정면 120도.
    parameters: { halfAngle: 1.05 },
    requires: { notAfter: ["sweep"] },
  },
  {
    // 하수인 소환. 광역기의 값어치를 만든다 — 하나씩 잡으면 시간이 없다.
    id: "summon",
    kind: "summon",
    shape: "summon",
    telegraph: 1.3,
    active: 0,
    cooldown: 6,
    damage: 0,
    opensBreakWindow: true,
    weight: 0.9,
    repeatCount: 3,
    // 하수인이 이미 둘 이상이면 더 부르지 않는다. 화면이 잡몹으로 덮이면 보스가 안 보인다.
    requires: { maxSummonCount: 1, notAfter: ["summon"] },
  },
  {
    // 저체력 전용. **보스 주위만 안전하고 바깥이 위험하다** — slam 과 정반대다.
    // 우선순위를 높여 마지막 국면의 성격을 바꾼다.
    id: "quake",
    kind: "area",
    shape: "circle",
    telegraph: 1.7,
    active: 0,
    cooldown: 7,
    damage: 34,
    opensBreakWindow: true,
    priority: 1,
    weight: 1,
    // 안전 반경. 이 안쪽은 안 맞는다.
    radius: 3.2,
    requires: { maxHealthFraction: 0.45, notAfter: ["quake"] },
  },
]
