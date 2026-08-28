import type { Affix } from "../core/world"
import type { ItemInstance } from "../core/world"
import type { CharacterClass, ItemDefinition } from "./equipment"
import { rollAffixes } from "./items"

/**
 * 아이템 카탈로그 — 이름과 성격이 있는 구체적인 장비 목록.
 *
 * 기존 `content/items.ts` 의 절차적 생성(`rollItem`)과 역할이 다르다.
 *   - 절차적: 이름 없는 잡템. 어떤 적이든 떨구는 기본 흐름을 채운다.
 *   - 카탈로그(이 파일): 어디서 나오는지가 정해진 아이템. 드랍 테이블이 가리킨다.
 * 둘은 공존한다. 잡템이 루팅의 밀도를 만들고, 카탈로그가 목표를 만든다.
 *
 * 작명은 `docs/content/world.md` 의 규칙을 따른다 — `상태 수식어 + 물건`,
 * 영어 음차 금지, "전설의·신의" 같은 과장 수식 금지.
 */

export interface CatalogItem extends ItemDefinition {
  /** 이 아이템이 주는 기본 스탯. 등급과 레벨대에 비례한다. */
  base: Affix
  /** 드랍 조건 매칭에 쓰는 태그 (`DropCondition.enemyTags` 와는 별개로 아이템 분류용) */
  tags: readonly string[]
  /** 한 줄 설명. 세계관을 드러내되 성능을 설명하지 않는다. */
  flavor: string
}

/**
 * 현재 플레이 가능한 클래스는 전사뿐이다. 다른 클래스 전용 아이템을 만들면
 * 지금은 절대 못 쓰는 죽은 드랍이 되므로, **모든 아이템은 전사가 쓸 수 있게** 둔다.
 * 궁수·술사가 실제로 플레이 가능해지면 그때 전용 아이템을 나눈다.
 */
const ALL: readonly CharacterClass[] = ["warrior", "ranger", "mystic"]
const MELEE: readonly CharacterClass[] = ["warrior"]
const MELEE_RANGED: readonly CharacterClass[] = ["warrior", "ranger"]

/** 깊이 1 — 옛 채굴 구역과 매장 구역 (권장 1~3레벨) */
const DEPTH_1: CatalogItem[] = [
  {
    id: "pick-blade", name: "낡은 곡괭이 검", slot: "weapon", rarity: "common",
    minLevel: 1, allowedClasses: MELEE, base: { stat: "attackPower", value: 9 },
    tags: ["mine", "starter"],
    flavor: "곡괭이를 벼려 만든 것. 원래 용도가 아직 손잡이에 남아 있다.",
  },
  {
    id: "bone-cleaver", name: "벼려진 뼈 가름검", slot: "weapon", rarity: "magic",
    minLevel: 3, allowedClasses: MELEE, base: { stat: "attackPower", value: 16 },
    tags: ["catacomb"],
    flavor: "납골당에서 오래 쓰인 검. 날이 이상하리만치 잘 선다.",
  },
  {
    id: "miner-vest", name: "해진 광부 조끼", slot: "armor", rarity: "common",
    minLevel: 1, allowedClasses: ALL, base: { stat: "maxHp", value: 28 },
    tags: ["mine", "starter"],
    flavor: "가죽에 돌가루가 배어 있다. 누군가 오래 입었다.",
  },
  {
    id: "patched-plate", name: "덧댄 판금 갑옷", slot: "armor", rarity: "magic",
    minLevel: 3, allowedClasses: MELEE_RANGED, base: { stat: "maxHp", value: 46 },
    tags: ["mine", "catacomb"],
    flavor: "깨진 자리마다 다른 쇠를 덧대 놓았다.",
  },
  {
    id: "iron-loop", name: "무쇠 고리", slot: "ring", rarity: "common",
    minLevel: 1, allowedClasses: ALL, base: { stat: "attackPower", value: 6 },
    tags: ["mine", "starter"],
    flavor: "장식이라기엔 투박하다. 아마 공구의 일부였을 것이다.",
  },
  {
    id: "lantern-seal", name: "등불 인장", slot: "ring", rarity: "magic",
    minLevel: 2, allowedClasses: ALL, base: { stat: "maxHp", value: 34 },
    tags: ["lantern"],
    flavor: "등불지기가 임무를 받을 때 받는 인장. 잃으면 다시 받지 못한다.",
  },
]

