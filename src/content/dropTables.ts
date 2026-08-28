import type { DropRule } from "./drops"

/**
 * 존별 드랍 테이블 — 어떤 아이템이 어디서 나오는가.
 *
 * `drops.ts` 의 `DropRule` 계약을 그대로 쓴다. 조건은 실제로 필요한 것만 건다:
 * 존, 보스 여부, 적 종류, 플레이어 레벨.
 *
 * 확률 감각
 *   - 일반 적: 0.03~0.10 — 카탈로그 아이템은 "가끔 나오는 것"이다.
 *     루팅의 밀도는 `content/items.ts` 의 절차적 잡템이 채운다.
 *   - 보스: 0.5~1.0 — 보스를 잡는 이유가 되어야 한다.
 *
 * `rollDropRules` 는 룰마다 독립으로 굴리므로 한 번에 여러 개가 나올 수 있다.
 * 핵앤슬래시 루팅 흐름에는 이쪽이 맞다.
 */

/** 깊이 1 — 옛 채굴 구역 */
const MINE_DROPS: DropRule[] = [
  { id: "mine-pick", itemId: "pick-blade", chance: 0.08, condition: { zoneIds: ["mine"] } },
  { id: "mine-vest", itemId: "miner-vest", chance: 0.08, condition: { zoneIds: ["mine"] } },
  { id: "mine-loop", itemId: "iron-loop", chance: 0.06, condition: { zoneIds: ["mine"] } },
  {
    id: "mine-plate", itemId: "patched-plate", chance: 0.04,
    condition: { zoneIds: ["mine"], minPlayerLevel: 3 },
  },
  // 등불 인장은 어느 깊이에서든 드물게 나온다 — 등불지기의 물건이므로 특정 구역 소유가 아니다
  { id: "any-lantern-seal", itemId: "lantern-seal", chance: 0.02, condition: { minPlayerLevel: 2 } },
]

/** 깊이 1 — 매장 구역 */
const CATACOMB_DROPS: DropRule[] = [
  { id: "cata-cleaver", itemId: "bone-cleaver", chance: 0.07, condition: { zoneIds: ["catacomb"], minPlayerLevel: 3 } },
  { id: "cata-plate", itemId: "patched-plate", chance: 0.06, condition: { zoneIds: ["catacomb"] } },
  { id: "cata-vest", itemId: "miner-vest", chance: 0.05, condition: { zoneIds: ["catacomb"] } },
]

/** 깊이 2 — 수로 계열 (다리·지하수로) */
const WATER_DROPS: DropRule[] = [
  { id: "water-hook", itemId: "conduit-hook", chance: 0.08, condition: { zoneIds: ["bridge", "cistern"], minPlayerLevel: 4 } },
  { id: "water-mail", itemId: "silted-mail", chance: 0.07, condition: { zoneIds: ["bridge", "cistern"], minPlayerLevel: 4 } },
  { id: "water-band", itemId: "ripple-band", chance: 0.05, condition: { zoneIds: ["bridge", "cistern"], minPlayerLevel: 5 } },
]

/** 깊이 2 — 성소 계열 (회랑·왕좌의 방) */
const SANCTUM_DROPS: DropRule[] = [
  { id: "sanctum-plate-drop", itemId: "sanctum-plate", chance: 0.05, condition: { zoneIds: ["hall"], minPlayerLevel: 6 } },
  { id: "sanctum-ring-drop", itemId: "starlog-ring", chance: 0.04, condition: { zoneIds: ["hall"], minPlayerLevel: 6 } },
  // 원거리형이 성소를 지키고 있었다는 설정 — 그쪽에서만 나온다
  {
    id: "sanctum-maul-drop", itemId: "sanctum-maul", chance: 0.06,
    condition: { zoneIds: ["hall"], enemyKinds: ["archer"], minPlayerLevel: 6 },
  },
]

/**
 * 보스 드랍. 보스를 잡을 이유가 되어야 하므로 확률이 높다.
 * `bossOnly` 로 호위병이 같은 것을 떨구지 않게 막는다.
 */
const BOSS_DROPS: DropRule[] = [
  // 레벨 조건은 아이템의 요구 레벨과 맞춘다. 안 그러면 보스를 일찍 잡았을 때
  // 착용도 못 하는 것이 나와 인벤토리만 차지한다.
  { id: "throne-maul", itemId: "sanctum-maul", chance: 0.6, condition: { zoneIds: ["throne"], bossOnly: true, minPlayerLevel: 5 } },
  { id: "throne-plate", itemId: "sanctum-plate", chance: 0.5, condition: { zoneIds: ["throne"], bossOnly: true, minPlayerLevel: 5 } },
  { id: "cistern-ring", itemId: "ripple-band", chance: 0.6, condition: { zoneIds: ["cistern"], bossOnly: true, minPlayerLevel: 4 } },
  { id: "cistern-mail", itemId: "silted-mail", chance: 0.5, condition: { zoneIds: ["cistern"], bossOnly: true, minPlayerLevel: 4 } },
  { id: "crucible-sword", itemId: "keeper-longsword", chance: 0.7, condition: { zoneIds: ["crucible"], bossOnly: true, minPlayerLevel: 8 } },
  { id: "crucible-plate", itemId: "warden-plate", chance: 0.6, condition: { zoneIds: ["crucible"], bossOnly: true, minPlayerLevel: 8 } },
  { id: "crucible-seal", itemId: "ash-seal", chance: 0.5, condition: { zoneIds: ["crucible"], bossOnly: true, minPlayerLevel: 8 } },
  // 최상위 두 점은 충분히 성장한 뒤에만 나온다 — 마지막 목표를 남겨 둔다
  { id: "crucible-greatsword", itemId: "trial-greatsword", chance: 0.35, condition: { zoneIds: ["crucible"], bossOnly: true, minPlayerLevel: 10 } },
  { id: "crucible-cuirass", itemId: "ashen-cuirass", chance: 0.35, condition: { zoneIds: ["crucible"], bossOnly: true, minPlayerLevel: 10 } },
  { id: "crucible-ember", itemId: "unspent-ember", chance: 0.3, condition: { zoneIds: ["crucible"], bossOnly: true, minPlayerLevel: 10 } },
]

export const DROP_TABLE: readonly DropRule[] = [
  ...MINE_DROPS,
  ...CATACOMB_DROPS,
  ...WATER_DROPS,
  ...SANCTUM_DROPS,
  ...BOSS_DROPS,
]
