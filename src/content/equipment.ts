import type { ItemInstance, Slot } from "../core/world"

export type CharacterClass = "warrior" | "ranger" | "mystic"

export interface ItemDefinition {
  id: string
  name: string
  slot: Slot
  minLevel: number
  allowedClasses?: readonly CharacterClass[]
  rarity: ItemInstance["rarity"]
}

export interface EquipmentContext {
  level: number
  characterClass: CharacterClass
}

export function canEquipItem(
  item: Pick<ItemDefinition, "minLevel" | "allowedClasses">,
  context: EquipmentContext,
): boolean {
  if (context.level < item.minLevel) return false
  return !item.allowedClasses || item.allowedClasses.includes(context.characterClass)
}
