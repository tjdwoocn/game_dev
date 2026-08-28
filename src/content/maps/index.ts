/**
 * 제작된 맵 레이아웃 모음.
 *
 * 여기 있는 것은 parseMap(string[]) 이 그대로 받는 순수 레이아웃뿐이다.
 * 난이도·연결·스폰 테이블 같은 존 메타데이터는 담지 않는다 — 그 계약은 존/씬
 * 시스템이 소유하며, 확정되면 이 레이아웃을 그대로 가져다 쓰면 된다.
 *
 * 맵별 콘셉트, 난이도 의도, 입구·출구, 몬스터 배치 후보는 docs/content/maps.md 에 있다.
 */
export { MINE_LAYOUT } from "./mine"
export { HALL_LAYOUT } from "./hall"
export { CATACOMB_LAYOUT } from "./catacomb"
export { BRIDGE_LAYOUT } from "./bridge"
export { THRONE_LAYOUT } from "./throne"
export { CISTERN_LAYOUT } from "./cistern"
export { CRUCIBLE_LAYOUT } from "./crucible"
export { TOWN_LAYOUT, TOWN_NPCS } from "./town"
export type { NpcPlacement, NpcRole } from "./town"

import { MINE_LAYOUT } from "./mine"
import { HALL_LAYOUT } from "./hall"
import { CATACOMB_LAYOUT } from "./catacomb"
import { BRIDGE_LAYOUT } from "./bridge"
import { THRONE_LAYOUT } from "./throne"
import { CISTERN_LAYOUT } from "./cistern"
import { CRUCIBLE_LAYOUT } from "./crucible"
import { TOWN_LAYOUT } from "./town"

export const MAP_LAYOUTS: Record<string, string[]> = {
  town: TOWN_LAYOUT,
  mine: MINE_LAYOUT,
  hall: HALL_LAYOUT,
  catacomb: CATACOMB_LAYOUT,
  bridge: BRIDGE_LAYOUT,
  throne: THRONE_LAYOUT,
  cistern: CISTERN_LAYOUT,
  crucible: CRUCIBLE_LAYOUT,
}
