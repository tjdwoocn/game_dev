import type { GameWorld, Resources } from "../core/world"
import {
  applySaveSnapshot,
  createSaveSnapshot,
  deserializeSaveSnapshot,
  serializeSaveSnapshot,
} from "../core/saveState"
import { enterZone, type ZoneRuntime } from "./zone"
import { allocateItemId } from "../core/itemIds"

/** 브라우저 localStorage와 테스트용 메모리 저장소가 공유하는 최소 계약. */
export interface SaveStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const SAVE_SLOT_KEY = "arpg-prototype.save.v1"

/**
 * 현재는 마을만 저장 지점으로 삼는다. 전투 중 적·투사체·소품 엔티티까지 저장하지
 * 않으면서 중간 전투를 저장했다고 오해하게 만들지 않기 위한 의도적인 경계다.
 */
export function canSaveAtTown(world: GameWorld, res: Resources, runtime: ZoneRuntime): boolean {
  const player = world.with("player").first
  return !!player && !player.dead && runtime.currentZoneId === "town" && res.zoneId === "town"
}

export function saveGame(world: GameWorld, res: Resources, runtime: ZoneRuntime, store: SaveStore): boolean {
  if (!canSaveAtTown(world, res, runtime)) return false
  const player = world.with("player").first
  if (!player) return false
  const snapshot = createSaveSnapshot(player, res.zoneId, res.runProgress)
  if (!snapshot) return false
  try {
    store.setItem(SAVE_SLOT_KEY, serializeSaveSnapshot(snapshot))
    return true
  } catch {
    return false
  }
}

/** 저장 슬롯을 검증한 뒤에만 월드를 변경한다. 손상된 슬롯은 현재 플레이를 망치지 않는다. */
export function loadGame(world: GameWorld, res: Resources, runtime: ZoneRuntime, store: SaveStore): boolean {
  let raw: string | null
  try {
    raw = store.getItem(SAVE_SLOT_KEY)
  } catch {
    return false
  }
  if (!raw) return false
  const snapshot = deserializeSaveSnapshot(raw)
  if (!snapshot) return false
  const player = world.with("player").first
  if (!player) return false

  // 현재 저장 정책은 마을 안전 저장만 허용한다. 향후 저장 지점을 확장할 때도
  // 이 검증은 유지해, 적 엔티티를 저장하지 않은 채 전투 중 복원하는 일을 막는다.
  if (snapshot.zoneId !== "town") return false
  res.runProgress = snapshot.runProgress
  if (!enterZone(world, res, runtime, snapshot.zoneId)) return false
  const applied = applySaveSnapshot(snapshot, player)
  if (applied) {
    // 복원한 장비·인벤토리보다 작은 ID가 이후 드랍에 재사용되지 않게 한다.
    let maxId = 0
    for (const item of [...player.player!.inventory, ...Object.values(player.player!.equipment)]) {
      if (item) maxId = Math.max(maxId, item.id)
    }
    res.nextItemId = Math.max(res.nextItemId ?? 1, maxId + 1)
    if (!res.nextItemId) allocateItemId(res)
  }
  return applied
}
