import type { EnemyKind, Rarity } from "../core/world"

export interface DropCondition {
  minPlayerLevel?: number
  maxPlayerLevel?: number
  enemyKinds?: readonly EnemyKind[]
  enemyTags?: readonly string[]
  zoneIds?: readonly string[]
  bossOnly?: boolean
}

export interface DropRule {
  id: string
  itemId: string
  chance: number
  rarity?: Rarity
  condition?: DropCondition
}

export interface DropContext {
  playerLevel: number
  enemyKind: EnemyKind
  enemyTags?: readonly string[]
  zoneId?: string
}

export function matchesDropCondition(context: DropContext, condition?: DropCondition): boolean {
  if (!condition) return true
  if (condition.minPlayerLevel !== undefined && context.playerLevel < condition.minPlayerLevel) return false
  if (condition.maxPlayerLevel !== undefined && context.playerLevel > condition.maxPlayerLevel) return false
  if (condition.enemyKinds && !condition.enemyKinds.includes(context.enemyKind)) return false
  if (condition.zoneIds && (!context.zoneId || !condition.zoneIds.includes(context.zoneId))) return false
  if (condition.bossOnly && context.enemyKind !== "boss") return false
  if (condition.enemyTags) {
    const tags = new Set(context.enemyTags ?? [])
    if (condition.enemyTags.some((tag) => !tags.has(tag))) return false
  }
  return true
}

export function eligibleDropRules(rules: readonly DropRule[], context: DropContext): DropRule[] {
  return rules.filter((rule) => matchesDropCondition(context, rule.condition))
}

/** 조건을 만족하는 룰을 독립적으로 굴린다. 여러 룰이 동시에 드롭될 수 있다. */
export function rollDropRules(
  rng: () => number,
  rules: readonly DropRule[],
  context: DropContext,
): DropRule[] {
  return eligibleDropRules(rules, context).filter((rule) => rng() < Math.max(0, Math.min(1, rule.chance)))
}
