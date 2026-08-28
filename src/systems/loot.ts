import { DROP_CHANCE, applyEquip, computeDerived, rollItem } from "../content/items"
import { createCatalogItemInstance, getCatalogItem } from "../content/itemCatalog"
import { DROP_TABLE } from "../content/dropTables"
import { canEquipItem, type CharacterClass } from "../content/equipment"
import { rollDropRules } from "../content/drops"
import type { Entity, GameWorld, ItemInstance, Rarity, Resources } from "../core/world"
import { worldToScreen } from "./render"

/**
 * 자동 획득 반경. **근접 사거리(1.8)보다 확실히 넓어야 한다.**
 *
 * 주석은 진작 "사거리보다 넓게" 라고 적혀 있었는데 값이 사거리와 **똑같았다**.
 * 게다가 적은 죽기 전에 넉백으로 밀려나므로 드랍은 사거리 밖에 떨어진다 —
 * 사거리 끝에서 잡으면 전리품이 바닥에 남고, 플레이어는 뒷걸음으로 다시 주우러 가야 했다.
 * 사거리 + 적 반경 + 넉백 표류를 덮는 값으로 둔다.
 */
export const PICKUP_RADIUS = 2.6
const INVENTORY_CAP = 20

/** 장비 변화 후 파생 스탯 재계산. 체력은 비율 유지. */
export function recalcStats(playerEntity: Entity): void {
  const pc = playerEntity.player
  const health = playerEntity.health
  if (!pc || !health) return
  const derived = computeDerived(pc)
  const ratio = health.max > 0 ? health.current / health.max : 1
  pc.attackPower = derived.attackPower
  pc.moveSpeed = derived.moveSpeed
  pc.critChance = derived.critChance
  pc.critDamage = derived.critDamage
  pc.attackSpeedPct = derived.attackSpeedPct
  pc.breakPower = derived.breakPower
  pc.cooldownReductionPct = derived.cooldownReductionPct
  pc.lifeOnKill = derived.lifeOnKill
  health.max = derived.maxHp
  health.current = Math.min(derived.maxHp, Math.round(derived.maxHp * ratio))
}

export function refreshInventory(world: GameWorld, res: Resources): void {
  const playerEntity = world.with("player").entities[0]
  if (!playerEntity?.player) return
  res.hud.renderInventory(playerEntity.player, (item: ItemInstance) => {
    if (item.requiredLevel !== undefined || item.allowedClasses !== undefined) {
      const canEquip = canEquipItem(
        {
          minLevel: item.requiredLevel ?? 1,
          allowedClasses: item.allowedClasses as readonly CharacterClass[] | undefined,
        },
        { level: playerEntity.player!.level, characterClass: "warrior" },
      )
      if (!canEquip) {
        const p = playerEntity.transform?.position
        if (p) {
          const s = worldToScreen(res, p.x, 1.2, p.z)
          res.hud.showDamage(s.x, s.y, `장착 조건 미달 (Lv.${item.requiredLevel ?? 1})`, "player-hit")
        }
        return
      }
    }
    applyEquip(playerEntity.player!, item)
    recalcStats(playerEntity)
    refreshInventory(world, res)
  })
}

/** 적 사망 시 드롭 굴림. combat.kill()에서 호출된다. */
export function rollDrop(world: GameWorld, res: Resources, enemy: Entity): void {
  if (!enemy.enemy || !enemy.transform) return
  const kind = enemy.enemy.kind
  const playerLevel = world.with("player").entities[0]?.player?.level ?? 1

  const rules = rollDropRules(res.rng, DROP_TABLE, {
    playerLevel,
    enemyKind: kind,
    zoneId: res.zoneId,
  })
  for (const rule of rules) {
    const catalogItem = getCatalogItem(rule.itemId)
    if (!catalogItem) continue
    spawnLoot(world, res, enemy, createCatalogItemInstance(catalogItem, res.rng))
  }

  // 기존 절차적 잡템은 유지해 루팅 빈도를 만든다.
  if (res.rng() > DROP_CHANCE[kind]) return
  const guaranteed: Rarity | undefined = kind === "boss" ? "rare" : undefined
  const item = rollItem(res.rng, playerLevel, guaranteed ? { guaranteed } : undefined)
  spawnLoot(world, res, enemy, item)
}

export function spawnLoot(world: GameWorld, res: Resources, source: Entity, item: ItemInstance): Entity | undefined {
  if (!source.transform) return undefined
  const p = source.transform.position
  return world.add({
    transform: {
      position: { x: p.x + (res.rng() - 0.5) * 1.2, y: 0, z: p.z + (res.rng() - 0.5) * 1.2 },
      yaw: 0,
    },
    lootDrop: { item },
    model: { kind: "loot", rarity: item.rarity },
  })
}

export function lootSystem(world: GameWorld, res: Resources, dt: number): void {
  void dt
  const playerEntity = world.with("player", "transform").entities[0]
  if (!playerEntity?.player) return
  const pc = playerEntity.player
  const pp = playerEntity.transform.position

  const labels: { key: object; x: number; y: number; name: string; rarity: Rarity; onClick: () => void }[] = []

  for (const drop of [...world.with("lootDrop", "transform")]) {
    const dp = drop.transform.position

    // 자동 줍기
    if (!playerEntity.dead && Math.hypot(dp.x - pp.x, dp.z - pp.z) < PICKUP_RADIUS && pc.inventory.length < INVENTORY_CAP) {
      pc.inventory.push(drop.lootDrop.item)
      if (drop.model?.object) res.scene.remove(drop.model.object)
      world.remove(drop)
      if (res.hud.isInventoryOpen()) refreshInventory(world, res)
      continue
    }

    const s = worldToScreen(res, dp.x, 0.9, dp.z)
    labels.push({
      key: drop,
      x: s.x,
      y: s.y,
      name: drop.lootDrop.item.name,
      rarity: drop.lootDrop.item.rarity,
      onClick: () => {
        if (playerEntity.moveTarget) {
          playerEntity.moveTarget.x = dp.x
          playerEntity.moveTarget.z = dp.z
        } else {
          world.addComponent(playerEntity, "moveTarget", { x: dp.x, z: dp.z })
        }
      },
    })
  }
  res.hud.syncLootLabels(labels)
}
