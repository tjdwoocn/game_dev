import { PROPS, type PropDef } from "./dungeonKit"

export interface DestructibleDef {
  maxHp: number
  radius: number
  blocksMovement: boolean
  dropTableId?: string
}

/**
 * 소품의 시각 파일명과 판정 수치를 연결하는 최소 카탈로그.
 *
 * 킷의 실제 모델을 충돌체로 쓰지 않고, 파일별 단순 원형 프록시를 사용한다. 수치는
 * TILE(2) 기준이며 Claude가 메시를 붙인 뒤 반경만 시각 QA로 조정할 수 있다.
 */
const DEFS: Record<string, DestructibleDef> = {
  barrel_small: { maxHp: 24, radius: 0.55, blocksMovement: true, dropTableId: "prop-supplies" },
  barrel_large: { maxHp: 36, radius: 0.72, blocksMovement: true, dropTableId: "prop-supplies" },
  crates_stacked: { maxHp: 42, radius: 0.78, blocksMovement: true, dropTableId: "prop-supplies" },
  rubble_large: { maxHp: 48, radius: 0.9, blocksMovement: true },
  rubble_half: { maxHp: 20, radius: 0.62, blocksMovement: false },
  table_medium_broken: { maxHp: 30, radius: 0.8, blocksMovement: true },
  shelf_small_candles: { maxHp: 28, radius: 0.68, blocksMovement: true, dropTableId: "prop-supplies" },
  candle_lit: { maxHp: 8, radius: 0.3, blocksMovement: false },
  chest: { maxHp: 55, radius: 0.7, blocksMovement: true, dropTableId: "prop-cache" },
  chest_gold: { maxHp: 80, radius: 0.82, blocksMovement: true, dropTableId: "prop-cache" },
}

const FALLBACK: DestructibleDef = { maxHp: 24, radius: 0.55, blocksMovement: false }

export function getDestructibleDef(kind: string, props: readonly PropDef[] = PROPS): DestructibleDef {
  const explicit = DEFS[kind]
  if (explicit) return explicit
  const prop = props.find((candidate) => candidate.file === kind)
  if (!prop) return FALLBACK
  return { ...FALLBACK, blocksMovement: prop.blocking }
}

export function destructibleKinds(): string[] {
  return Object.keys(DEFS)
}