/** 깊이 2 — 옛 수로와 성소 (권장 4~6레벨) */
const DEPTH_2: CatalogItem[] = [
  {
    id: "conduit-hook", name: "수로 갈고리", slot: "weapon", rarity: "magic",
    minLevel: 4, allowedClasses: MELEE_RANGED, base: { stat: "attackPower", value: 22 },
    tags: ["bridge", "cistern"],
    flavor: "물길에서 무언가를 끌어올리던 도구. 끝이 심하게 닳았다.",
  },
  {
    id: "sanctum-maul", name: "성소의 파쇄 망치", slot: "weapon", rarity: "rare",
    minLevel: 6, allowedClasses: MELEE, base: { stat: "attackPower", value: 30 },
    tags: ["hall", "throne", "break"],
    flavor: "성소의 문을 부수기 위해 만들어졌다. 지키기 위한 것이 아니었다.",
  },
  {
    id: "silted-mail", name: "물때 낀 사슬 갑옷", slot: "armor", rarity: "magic",
    minLevel: 4, allowedClasses: MELEE_RANGED, base: { stat: "maxHp", value: 52 },
    tags: ["bridge", "cistern"],
    flavor: "고리 사이에 마른 물때가 끼어 있다. 씻어도 냄새가 남는다.",
  },
  {
    id: "sanctum-plate", name: "성소 사제의 판금", slot: "armor", rarity: "rare",
    minLevel: 6, allowedClasses: ALL, base: { stat: "maxHp", value: 68 },
    tags: ["hall", "throne"],
    flavor: "사제가 왜 판금을 입어야 했는지는 기록에 없다.",
  },
  {
    id: "ripple-band", name: "물결 무늬 반지", slot: "ring", rarity: "magic",
    minLevel: 5, allowedClasses: ALL, base: { stat: "moveSpeedPct", value: 11 },
    tags: ["bridge", "cistern"],
    flavor: "표면의 무늬가 물이 번지듯 이어진다.",
  },
  {
    id: "starlog-ring", name: "성좌 기록의 반지", slot: "ring", rarity: "rare",
    minLevel: 6, allowedClasses: ALL, base: { stat: "attackPower", value: 19 },
    tags: ["hall", "throne"],
    flavor: "안쪽에 별자리와 날짜가 새겨져 있다. 무엇을 기록한 날인지는 모른다.",
  },
]

/** 깊이 3 — 시련의 층 (권장 7~10레벨) */
const DEPTH_3: CatalogItem[] = [
  {
    id: "keeper-longsword", name: "등불지기의 장검", slot: "weapon", rarity: "rare",
    minLevel: 8, allowedClasses: MELEE, base: { stat: "attackPower", value: 40 },
    tags: ["crucible", "lantern"],
    flavor: "손잡이에 이름이 여럿 새겨져 있다. 마지막 칸은 비어 있다.",
  },
  {
    id: "trial-greatsword", name: "시련의 대검", slot: "weapon", rarity: "rare",
    minLevel: 10, allowedClasses: MELEE, base: { stat: "attackPower", value: 52 },
    tags: ["crucible", "break"],
    flavor: "시험을 통과한 자에게 주어졌다. 통과하지 못한 자의 것도 섞여 있다.",
  },
  {
    id: "warden-plate", name: "강철수호자의 판금", slot: "armor", rarity: "rare",
    minLevel: 8, allowedClasses: MELEE, base: { stat: "maxHp", value: 82 },
    tags: ["crucible"],
    flavor: "안쪽이 바깥보다 더 상해 있다.",
  },
  {
    id: "ashen-cuirass", name: "재를 두른 흉갑", slot: "armor", rarity: "rare",
    minLevel: 10, allowedClasses: ALL, base: { stat: "maxHp", value: 100 },
    tags: ["crucible", "lantern"],
    flavor: "타고 남은 것을 다시 눌러 만들었다.",
  },
  {
    id: "ash-seal", name: "재의 인장", slot: "ring", rarity: "rare",
    minLevel: 8, allowedClasses: ALL, base: { stat: "attackPower", value: 20 },
    tags: ["crucible"],
    flavor: "등불이 꺼진 자리에서 거둔 인장. 주인의 이름은 지워졌다.",
  },
  {
    id: "unspent-ember", name: "꺼지지 않는 불씨", slot: "ring", rarity: "rare",
    minLevel: 10, allowedClasses: ALL, base: { stat: "maxHp", value: 88 },
    tags: ["crucible", "lantern"],
    flavor: "쥐고 있으면 미지근하다. 아직 다 타지 않았다.",
  },
]

export const ITEM_CATALOG: readonly CatalogItem[] = [...DEPTH_1, ...DEPTH_2, ...DEPTH_3]

export const ITEM_BY_ID: Record<string, CatalogItem> = Object.fromEntries(
  ITEM_CATALOG.map((item) => [item.id, item]),
)

let nextCatalogItemId = 100_000

/**
 * 카탈로그 정의를 실제 인벤토리 아이템으로 변환한다.
 *
 * **접사를 절차적 잡템과 같은 규칙으로 굴린다** (일반 0 / 마법 1 / 희귀 2).
 * 이게 없으면 이름 있는 아이템이 길에서 줍는 잡템보다 약해진다 — 실측으로 확인했고,
 * 그러면 카탈로그가 목표로서 기능하지 못한다. `tests/itemCatalog.test.ts` 가 매번 확인한다.
 *
 * rng 를 넘기지 않으면 Math.random 을 쓴다. 게임에서는 `res.rng` 를 넘겨 주는 편이 낫다.
 */
export function createCatalogItemInstance(item: CatalogItem, rng: () => number = Math.random): ItemInstance {
  return {
    id: nextCatalogItemId++,
    name: item.name,
    slot: item.slot,
    rarity: item.rarity,
    base: { ...item.base },
    affixes: rollAffixes(rng, item.rarity),
    requiredLevel: item.minLevel,
    allowedClasses: item.allowedClasses,
  }
}

export function getCatalogItem(id: string): CatalogItem | undefined {
  return ITEM_BY_ID[id]
}
