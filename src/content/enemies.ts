import type { EnemyKind, Entity, GameWorld } from "../core/world"

export interface EnemyDef {
  hp: number
  damage: number
  speed: number
  chaseSpeed?: number
  radius: number
  aggroRange: number
  attackRange: number
  attackCooldown: number
  xp: number
  leashRange: number
  /** 원거리형: 이 거리를 유지하려 한다 */
  preferredRange?: number
  breakGauge?: number
  /** 돌진형 적의 명시적 windup/active/recovery 계약. */
  charge?: {
    minRange: number
    maxRange: number
    windup: number
    active: number
    recovery: number
    speed: number
    halfWidth: number
    damageMultiplier: number
  }
}

/**
 * 정예는 새로운 EnemyKind가 아니라 기존 적에 적용되는 직교 수식어다.
 *
 * 이 값은 콘텐츠 레이아웃의 `isElite` 표식과 스폰 수치를 연결하는 단일 계약이다.
 * 시각 계층은 같은 표식을 읽어 실루엣을 강화하고, 전투 계층은 여기서 만든 런타임
 * 수치를 읽는다. 따라서 정예를 추가할 때 적 종류×정예 종류 조합을 새로 만들 필요가 없다.
 */
export const ELITE_MODIFIERS = {
  hpMultiplier: 1.75,
  damageMultiplier: 1.25,
  attackCooldownMultiplier: 0.9,
  xpMultiplier: 2,
  breakGauge: 60,
} as const

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  warrior: { hp: 40, damage: 7, speed: 4, chaseSpeed: 7.2, radius: 0.4, aggroRange: 10, attackRange: 1.6, attackCooldown: 1.2, xp: 20, leashRange: 20 },
  archer: { hp: 25, damage: 5, speed: 3.5, chaseSpeed: 4.5, radius: 0.4, aggroRange: 12, attackRange: 8, attackCooldown: 2.0, xp: 25, leashRange: 18, preferredRange: 7 },
  // 돌격병 — 체력은 낮지만 가장 빠르다. "거리를 벌려도 소용없다" 는 압박을 만든다.
  // 사거리를 근접형보다 짧게 잡아 붙어야만 때릴 수 있게 한다.
  charger: {
    hp: 28, damage: 9, speed: 5.2, chaseSpeed: 10.5, radius: 0.38,
    aggroRange: 13, attackRange: 1.4, attackCooldown: 3.4, xp: 24, leashRange: 24,
    charge: {
      minRange: 3.2, maxRange: 9, windup: 0.42, active: 0.34, recovery: 0.5,
      speed: 15, halfWidth: 0.62, damageMultiplier: 1.0,
    },
  },
  // **보스는 자기 패턴을 다 보여줄 만큼 살아야 한다.**
  // 260 이었을 때 시나리오 하니스로 재 보니 다섯 패턴 중 **첫 예고 도중에 죽었다** —
  // 패턴을 아무리 만들어도 화면에 나오지 않으면 없는 것이다.
  // 한 판이 다섯 패턴을 최소 한 번씩 거치려면 30초 안팎이 필요하고, 거기에 맞춘 값이다.
  boss: { hp: 1000, damage: 10, speed: 3, radius: 0.9, aggroRange: 10, attackRange: 2.2, attackCooldown: 1.8, xp: 200, leashRange: 999, breakGauge: 140 },
}

export function spawnEnemy(world: GameWorld, kind: EnemyKind, x: number, z: number, isElite = false): Entity {
  const def = ENEMY_DEFS[kind]
  const hp = isElite ? Math.round(def.hp * ELITE_MODIFIERS.hpMultiplier) : def.hp
  const damage = isElite ? def.damage * ELITE_MODIFIERS.damageMultiplier : def.damage
  const attackCooldown = isElite
    ? def.attackCooldown * ELITE_MODIFIERS.attackCooldownMultiplier
    : def.attackCooldown
  const xp = isElite ? Math.round(def.xp * ELITE_MODIFIERS.xpMultiplier) : def.xp
  const entity = world.add({
    transform: { position: { x, y: 0, z }, yaw: Math.PI },
    speed: def.speed,
    radius: def.radius,
    health: { current: hp, max: hp },
    attack: { damage, range: def.attackRange, arc: 2.0, cooldown: attackCooldown, readyAt: 0 },
    enemy: { kind, state: "idle", home: { x, y: 0, z }, stateSince: 0, isElite: isElite || undefined },
    xpReward: xp,
    model: { kind },
  })
  const breakGauge = isElite && kind !== "boss" ? ELITE_MODIFIERS.breakGauge : def.breakGauge
  if (breakGauge) {
    world.addComponent(entity, "breakable", {
      current: breakGauge, max: breakGauge,
      exposedUntil: 0, brokenUntil: 0, vulnerabilityUntil: 0,
    })
  }
  return entity
}
