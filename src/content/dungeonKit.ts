/**
 * 던전 외형 카탈로그 — 어떤 모델을 어디에 어떻게 놓을지의 데이터.
 *
 * 모델 파일은 public/assets/dungeon/*.glb (KayKit Dungeon Remastered, CC0).
 * 이 파일은 배치 "규칙"만 담고 렌더링은 하지 않는다. 실제 메시 생성은
 * 렌더 시스템이 담당하며, 그 연결점은 docs/content/dungeon-dressing.md 에 적어 뒀다.
 *
 * 중요한 전제: 이 킷의 벽은 칸을 채우는 큐브가 아니라 **칸 경계에 세우는 판넬**이다.
 * 원본 크기는 벽 4×4×1, 바닥 4×4 이고 우리 TILE 은 2 이므로 배율은 0.5 로 딱 떨어진다.
 */

/** 킷 원본의 격자 단위. 우리 TILE(2) 로 맞추려면 이 값으로 나눈다. */
export const KIT_GRID = 4
export const KIT_SCALE = 0.5

export interface KitModel {
  /** public/assets/dungeon/{file}.glb */
  file: string
  /** 배치 후 y 오프셋 (원본 원점이 바닥이 아닌 모델 보정용) */
  yOffset?: number
  /** 이 모델이 무엇인지 — 배치 규칙을 읽을 때의 근거 */
  note: string
}

/**
 * 벽 판넬. 벽 칸의 각 면 중 통행 칸과 맞닿은 면에 하나씩 세운다.
 * 모서리와 교차부는 판넬 두 장이 자연스럽게 만나므로 전용 조각이 없어도 성립한다.
 */
export const WALL_PANELS: KitModel[] = [
  { file: "wall", note: "기본 벽면. 대부분의 면에 쓴다" },
  { file: "wall_cracked", note: "금이 간 벽. 오래된 구역의 변주" },
  { file: "wall_broken", note: "부서진 벽. 무너진 구역의 변주" },
]

/** 변주 비율 — 같은 벽만 늘어서면 인공적으로 보인다. 합이 1이 되게 유지한다. */
export const WALL_VARIANT_WEIGHTS: Record<string, number> = {
  wall: 0.7,
  wall_cracked: 0.2,
  wall_broken: 0.1,
}

export const FLOOR_TILES: KitModel[] = [
  { file: "floor_tile_large", yOffset: 0, note: "기본 석재 바닥. 한 칸에 정확히 맞는다" },
  { file: "floor_dirt_large", yOffset: 0, note: "흙바닥. 갱도처럼 사람이 파낸 구역용" },
]

/** 벽 변주 조각 이름. 로딩 목록을 만들 때 쓴다. */
export const WALL_VARIANTS = Object.keys(WALL_VARIANT_WEIGHTS)

/**
 * 존별 외형 — "맵이 전부 똑같아 보인다" 를 고치는 데이터.
 *
 * 문제의 실체는 바닥 8개 중 7개가 같은 타일(`floor_tile_large`)이고 벽 변주 비율도
 * 전 맵 공용이었다는 것이다. 킷 모델은 두 종류뿐이라 조각을 더 살 수는 없지만,
 * **색조·벽 상태·등불 밀도** 세 축만으로도 공간의 인상은 크게 갈린다.
 *
 * `tint` 는 인스턴스 색상(`setColorAt`)으로 곱한다. 머티리얼을 새로 만들지 않으므로
 * 존을 오갈 때 리소스가 늘지 않는다 — 존 전환 텍스처 누수를 실측한 뒤 택한 방식이다.
 * 값은 흰색(0xffffff)에 가까울수록 원본 그대로다. 너무 어둡게 잡으면 탁해진다.
 *
 * 콘셉트는 `docs/content/world.md` 와 `maps.md` 를 따른다.
 */
export interface ZoneDressing {
  /** 바닥 색조 */
  tint: number
  /** 벽 색조. 바닥과 살짝 어긋나게 둬야 공간이 납작해 보이지 않는다. */
  wallTint: number
  floor: string
  /** 벽 변주 비율. 폐허일수록 금가고 부서진 벽이 많다. 합이 1이 되게 유지한다. */
  wallWeights: Record<string, number>
  /** 등불 간격. 작을수록 밝고, 사람의 손이 닿아 있는 구역이라는 뜻이다. */
  torchEvery: number
  note: string
}

const INTACT = { wall: 0.9, wall_cracked: 0.08, wall_broken: 0.02 }
const WORN = { wall: 0.62, wall_cracked: 0.25, wall_broken: 0.13 }
const RUINED = { wall: 0.5, wall_cracked: 0.3, wall_broken: 0.2 }

