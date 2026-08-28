import type { Affix, EnemyKind, ItemInstance, PlayerComp, Rarity, Slot } from "../core/world"

export const DROP_CHANCE: Record<EnemyKind, number> = { warrior: 0.5, archer: 0.5, charger: 0.45, boss: 1.0 }

const RARITY_PREFIX: Record<Rarity, string> = { common: "낡은", magic: "정교한", rare: "고대의" }
const SLOT_NOUN: Record<Slot, string> = { weapon: "장검", armor: "판금 갑옷", ring: "반지" }
const AFFIX_COUNT: Record<Rarity, number> = { common: 0, magic: 1, rare: 2 }

export interface DerivedPlayerStats {
  attackPower: number
  maxHp: number
  moveSpeed: number
  critChance: number
  critDamage: number
  attackSpeedPct: number
  breakPower: number
  cooldownReductionPct: number
  lifeOnKill: number
}

export const PLAYER_STAT_LIMITS = {
  critChance: 60,
  critDamage: 300,
  attackSpeedPct: 50,
  cooldownReductionPct: 40,
  lifeOnKill: 30,
} as const

let nextItemId = 1

export function rollRarity(rng: () => number, opts?: { guaranteed?: Rarity }): Rarity {
  if (opts?.guaranteed) return opts.guaranteed
  const r = rng()
  if (r < 0.6) return "common"
  if (r < 0.9) return "magic"
  return "rare"
}

function vary(rng: () => number, base: number): number {
  return Math.max(1, Math.round(base * (0.8 + rng() * 0.4)))
}

function rollAffix(rng: () => number, exclude: Set<Affix["stat"]>): Affix {
  const pool: Affix["stat"][] = ([
    "attackPower", "maxHp", "moveSpeedPct", "critChance", "critDamage",
    "attackSpeedPct", "breakPower", "cooldownReductionPct", "lifeOnKill",
  ] as const).filter((s) => !exclude.has(s))
  const stat = pool[Math.floor(rng() * pool.length)] ?? "attackPower"
  const value = stat === "attackPower" ? 2 + Math.floor(rng() * 5)
    : stat === "maxHp" ? 5 + Math.floor(rng() * 16)
      : stat === "moveSpeedPct" ? 5 + Math.floor(rng() * 6)
        : stat === "critChance" ? 3 + Math.floor(rng() * 5)
          : stat === "critDamage" ? 10 + Math.floor(rng() * 16)
            : stat === "attackSpeedPct" ? 4 + Math.floor(rng() * 7)
              : stat === "breakPower" ? 3 + Math.floor(rng() * 6)
                : stat === "cooldownReductionPct" ? 3 + Math.floor(rng() * 5)
                  : 1 + Math.floor(rng() * 4)
  return { stat, value }
}

/**
 * 등급에 맞는 개수만큼 접사를 굴린다 (일반 0 / 마법 1 / 희귀 2). 같은 스탯은 중복되지 않는다.
 * 카탈로그 아이템도 이 규칙을 공유해야 절차적 잡템과 같은 저울 위에 놓인다.
 */
export function rollAffixes(rng: () => number, rarity: Rarity): Affix[] {
  const affixes: Affix[] = []
  const used = new Set<Affix["stat"]>()
  for (let i = 0; i < AFFIX_COUNT[rarity]; i++) {
    const affix = rollAffix(rng, used)
    used.add(affix.stat)
    affixes.push(affix)
  }
  return affixes
}

export function rollItem(rng: () => number, level: number, opts?: { guaranteed?: Rarity }): ItemInstance {
  const rarity = rollRarity(rng, opts)
  const slots: Slot[] = ["weapon", "armor", "ring"]
  const slot = slots[Math.floor(rng() * slots.length)] ?? "weapon"

  let base: Affix
  if (slot === "weapon") base = { stat: "attackPower", value: vary(rng, 5 + 2 * level) }
  else if (slot === "armor") base = { stat: "maxHp", value: vary(rng, 12 + 4 * level) }
  else {
    base = rng() < 0.5
      ? { stat: "attackPower", value: vary(rng, (5 + 2 * level) / 2) }
      : { stat: "maxHp", value: vary(rng, (12 + 4 * level) / 2) }
  }

  const affixes: Affix[] = []
  const used = new Set<Affix["stat"]>()
  for (let i = 0; i < AFFIX_COUNT[rarity]; i++) {
    const affix = rollAffix(rng, used)
    used.add(affix.stat)
    affixes.push(affix)
  }

  return {
    id: nextItemId++,
    name: `${RARITY_PREFIX[rarity]} ${SLOT_NOUN[slot]}`,
    slot,
    rarity,
    base,
    affixes,
  }
}

export function computeDerived(player: PlayerComp): DerivedPlayerStats {
  let attackPower = player.baseAttack
  let maxHp = player.baseMaxHp
  let speedMult = 1
  let critChance = 0
  let critDamage = 150
  let attackSpeedPct = 0
  let breakPower = 0
  let cooldownReductionPct = 0
  let lifeOnKill = 0
  for (const item of Object.values(player.equipment)) {
    if (!item) continue
    for (const affix of [item.base, ...item.affixes]) {
      if (affix.stat === "attackPower") attackPower += affix.value
      else if (affix.stat === "maxHp") maxHp += affix.value
      else if (affix.stat === "moveSpeedPct") speedMult *= 1 + affix.value / 100
      else if (affix.stat === "critChance") critChance += affix.value
      else if (affix.stat === "critDamage") critDamage += affix.value
      else if (affix.stat === "attackSpeedPct") attackSpeedPct += affix.value
      else if (affix.stat === "breakPower") breakPower += affix.value
      else if (affix.stat === "cooldownReductionPct") cooldownReductionPct += affix.value
      else if (affix.stat === "lifeOnKill") lifeOnKill += affix.value
    }
  }
  return {
    attackPower,
    maxHp,
    moveSpeed: player.baseSpeed * speedMult,
    critChance: Math.min(PLAYER_STAT_LIMITS.critChance, Math.max(0, critChance)),
    critDamage: Math.min(PLAYER_STAT_LIMITS.critDamage, Math.max(100, critDamage)),
    attackSpeedPct: Math.min(PLAYER_STAT_LIMITS.attackSpeedPct, Math.max(0, attackSpeedPct)),
    breakPower: Math.max(0, breakPower),
    cooldownReductionPct: Math.min(PLAYER_STAT_LIMITS.cooldownReductionPct, Math.max(0, cooldownReductionPct)),
    lifeOnKill: Math.min(PLAYER_STAT_LIMITS.lifeOnKill, Math.max(0, lifeOnKill)),
  }
}

/** 인벤토리의 item을 장착. 같은 슬롯 기존 장비는 인벤토리로 돌아가고 반환된다. */
export function applyEquip(player: PlayerComp, item: ItemInstance): ItemInstance | undefined {
  const idx = player.inventory.indexOf(item)
  if (idx >= 0) player.inventory.splice(idx, 1)
  const prev = player.equipment[item.slot]
  player.equipment[item.slot] = item
  if (prev) player.inventory.push(prev)
  return prev
}
