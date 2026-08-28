import type { Affix, Entity, ItemInstance, PlayerComp, Rarity, SkillId, Slot } from "./world"
import { createRunProgress, deserializeRunProgress, serializeRunProgress, type RunProgress } from "./runState"

export const SAVE_STATE_VERSION = 1 as const

export interface SavedPlayerState {
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

export interface SaveSnapshot {
  version: typeof SAVE_STATE_VERSION
  zoneId: string
  player: {
    position: { x: number; z: number }
    yaw: number
    health: { current: number; max: number }
    state: SavedPlayerState
  }
  runProgress: RunProgress
}

const SLOTS: readonly Slot[] = ["weapon", "armor", "ring"]
const RARITIES: readonly Rarity[] = ["common", "magic", "rare"]
const SKILLS: readonly SkillId[] = ["whirlwind", "dash", "guard", "execution"]
const AFFIX_STATS: readonly Affix["stat"][] = [
  "attackPower", "maxHp", "moveSpeedPct", "critChance", "critDamage",
  "attackSpeedPct", "breakPower", "cooldownReductionPct", "lifeOnKill",
]

function cloneAffix(affix: Affix): Affix {
  return { stat: affix.stat, value: affix.value }
}

function cloneItem(item: ItemInstance): ItemInstance {
  return {
    id: item.id,
    name: item.name,
    slot: item.slot,
    rarity: item.rarity,
    base: cloneAffix(item.base),
    affixes: item.affixes.map(cloneAffix),
    requiredLevel: item.requiredLevel,
    allowedClasses: item.allowedClasses ? [...item.allowedClasses] : undefined,
  }
}

function clonePlayer(player: PlayerComp): SavedPlayerState {
  const equipment: Partial<Record<Slot, ItemInstance>> = {}
  for (const slot of SLOTS) {
    const item = player.equipment[slot]
    if (item) equipment[slot] = cloneItem(item)
  }
  return {
    rage: player.rage,
    maxRage: player.maxRage,
    level: player.level,
    xp: player.xp,
    baseAttack: player.baseAttack,
    baseMaxHp: player.baseMaxHp,
    baseSpeed: player.baseSpeed,
    attackPower: player.attackPower,
    moveSpeed: player.moveSpeed,
    critChance: player.critChance,
    critDamage: player.critDamage,
    attackSpeedPct: player.attackSpeedPct,
    breakPower: player.breakPower,
    cooldownReductionPct: player.cooldownReductionPct,
    lifeOnKill: player.lifeOnKill,
    inventory: player.inventory.map(cloneItem),
    equipment,
    cooldowns: {
      whirlwind: player.cooldowns.whirlwind,
      dash: player.cooldowns.dash,
      guard: player.cooldowns.guard,
      execution: player.cooldowns.execution,
    },
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T)
}

function isAffix(value: unknown): value is Affix {
  if (!value || typeof value !== "object") return false
  const affix = value as Record<string, unknown>
  return oneOf(affix.stat, AFFIX_STATS) && finite(affix.value)
}

function isItem(value: unknown): value is ItemInstance {
  if (!value || typeof value !== "object") return false
  const item = value as Record<string, unknown>
  if (!Number.isInteger(item.id) || typeof item.name !== "string") return false
  if (!oneOf(item.slot, SLOTS) || !oneOf(item.rarity, RARITIES)) return false
  if (!isAffix(item.base) || !Array.isArray(item.affixes) || !item.affixes.every(isAffix)) return false
  if (item.requiredLevel !== undefined && (!Number.isInteger(item.requiredLevel) || (item.requiredLevel as number) < 1)) return false
  if (item.allowedClasses !== undefined && (!Array.isArray(item.allowedClasses) || !item.allowedClasses.every((v) => typeof v === "string"))) return false
  return true
}

function isPlayerState(value: unknown): value is SavedPlayerState {
  if (!value || typeof value !== "object") return false
  const state = value as Record<string, unknown>
  const numericKeys = [
    "rage", "maxRage", "level", "xp", "baseAttack", "baseMaxHp", "baseSpeed",
    "attackPower", "moveSpeed", "critChance", "critDamage", "attackSpeedPct",
    "breakPower", "cooldownReductionPct", "lifeOnKill",
  ]
  if (numericKeys.some((key) => !finite(state[key]))) return false
  if (!Number.isInteger(state.level) || (state.level as number) < 1 || (state.xp as number) < 0) return false
  if (!Array.isArray(state.inventory) || !state.inventory.every(isItem)) return false
  if (!state.equipment || typeof state.equipment !== "object") return false
  const equipment = state.equipment as Record<string, unknown>
  if (Object.keys(equipment).some((slot) => !oneOf(slot, SLOTS))) return false
  if (SLOTS.some((slot) => equipment[slot] !== undefined && !isItem(equipment[slot]))) return false
  if (!state.cooldowns || typeof state.cooldowns !== "object") return false
  const cooldowns = state.cooldowns as Record<string, unknown>
  return SKILLS.every((skill) => finite(cooldowns[skill]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** 현재 플레이어와 진행 상태의 안전한 복사본을 만든다. 행동 중인 컴포넌트는 저장하지 않는다. */
export function createSaveSnapshot(
  playerEntity: Entity,
  zoneId: string,
  runProgress?: RunProgress,
): SaveSnapshot | null {
  const player = playerEntity.player
  const health = playerEntity.health
  const position = playerEntity.transform?.position
  if (!player || !health || !position || !zoneId) return null
  return {
    version: SAVE_STATE_VERSION,
    zoneId,
    player: {
      position: { x: position.x, z: position.z },
      yaw: playerEntity.transform?.yaw ?? 0,
      health: { current: health.current, max: health.max },
      state: clonePlayer(player),
    },
    runProgress: deserializeRunProgress(serializeRunProgress(runProgress ?? createRunProgress()))!,
  }
}

/** 저장 스냅샷을 플레이어 엔티티에 복원한다. 반환값은 입력 검증 성공 여부다. */
export function applySaveSnapshot(snapshot: SaveSnapshot, playerEntity: Entity): boolean {
  if (!isValidSaveSnapshot(snapshot)) return false
  if (!playerEntity.player || !playerEntity.health || !playerEntity.transform) return false
  const state = snapshot.player.state
  playerEntity.player = {
    ...state,
    inventory: state.inventory.map(cloneItem),
    equipment: Object.fromEntries(
      SLOTS.filter((slot) => state.equipment[slot]).map((slot) => [slot, cloneItem(state.equipment[slot]!)])
    ) as Partial<Record<Slot, ItemInstance>>,
    cooldowns: { ...state.cooldowns },
  }
  playerEntity.health.current = snapshot.player.health.current
  playerEntity.health.max = snapshot.player.health.max
  playerEntity.transform.position.x = snapshot.player.position.x
  playerEntity.transform.position.z = snapshot.player.position.z
  playerEntity.transform.yaw = snapshot.player.yaw
  return true
}

export function serializeSaveSnapshot(snapshot: SaveSnapshot): string {
  return JSON.stringify(snapshot)
}

/** 저장 슬롯에서 읽은 문자열은 버전과 모든 중첩 필드를 확인한 뒤에만 반환한다. */
export function deserializeSaveSnapshot(raw: string): SaveSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isValidSaveSnapshot(parsed)) return null
    const progress = deserializeRunProgress(JSON.stringify(parsed.runProgress))
    if (!progress) return null
    return {
      version: SAVE_STATE_VERSION,
      zoneId: parsed.zoneId,
      player: {
        position: { ...parsed.player.position },
        yaw: parsed.player.yaw,
        health: { ...parsed.player.health },
        state: {
          ...parsed.player.state,
          inventory: parsed.player.state.inventory.map(cloneItem),
          equipment: Object.fromEntries(
            SLOTS.filter((slot) => parsed.player.state.equipment[slot]).map((slot) => [slot, cloneItem(parsed.player.state.equipment[slot]!)])
          ) as Partial<Record<Slot, ItemInstance>>,
          cooldowns: { ...parsed.player.state.cooldowns },
        },
      },
      runProgress: progress,
    }
  } catch {
    return null
  }
}

function isValidSaveSnapshot(value: unknown): value is SaveSnapshot {
  if (!isRecord(value) || value.version !== SAVE_STATE_VERSION || typeof value.zoneId !== "string" || value.zoneId.length === 0) return false
  const player = value.player
  if (!isRecord(player) || !isRecord(player.position) || !finite(player.position.x) || !finite(player.position.z)) return false
  if (!finite(player.yaw) || !isRecord(player.health) || !finite(player.health.current) || !finite(player.health.max)) return false
  if (player.health.max <= 0 || player.health.current < 0 || player.health.current > player.health.max) return false
  if (!isPlayerState(player.state)) return false
  return deserializeRunProgress(JSON.stringify(value.runProgress)) !== null
}
