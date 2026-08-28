import { MAP_LAYOUTS } from "./maps"
import type { MapCell } from "./map"

export type ZoneKind = "field" | "boss" | "town"

export interface ZoneCell {
  col: number
  row: number
}

export interface ZoneExit {
  targetZoneId: string
  label: string
  /** 나중에 입장 위치 선택이 필요할 때 사용할 진입점 식별자. */
  entryId?: string
  /** 물리적으로 밟아서 전환하는 출구의 격자 좌표. */
  fromCell?: ZoneCell
  /** 목적지에서 플레이어가 나타날 격자 좌표. */
  entryCell?: ZoneCell
  /** 문지기/NPC 선택 UI가 붙기 전까지 자동 전환하지 않는 출구. */
  interactionOnly?: boolean
}

/**
 * 맵 레이아웃과 게임 진행을 연결하는 최소 계약.
 * 전투 시스템은 encounterId만 보고 해당 콘텐츠를 선택할 수 있고,
 * 마을·던전 이동은 exits를 사용한다.
 */
export interface ZoneDefinition {
  id: string
  mapId: string
  kind: ZoneKind
  name: string
  suggestedLevel: number
  hasBoss: boolean
  /**
   * 정예로 만들 스폰 칸. **정예는 종류가 아니라 수식어다** — 같은 몹을 한 단계
   * 크고 세게 만든다. 맵 문자를 새로 만들지 않고 좌표로 지정하는 이유는,
   * 같은 레이아웃을 난이도만 바꿔 재사용할 수 있어야 해서다.
   */
  eliteCells?: readonly MapCell[]
  encounterId?: string
  exits: ZoneExit[]
}

export const ZONE_DEFS: Record<string, ZoneDefinition> = {
  town: {
    id: "town",
    mapId: "town",
    kind: "town",
    name: "등불 마을",
    suggestedLevel: 1,
    hasBoss: false,
    exits: [
      { targetZoneId: "mine", label: "무너진 갱도", entryCell: { col: 16, row: 26 }, interactionOnly: true },
      { targetZoneId: "hall", label: "무너진 회랑", interactionOnly: true },
      { targetZoneId: "catacomb", label: "지하 납골당", interactionOnly: true },
      { targetZoneId: "bridge", label: "갈라진 회랑", interactionOnly: true },
      { targetZoneId: "throne", label: "왕좌의 방", interactionOnly: true },
      { targetZoneId: "cistern", label: "함몰 지하수로", interactionOnly: true },
      { targetZoneId: "crucible", label: "시련의 회랑", interactionOnly: true },
    ],
  },
  mine: {
    id: "mine",
    mapId: "mine",
    kind: "field",
    name: "무너진 갱도",
    suggestedLevel: 1,
    // 세로 슬라이스: 갱도 끝이 곧 보스방이다. 예전엔 보스방 3곳을 마을 메뉴에서
    // 따로 골랐는데, 그러면 "던전을 끝냈다" 는 감각이 생기지 않는다.
    hasBoss: true,
    // 세 번째 교전의 근접형 하나를 정예로 만든다. 정예는 종류가 아니라 수식어다.
    eliteCells: [{ col: 15, row: 12 }],
    encounterId: "mine-encounter",
    exits: [{ targetZoneId: "town", label: "등불 마을로 돌아가기", fromCell: { col: 16, row: 2 }, entryCell: { col: 15, row: 16 } }],
  },
  hall: {
    id: "hall",
    mapId: "hall",
    kind: "field",
    name: "무너진 회랑",
    suggestedLevel: 2,
    hasBoss: false,
    encounterId: "hall-encounter",
    exits: [{ targetZoneId: "town", label: "등불 마을로 돌아가기", fromCell: { col: 13, row: 2 }, entryCell: { col: 15, row: 16 } }],
  },
  throne: {
    id: "throne",
    mapId: "throne",
    kind: "boss",
    name: "왕좌의 방",
    suggestedLevel: 3,
    hasBoss: true,
    encounterId: "throne-boss",
    exits: [{ targetZoneId: "town", label: "등불 마을로 돌아가기", fromCell: { col: 14, row: 18 }, entryCell: { col: 15, row: 16 } }],
  },
  cistern: {
    id: "cistern",
    mapId: "cistern",
    kind: "boss",
    name: "함몰 지하수로",
    suggestedLevel: 4,
    hasBoss: true,
    encounterId: "cistern-boss",
    exits: [{ targetZoneId: "town", label: "등불 마을로 돌아가기", fromCell: { col: 14, row: 21 }, entryCell: { col: 15, row: 16 } }],
  },
  catacomb: {
    id: "catacomb",
    mapId: "catacomb",
    kind: "field",
    name: "지하 납골당",
    suggestedLevel: 2,
    hasBoss: false,
    encounterId: "catacomb-encounter",
    exits: [{ targetZoneId: "town", label: "등불 마을로 돌아가기", fromCell: { col: 20, row: 2 }, entryCell: { col: 15, row: 16 } }],
  },
  bridge: {
    id: "bridge",
    mapId: "bridge",
    kind: "field",
    name: "갈라진 회랑",
    suggestedLevel: 3,
    hasBoss: false,
    encounterId: "bridge-encounter",
    exits: [{ targetZoneId: "town", label: "등불 마을로 돌아가기", fromCell: { col: 14, row: 2 }, entryCell: { col: 15, row: 16 } }],
  },
  crucible: {
    id: "crucible",
    mapId: "crucible",
    kind: "boss",
    name: "시련의 회랑",
    suggestedLevel: 5,
    hasBoss: true,
    encounterId: "crucible-boss",
    exits: [{ targetZoneId: "town", label: "등불 마을로 돌아가기", fromCell: { col: 15, row: 22 }, entryCell: { col: 15, row: 16 } }],
  },
}

export function getZone(id: string): ZoneDefinition | undefined {
  return ZONE_DEFS[id]
}

export function cellToWorld(cell: ZoneCell, tile = 2): { x: number; z: number } {
  return { x: cell.col * tile, z: cell.row * tile }
}

/** 레이아웃 콘텐츠와 존 계약의 참조가 끊어지지 않았는지 확인한다. */
export function validateZoneMaps(
  zones: Record<string, ZoneDefinition> = ZONE_DEFS,
  maps: Readonly<Record<string, string[]>> = MAP_LAYOUTS,
): string[] {
  const mapIds = new Set(Object.keys(maps))
  const errors: string[] = []
  for (const zone of Object.values(zones)) {
    if (!mapIds.has(zone.mapId)) errors.push(`${zone.id}: unknown map ${zone.mapId}`)
    for (const exit of zone.exits) {
      if (!zones[exit.targetZoneId]) errors.push(`${zone.id}: unknown exit ${exit.targetZoneId}`)
    }
  }
  return errors
}

export function reachableZoneIds(from = "town", zones: Record<string, ZoneDefinition> = ZONE_DEFS): Set<string> {
  const seen = new Set<string>([from])
  const queue = [from]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const exit of zones[id]?.exits ?? []) {
      if (seen.has(exit.targetZoneId)) continue
      seen.add(exit.targetZoneId)
      queue.push(exit.targetZoneId)
    }
  }
  return seen
}