export const ZONE_DRESSING: Record<string, ZoneDressing> = {
  town: {
    tint: 0xfff2dd, wallTint: 0xf2ece0, floor: "floor_tile_large",
    wallWeights: INTACT, torchEvery: 5,
    note: "등불 마을 — 유일하게 온전하고 밝은 곳. 등불이 촘촘하다",
  },
  mine: {
    tint: 0xd9a870, wallTint: 0xbfae97, floor: "floor_dirt_large",
    wallWeights: WORN, torchEvery: 8,
    note: "무너진 갱도 — 사람이 파낸 흙바닥, 나무 버팀목의 흙빛",
  },
  hall: {
    tint: 0xb9c2d4, wallTint: 0xa8b2c4, floor: "floor_tile_large",
    wallWeights: RUINED, torchEvery: 9,
    note: "무너진 회랑 — 식은 석재. 가장 많이 무너진 구역",
  },
  catacomb: {
    tint: 0xcfd0b4, wallTint: 0xb9bba2, floor: "floor_tile_large",
    wallWeights: WORN, torchEvery: 11,
    note: "지하 납골당 — 뼈처럼 바랜 색. 어둡고 조용하다",
  },
  bridge: {
    tint: 0xd6e6f2, wallTint: 0xc2d2e0, floor: "floor_tile_large",
    wallWeights: RUINED, torchEvery: 10,
    note: "갈라진 회랑 — 바깥 빛이 드는 트인 구역. 푸르고 차다",
  },
  throne: {
    tint: 0xffd9a8, wallTint: 0xe8bb86, floor: "floor_tile_large",
    wallWeights: INTACT, torchEvery: 5,
    note: "왕좌의 방 — 무너지지 않은 채 남은 곳. 금빛으로 장엄하다",
  },
  cistern: {
    tint: 0x8fbfc0, wallTint: 0x7fa9ad, floor: "floor_tile_large",
    wallWeights: WORN, torchEvery: 13,
    note: "함몰 지하수로 — 물때 낀 청록. 등불이 가장 드물다",
  },
  crucible: {
    tint: 0xf0a978, wallTint: 0xc98d70, floor: "floor_dirt_large",
    wallWeights: WORN, torchEvery: 4,
    note: "시련의 회랑 — 재와 불씨. 불이 많아 붉게 달아 있다",
  },
}

export const DEFAULT_DRESSING: ZoneDressing = {
  tint: 0xffffff, wallTint: 0xf0f0f0, floor: "floor_tile_large",
  wallWeights: WALL_VARIANT_WEIGHTS, torchEvery: 7,
  note: "미등록 맵 폴백",
}

export function getZoneDressing(mapId: string): ZoneDressing {
  return ZONE_DRESSING[mapId] ?? DEFAULT_DRESSING
}

/**
 * 기둥. 맵 레이아웃에서 2×2 벽 덩어리로 표현한 기둥 자리에 놓는다.
 * (무너진 회랑의 기둥 8개, 왕좌의 방 기둥 4쌍, 함몰 지하수로 벽감 기둥)
 * 원본이 0.7×1.4 로 작으므로 기둥 자리 하나에 여러 개를 세우거나 크게 키운다.
 */
export const PILLAR: KitModel = {
  file: "column",
  note: "석주. 원본이 작아 기둥 칸에는 확대하거나 여러 개를 세운다",
}

/**
 * 등불. 세계관의 중심 소품이라 장식이 아니라 의미가 있다.
 * 벽면에 붙이는 torch_mounted 를 주로 쓰고, 불이 켜진 것과 꺼진 것을 구분한다.
 */
export const LIGHTS = {
  lit: { file: "torch_lit", yOffset: 0.4, note: "켜진 횃불. 사람의 손이 닿는 구역" },
  mounted: { file: "torch_mounted", yOffset: 0.4, note: "벽걸이 횃불. 꺼진 것도 포함" },
} satisfies Record<string, KitModel>

/**
 * 소품. 세계관 문서의 "용도가 읽히는 오브젝트" 기준에 맞춰 골랐다.
 * 정체불명의 던전 장식이 아니라 사람이 쓰던 물건들이다.
 */
export interface PropDef extends KitModel {
  /** 이 소품이 어울리는 맵 (docs/content/maps.md 의 맵 id) */
  fits: string[]
  /** 통행을 막는가. true 면 배치 시 통행 칸을 피해야 한다 */
  blocking: boolean
}

export const PROPS: PropDef[] = [
  { file: "barrel_small", fits: ["mine", "town"], blocking: true, note: "작은 통. 채굴 구역의 보급" },
  { file: "barrel_large", fits: ["mine", "town"], blocking: true, note: "큰 통" },
  { file: "crates_stacked", fits: ["mine", "town", "bridge"], blocking: true, note: "쌓인 나무 상자" },
  { file: "rubble_large", fits: ["mine", "hall", "catacomb"], blocking: true, note: "무너진 잔해. 큼(8×3.5)" },
  { file: "rubble_half", fits: ["mine", "hall", "catacomb", "bridge"], blocking: false, note: "낮은 잔해. 넘어다닐 수 있는 정도" },
  { file: "table_medium_broken", fits: ["hall", "throne", "town"], blocking: true, note: "부서진 탁자. 사람이 살던 흔적" },
  { file: "shelf_small_candles", fits: ["catacomb", "throne", "town"], blocking: true, note: "촛대 선반. 성소 계열" },
  { file: "candle_lit", fits: ["catacomb", "throne", "cistern"], blocking: false, note: "켜진 초. 바닥에 놓는 작은 광원" },
  { file: "chest", fits: ["mine", "hall", "catacomb", "bridge"], blocking: true, note: "상자. 나중에 상호작용 대상이 될 수 있다" },
  { file: "chest_gold", fits: ["throne", "cistern", "crucible"], blocking: true, note: "금 상자. 보스방 보상 연출용" },
]

export const PROPS_BY_MAP: Record<string, PropDef[]> = Object.fromEntries(
  ["town", "mine", "hall", "catacomb", "bridge", "throne", "cistern", "crucible"].map((id) => [
    id,
    PROPS.filter((p) => p.fits.includes(id)),
  ]),
)
