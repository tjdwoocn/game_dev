import { World } from "miniplex"
import type * as THREE from "three"
import type { DungeonMap } from "../content/map"
import type { Hud } from "../ui/hud"
import type { HitstopState } from "./hitstop"
import type { GameplayEventBuffer } from "./events"
import type { RunProgress } from "./runState"

export type Vec3 = { x: number; y: number; z: number }
export type Vec2 = { x: number; z: number }
export type SkillId = "whirlwind" | "dash" | "guard" | "execution"
export type SkillCastPhase = "windup" | "release"

export interface ActionState {
  kind: "skill"
  skillId: SkillId
  castId: number
  phase: "windup" | "recovery"
  phaseUntil: number
  targetPoint?: Vec2
  target?: Entity
}

export interface BufferedSkill {
  skillId: SkillId
  point: Vec2
  expiresAt: number
}

export type EnemyKind = "warrior" | "archer" | "charger" | "boss"
export type AIState = "idle" | "chase" | "attack" | "return"
export type EnemyActionId = "charge"
export type EnemyActionPhase = "windup" | "active" | "recovery"
export type ModelKind =
  | "player" | "warrior" | "archer" | "charger" | "boss" | "projectile" | "loot"
  | "companion-tank" | "companion-striker" | "companion-support"
export type Rarity = "common" | "magic" | "rare"
export type Slot = "weapon" | "armor" | "ring"
export type CompanionRole = "tank" | "striker" | "support"

export type AffixStat =
  | "attackPower"
  | "maxHp"
  | "moveSpeedPct"
  | "critChance"
  | "critDamage"
  | "attackSpeedPct"
  | "breakPower"
  | "cooldownReductionPct"
  | "lifeOnKill"

export interface Affix {
  stat: AffixStat
  value: number
}

export interface ItemInstance {
  id: number
  name: string
  slot: Slot
  rarity: Rarity
  base: Affix
  affixes: Affix[]
  requiredLevel?: number
  allowedClasses?: readonly string[]
}

export interface PlayerComp {
  rage: number
  maxRage: number
  level: number
  xp: number
  baseAttack: number
  baseMaxHp: number
  baseSpeed: number
  attackPower: number
  moveSpeed: number
  critChance: number
  critDamage: number
  attackSpeedPct: number
  breakPower: number
  cooldownReductionPct: number
  lifeOnKill: number
  inventory: ItemInstance[]
  equipment: Partial<Record<Slot, ItemInstance>>
  cooldowns: Record<SkillId, number>
}

export interface BreakableComp {
  current: number
  max: number
  exposedUntil: number
  brokenUntil: number
  vulnerabilityUntil: number
}

/**
 * 전투 판정의 대상이 되는 환경 소품.
 *
 * `health`와 분리해 둔다. 소품 파괴는 적 처치/XP/브레이크와 같은 생명체 규칙을
 * 재사용하지 않으며, `state`가 충돌과 시각 표현의 단일 기준이 된다.
 */
export interface DestructibleComp {
  kind: string
  currentHp: number
  maxHp: number
  radius: number
  state: "intact" | "broken"
  blocksMovement: boolean
  dropTableId?: string
}

export interface CompanionComp {
  role: CompanionRole
  name: string
  homeOffset: Vec2
  state: "follow" | "engage"
  attackReadyAt: number
  supportReadyAt: number
}

/**
 * 적 전용 행동 상태. 플레이어 스킬의 `ActionState`와 분리해 둔다.
 *
 * 행동의 시간축은 AI가 결정하고 movement/combat가 각각 이동·접촉을 담당한다.
 * 이렇게 하면 텔레그래프와 실제 판정이 같은 시뮬레이션 시각을 공유하면서도
 * Three.js 표현 코드가 상태를 추측할 필요가 없다.
 */
export interface EnemyActionState {
  actionId: EnemyActionId
  instanceId: number
  phase: EnemyActionPhase
  phaseStartedAt: number
  phaseUntil: number
  origin: Vec2
  dir: Vec2
  target?: Entity
  hasHit: boolean
}

export type BossPhase =
  | "idle"
  | "slamTelegraph" | "slamming"
  | "chargeTelegraph" | "charging"
  | "sweepTelegraph" | "sweeping"
  | "summonTelegraph" | "summoning"
  | "quakeTelegraph" | "quaking"

