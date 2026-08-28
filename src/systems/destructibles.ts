import { planProps } from "./dungeonProps"
import { getDestructibleDef } from "../content/destructibles"
import { TILE, type DungeonMap } from "../content/map"
import type { Entity, GameWorld, Resources } from "../core/world"
import { rollItem } from "../content/items"
import { allocateItemId } from "../core/itemIds"
import { spawnLoot } from "./loot"

/** 소품 드랍은 콘텐츠가 정해질 때까지 최소한의 seeded 기본 테이블만 제공한다. */
const PROP_DROP_CHANCE: Record<string, number> = {
  "prop-supplies": 0.28,
  "prop-cache": 0.65,
}

function walkable(map: DungeonMap, col: number, row: number): boolean {
  if (row < 0 || row >= map.rows || col < 0 || col >= map.cols) return false
  return !(map.walls[row]?.[col] ?? true)
}

function wallSides(map: DungeonMap, col: number, row: number): number {
  return [
    walkable(map, col + 1, row), walkable(map, col - 1, row),
    walkable(map, col, row + 1), walkable(map, col, row - 1),
  ].filter((open) => !open).length
}

export function spawnDestructibles(world: GameWorld, map: DungeonMap, mapId: string): Entity[] {
  const spawned: Entity[] = []
  for (const placement of planProps(map, mapId)) {
    const def = getDestructibleDef(placement.file)
    const col = Math.round(placement.x / TILE)
    const row = Math.round(placement.z / TILE)
    // 기존 배치기는 장식 후보를 벽가 한 칸까지 넓게 놓는다. 통로를 막지 않도록
    // 실제 충돌은 막다른 구석(벽 3면 이상)에서만 켠다. 필요하면 추후 콘텐츠 좌표가
    // 명시적인 collider opt-in을 갖도록 확장할 수 있다.
    const blocksMovement = def.blocksMovement && wallSides(map, col, row) >= 3
    const prop = world.add({
      transform: { position: { x: placement.x, y: 0, z: placement.z }, yaw: placement.yaw },
      radius: def.radius,
      destructible: {
        kind: placement.file,
        currentHp: def.maxHp,
        maxHp: def.maxHp,
        radius: def.radius,
        state: "intact",
        blocksMovement,
        dropTableId: def.dropTableId,
      },
    })
    spawned.push(prop)
  }
  return spawned
}

/**
 * 소품 파괴 시 드랍. 실제 아이템 목록을 정하기 전에도 RNG 경로를 고정해 두면,
 * 나중에 카탈로그를 연결할 때 시나리오가 비결정적으로 바뀌지 않는다.
 */
export function rollPropDrops(world: GameWorld, res: Resources, prop: Entity): number[] {
  const tableId = prop.destructible?.dropTableId
  const chance = tableId ? PROP_DROP_CHANCE[tableId] : undefined
  if (!chance || res.rng() >= chance) return []
  const playerLevel = world.with("player").entities[0]?.player?.level ?? 1
  const item = rollItem(res.rng, playerLevel, {
    guaranteed: tableId === "prop-cache" ? "magic" : "common",
    id: allocateItemId(res),
  })
  spawnLoot(world, res, prop, item)
  return [item.id]
}

/** 소품의 월드 위치가 타일 중심에 있는지 검증/보정할 때 쓰는 작은 헬퍼. */
export function propCell(prop: Entity): { col: number; row: number } | null {
  const p = prop.transform?.position
  return p ? { col: Math.round(p.x / TILE), row: Math.round(p.z / TILE) } : null
}
