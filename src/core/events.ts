import type { Entity, EnemyActionId, EnemyActionPhase, SkillCastPhase, SkillId, Vec2, Vec3 } from "./world"

export type GameplayEventType = "damageResolved" | "skillCast" | "enemyAction" | "propBreak"

export interface DamageResolvedPayload {
  source: Entity
  target: Entity
  sourceRole: "player" | "companion" | "enemy" | "environment"
  amount: number
  critical: boolean
  focused: boolean
  killed: boolean
  position?: Vec3
  direction?: Vec2
}

export interface DamageResolvedEvent {
  sequence: number
  type: "damageResolved"
  simulationTime: number
  payload: DamageResolvedPayload
}

export interface SkillCastPayload {
  castId: number
  skillId: SkillId
  phase: SkillCastPhase
  caster: Entity
  position: Vec3
  yaw: number
  targetPoint?: Vec2
}

export interface SkillCastEvent {
  sequence: number
  type: "skillCast"
  simulationTime: number
  payload: SkillCastPayload
}

export interface EnemyActionPayload {
  actionId: EnemyActionId
  instanceId: number
  phase: EnemyActionPhase
  actor: Entity
  elite: boolean
  position: Vec3
  yaw: number
  direction: Vec2
  target?: Entity
}

export interface EnemyActionEvent {
  sequence: number
  type: "enemyAction"
  simulationTime: number
  payload: EnemyActionPayload
}

export interface PropBreakPayload {
  prop: Entity
  propKind: string
  source: Entity
  position: Vec3
  impulse: Vec2
  droppedItemIds: number[]
}

export interface PropBreakEvent {
  sequence: number
  type: "propBreak"
  simulationTime: number
  payload: PropBreakPayload
}

export type GameplayEvent = DamageResolvedEvent | SkillCastEvent | EnemyActionEvent | PropBreakEvent

export interface GameplayEventBuffer {
  nextSequence: number
  nextCastId: number
  nextActionId: number
  pending: GameplayEvent[]
}

export function createGameplayEventBuffer(): GameplayEventBuffer {
  return { nextSequence: 1, nextCastId: 1, nextActionId: 1, pending: [] }
}

export function emitDamageResolved(
  buffer: GameplayEventBuffer,
  simulationTime: number,
  payload: DamageResolvedPayload,
): void {
  buffer.pending.push({
    sequence: buffer.nextSequence++,
    type: "damageResolved",
    simulationTime,
    payload,
  })
}

export function emitSkillCast(
  buffer: GameplayEventBuffer,
  simulationTime: number,
  payload: SkillCastPayload,
): void {
  buffer.pending.push({
    sequence: buffer.nextSequence++,
    type: "skillCast",
    simulationTime,
    payload,
  })
}

export function emitEnemyAction(
  buffer: GameplayEventBuffer,
  simulationTime: number,
  payload: EnemyActionPayload,
): void {
  buffer.pending.push({
    sequence: buffer.nextSequence++,
    type: "enemyAction",
    simulationTime,
    payload,
  })
}

export function emitPropBreak(
  buffer: GameplayEventBuffer,
  simulationTime: number,
  payload: PropBreakPayload,
): void {
  buffer.pending.push({
    sequence: buffer.nextSequence++,
    type: "propBreak",
    simulationTime,
    payload,
  })
}

export function drainGameplayEvents(buffer: GameplayEventBuffer): GameplayEvent[] {
  if (buffer.pending.length === 0) return []
  const events = buffer.pending
  buffer.pending = []
  return events
}