export interface BossComp {
  phase: BossPhase
  phaseUntil: number
  /** 현재 실행 중인 패턴. 표현·계측 계층이 페이즈 문자열을 역추론하지 않게 한다. */
  activePatternId?: string
  slamCount: number
  nextPatternAt: number
  chargeDir: Vec2
  engaged: boolean
  /** 직전에 쓴 패턴 id. 같은 패턴이 연달아 나오지 않게 하는 데 쓴다. */
  lastPatternId?: string
  /** 이 보스가 소환한 하수인. 소환 패턴의 조건과 정리에 쓴다. */
  minions?: Entity[]
}

export interface Entity {
  transform?: { position: Vec3; yaw: number }
  speed?: number
  radius?: number
  moveTarget?: Vec2
  /** moveTarget까지의 길찾기 경로. movement 시스템이 관리한다. */
  path?: { nodes: Vec2[]; index: number; goal: Vec2; stuck: number }
  health?: { current: number; max: number }
  /** 사망 시각과 선택적 부활 예약. 게임 인스턴스 전역 타이머를 두지 않는다. */
  dead?: { at: number; respawnAt?: number }
  attack?: {
    damage: number
    range: number
    arc: number
    cooldown: number
    readyAt: number
    /** 플레이어 근접 공격의 판정 예정 시각. 시작 프레임과 타격 프레임을 분리한다. */
    windupUntil?: number
    breakPower?: number
  }
  hitFlash?: { until: number }
  knockback?: { dir: Vec2; speed: number; until: number }
  player?: PlayerComp
  companion?: CompanionComp
  breakable?: BreakableComp
  destructible?: DestructibleComp
  stunned?: { until: number }
  /** 일반 피격 경직. 브레이크 무력화(`stunned`)와 별도 상태다. */
  hitstun?: { until: number }
  attackIntent?: { target: Entity }
  skillIntent?: { skill: SkillId; point: Vec2 }
  action?: ActionState
  enemyAction?: EnemyActionState
  skillBuffer?: BufferedSkill
  guarding?: { until: number; damageMultiplier: number }
  enemy?: {
    kind: EnemyKind
    state: AIState
    home: Vec3
    stateSince: number
    /** 종류와 직교하는 티어 정보. 맵 레이아웃 문자에 인코딩하지 않는다. */
    isElite?: boolean
    tags?: readonly string[]
  }
  boss?: BossComp
  projectile?: { damage: number; breakPower: number; dir: Vec2; speed: number; diesAt: number; target?: Entity }
  lootDrop?: { item: ItemInstance }
  xpReward?: number
  model?: { kind: ModelKind; object?: THREE.Object3D; rarity?: Rarity }
}

export interface InputEventQueue {
  clicks: { ndcX: number; ndcY: number; button: 0 | 2 }[]
  dashQueued: boolean
  skillQueued: SkillId | null
  pointer: { ndcX: number; ndcY: number }
  toggleInventory: boolean
  /** M — 전체 지도 열고 닫기 */
  toggleMap: boolean
  /** C — 상태창 */
  toggleStats: boolean
  /** K — 스킬창 */
  toggleSkills: boolean
  zoomDelta: number
  rotateCamera: number
  pitchCamera: number
  returnTownQueued: boolean
  /** 문지기·NPC 상호작용 키가 눌린 순간만 소비하는 일회성 이벤트다. */
  interactQueued?: boolean
  /** 현재 눌려 있는 키 코드 (WASD 직접 이동용). 눌린 순간이 아니라 유지 상태다. */
  held: Set<string>
}

export interface Resources {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  input: InputEventQueue
  /** `now` advances at gameplay speed; `realNow` advances every rendered step. */
  time: { now: number; realNow: number }
  hitstop: HitstopState
  rng: () => number
  map: DungeonMap
  zoneId: string
  hud: Hud
  flags: { bossDefeated: boolean }
  events: GameplayEventBuffer
  /** 존을 오가도 유지되는 encounter 완료·보상 수령 상태. 첫 사용 시 생성된다. */
  runProgress?: RunProgress
  /** 같은 seed의 게임 인스턴스가 같은 아이템 식별자를 갖도록 하는 런타임 카운터. */
  nextItemId?: number
}

export const createWorld = () => new World<Entity>()
export type GameWorld = World<Entity>
