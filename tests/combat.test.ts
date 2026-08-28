import { describe, it, expect } from "vitest"
import {
  inMeleeArc,
  applyDamage,
  effectiveAttackCooldown,
  PLAYER_ATTACK_WINDUP,
  queueMeleeAttack,
  resolveOutgoingDamage,
} from "../src/systems/combat"
import type { Entity } from "../src/core/world"

describe("inMeleeArc", () => {
  // yaw=0 은 +z 방향 (atan2(dx, dz) 규약)
  it("정면 사거리 내 → true", () =>
    expect(inMeleeArc({ x: 0, z: 0 }, 0, { x: 0, z: 1.5 }, 1.8, 1.75, 0.4)).toBe(true))

  it("등 뒤 → false", () =>
    expect(inMeleeArc({ x: 0, z: 0 }, 0, { x: 0, z: -1.5 }, 1.8, 1.75, 0.4)).toBe(false))

  it("사거리 밖 → false (반지름 보정 포함)", () =>
    expect(inMeleeArc({ x: 0, z: 0 }, 0, { x: 0, z: 2.5 }, 1.8, 1.75, 0.4)).toBe(false))

  it("타겟 반지름 덕에 살짝 먼 것도 히트", () =>
    expect(inMeleeArc({ x: 0, z: 0 }, 0, { x: 0, z: 2.1 }, 1.8, 1.75, 0.4)).toBe(true))

  it("부채꼴 경계각 바로 안 → true", () => {
    const a = 1.75 / 2 - 0.05
    expect(inMeleeArc({ x: 0, z: 0 }, 0, { x: Math.sin(a) * 1.2, z: Math.cos(a) * 1.2 }, 1.8, 1.75, 0.4)).toBe(true)
  })

  it("부채꼴 경계각 바로 밖 → false", () => {
    const a = 1.75 / 2 + 0.15
    expect(inMeleeArc({ x: 0, z: 0 }, 0, { x: Math.sin(a) * 1.2, z: Math.cos(a) * 1.2 }, 1.8, 1.75, 0.4)).toBe(false)
  })

  it("yaw가 ±π 경계를 넘는 각도 정규화", () =>
    expect(inMeleeArc({ x: 0, z: 0 }, Math.PI, { x: 0, z: -1.2 }, 1.8, 1.75, 0.4)).toBe(true))
})

describe("applyDamage", () => {
  it("체력 감소, 생존", () => {
    const h = { current: 50, max: 50 }
    expect(applyDamage(h, 20).died).toBe(false)
    expect(h.current).toBe(30)
  })

  it("0 이하로 내려가면 died, 음수 클램프", () => {
    const h = { current: 10, max: 50 }
    expect(applyDamage(h, 25).died).toBe(true)
    expect(h.current).toBe(0)
  })
})

describe("기본 공격 준비동작", () => {
  it("쿨다운은 유지하고 판정 시각만 준비동작 뒤로 미룬다", () => {
    const attack: NonNullable<Entity["attack"]> = { damage: 12, range: 1.8, arc: 1.75, cooldown: 0.5, readyAt: 0 }

    queueMeleeAttack(attack, 10)

    expect(attack.readyAt).toBeCloseTo(10.5)
    expect(attack.windupUntil).toBeCloseTo(10 + PLAYER_ATTACK_WINDUP)
    expect(attack.windupUntil).toBeGreaterThan(10)
  })

  it("공격 속도 접사는 기본 공격 쿨다운만 줄인다", () => {
    const attack: NonNullable<Entity["attack"]> = { damage: 12, range: 1.8, arc: 1.75, cooldown: 0.5, readyAt: 0 }
    queueMeleeAttack(attack, 10, PLAYER_ATTACK_WINDUP, 25)
    expect(attack.readyAt).toBeCloseTo(10.4)
    expect(effectiveAttackCooldown(0.5, 50)).toBeCloseTo(1 / 3)
  })
})

describe("장비 치명타", () => {
  const player: Entity = {
    player: {
      rage: 0, maxRage: 100, level: 1, xp: 0,
      baseAttack: 12, baseMaxHp: 100, baseSpeed: 6,
      attackPower: 12, moveSpeed: 6,
      critChance: 50, critDamage: 200, attackSpeedPct: 0,
      breakPower: 0, cooldownReductionPct: 0, lifeOnKill: 0,
      inventory: [], equipment: {}, cooldowns: { dash: 0, whirlwind: 0, guard: 0, execution: 0 },
    },
  }
  const target: Entity = { health: { current: 100, max: 100 } }

  it("치명타 확률 경계와 피해 배수를 재현한다", () => {
    expect(resolveOutgoingDamage(10, player, target, () => 0.49, false)).toMatchObject({ amount: 20, critical: true })
    expect(resolveOutgoingDamage(10, player, target, () => 0.5, false)).toMatchObject({ amount: 10, critical: false })
  })

  it("치명타와 집중 피해는 체력 피해에 함께 적용된다", () => {
    expect(resolveOutgoingDamage(10, player, target, () => 0, true).amount).toBeCloseTo(30)
  })

  it("플레이어가 아닌 공격자는 치명타를 굴리지 않는다", () => {
    const enemy: Entity = { enemy: { kind: "warrior", state: "attack", home: { x: 0, y: 0, z: 0 }, stateSince: 0 } }
    expect(resolveOutgoingDamage(10, enemy, target, () => 0, false)).toMatchObject({ amount: 10, critical: false })
  })
})
