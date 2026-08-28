import type { GameWorld, Resources } from "../core/world"
import { playCombatEvent, playSound } from "./audio"
import { collectCombatEvents, type CombatEventKind } from "./combatEvents"
import { clearCombatVfx, spawnCombatVfx, updateCombatVfx } from "./combatVfx"
import { clearDecals, spawnDecal, updateDecals } from "./decals"
import { clearHitDirection, showHitDirection } from "../ui/hitDirection"
import { clearDamageNumbers, spawnDamageNumber, updateDamageNumbers } from "../ui/damageNumbers"
import { shakeCamera } from "./render"
import { clearTelegraphs, updateTelegraphs } from "./telegraph"

/**
 * 타격 피드백 — 소리와 이펙트를 하나의 신호에서 낸다.
 *
 * 같은 순간에 소리는 나는데 불꽃은 안 튀거나 그 반대가 되면, 원인을 찾을 때
 * 두 벌의 판정을 각각 뒤져야 한다. 감지는 `combatEvents` 한 곳에서만 하고
 * 여기서 두 출력으로 나눈다.
 *
 * 게임 로직을 건드리지 않는다 — 전투·스킬·루팅 시스템에는 아무 호출도 심지 않았다.
 */
/**
 * 타격에 대한 카메라 반응 — 어떤 이벤트에 얼마나 오래 흔들 것인가(초).
 *
 * 녹화 스트립에서 타격 전후 24프레임의 카메라 이동량이 0.1117 → 0.0329 로
 * **단조 감소만 했다.** 타격 프레임에 스파이크가 0이었다. 즉 화면은 때리든 말든
 * 플레이어를 따라가기만 했다. 지금까지 화면이 흔들린 곳은 보스 내려찍기 하나뿐이다.
 *
 * `render.ts` 의 `shakeCamera` 는 지속시간만 받는다(진폭 고정 ±0.15).
 * 진폭·감쇠 파라미터는 카메라 담당(Codex)에게 요청해 뒀고, 그때까지는
 * 지속시간만으로 세기를 구분한다. 짧게 여러 번보다 길이 차이가 더 잘 읽힌다.
 */
export const SHAKE: Partial<Record<CombatEventKind, number>> = {
  hit: 0.07,
  hitHeavy: 0.13,
  enemyDeath: 0.16,
  playerHurt: 0.2, // 맞았을 때가 가장 크게 흔들려야 위험이 읽힌다
  whirlwind: 0.18, // 광역기는 기본 공격보다 확실히 크게 — 자원을 쓴 값을 해야 한다
  // 치명타는 집중 타격(0.13)과 처치(0.16) 사이. 일반 타격의 두 배 이상이라
  // 카메라만으로도 "방금 크게 들어갔다" 가 손에 전해진다.
  crit: 0.15,
  // 소품은 적이 아니다 — 부술 때 화면이 전투만큼 흔들리면 위협으로 오인된다. 아주 얕게.
  propBreak: 0.05,
  breakSuccess: 0.26,
  // 돌진 발동. 예고를 놓쳤어도 화면이 한 번 튀어 "지금 온다" 를 알린다.
  // 다만 맞은 것은 아니므로 피격(0.2)보다는 확실히 작다.
  enemyRelease: 0.08,
}

/**
 * 돌진 충돌은 평타 피격 위에 얹는 추가 흔들림. `playerHurt` 0.2 에 더해져
 * 이 게임에서 가장 크게 흔들린다 — 예고를 못 읽으면 제일 아프다는 뜻이다.
 */
const CHARGE_IMPACT_SHAKE = 0.14

/**
 * 존이 바뀌면 이전 맵의 이펙트와 자국을 지운다.
 *
 * `clearCombatVfx` 는 만들어 두고 **아무도 부르지 않고 있었다.** 이펙트 풀은 씬 루트에
 * 붙어 있어 맵 메시와 함께 정리되지 않으므로, 갱도에서 튄 불꽃이 마을 한복판에 떠 있게 된다.
 * 존 전환 시스템을 고치는 대신 여기서 `res.zoneId` 변화를 관측한다 —
 * 이 모듈이 상태 변화를 보고 반응한다는 원칙 그대로다.
 */
let lastZoneId: string | null = null

export function feedbackSystem(world: GameWorld, res: Resources): void {
  if (res.zoneId !== lastZoneId) {
    if (lastZoneId !== null) { clearCombatVfx(); clearDecals(); clearHitDirection(); clearDamageNumbers(); clearTelegraphs() }
    lastZoneId = res.zoneId
  }

  for (const evt of collectCombatEvents(world, res)) {
    playCombatEvent(evt)
    spawnCombatVfx(res, evt)
    spawnDecal(res, evt) // 바닥에 남는 흔적 — 전투가 지나간 자리가 보인다
    spawnDamageNumber(res, evt) // 얼마나 들어갔는가. `amount` 는 S1 의 damageResolved 가 처음 실어 준 값이다
    // 어디서 맞았는지. 공격자 정보는 이벤트에 없지만, 맞으면 공격자 반대쪽으로 밀리므로
    // 넉백 방향을 뒤집으면 공격자 방향이 나온다.
    if (evt.kind === "playerHurt" && evt.entity?.knockback) {
      const d = evt.entity.knockback.dir
      showHitDirection(Math.atan2(-d.x, -d.z), evt.power)
    }
    // 돌진 충돌은 베인 게 아니라 몸으로 받은 것이다. 소리와 흔들림을 따로 얹어
    // "평타에 맞았다" 와 구분한다.
    if (evt.kind === "playerHurt" && evt.sourceActionId === "charge") {
      playSound("chargeImpact", evt.power)
      shakeCamera(res, CHARGE_IMPACT_SHAKE * evt.power)
    }
    const shake = SHAKE[evt.kind]
    // power 는 거리 감쇠를 겸한다. 화면 밖에서 벌어진 일로 화면을 흔들지 않는다.
    if (shake !== undefined && evt.power > 0.4) shakeCamera(res, shake * evt.power)
  }
  updateCombatVfx(res)
  updateDecals(res)
  updateDamageNumbers(res)
  // 위험 구역은 이벤트가 아니라 상태에서 그린다 — 취소 이벤트가 없기 때문이다.
  updateTelegraphs(world, res)
}
