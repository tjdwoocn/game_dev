import { beforeEach, describe, expect, it } from "vitest"
import * as THREE from "three"
import { spawnEnemy, ENEMY_DEFS } from "../src/content/enemies"
import { createGame } from "../src/scenario/headless"
import { advance, STEP } from "../src/scenario/run"
import {
  _resetTelegraphsForTest,
  activeTelegraphCount,
  clearTelegraphs,
  updateTelegraphs,
} from "../src/systems/telegraph"

/**
 * 위험 구역 표시 — **끊긴 예고가 바닥에 남지 않는가.**
 *
 * `ai.ts` 는 경직·기절·사망으로 돌진이 끊길 때 `enemyAction` 컴포넌트를 조용히 떼기만
 * 하고 취소 이벤트를 내지 않는다. 이벤트만 보고 그리면 예고가 영원히 남아 **있지도 않은
 * 위협을 피해 다니게 된다.** 그래서 이 모듈은 상태를 직접 읽고, 여기서 그 수명을 고정한다.
 *
 * 헤드리스에서 도는 이유: `scenario/headless` 가 진짜 `THREE.Scene` 을 주므로
 * 브라우저 없이 풀 생명주기를 전부 검사할 수 있다. WebGL 은 필요 없다.
 */

function spawnChargerInLane(game: ReturnType<typeof createGame>) {
  for (const prop of [...game.world.with("destructible")]) game.world.remove(prop)
  const p = game.player.transform!.position
  return spawnEnemy(game.world, "charger", p.x, p.z - 4)
}

/** 표현 시스템은 헤드리스 루프에 없다. 시뮬레이션을 돌린 뒤 직접 한 번 갱신한다. */
function sync(game: ReturnType<typeof createGame>): void {
  updateTelegraphs(game.world, game.res)
}

beforeEach(() => { _resetTelegraphsForTest() })

describe("돌진 위험 구역", () => {
  it("windup이 시작되면 예고가 하나 뜬다", () => {
    const game = createGame({ zoneId: "mine", seed: 601, companions: false })
    const charger = spawnChargerInLane(game)
    advance(game, STEP)
    expect(charger.enemyAction?.phase).toBe("windup")

    sync(game)
    expect(activeTelegraphCount()).toBe(1)
  })

  it("보이는 띠가 실제 접촉 판정과 같은 폭·방향이다", () => {
    // 표현이 자기 숫자를 따로 가지면 "피했는데 맞았다" 가 생긴다.
    // `combat.ts` 의 접촉은 origin·dir·halfWidth 로 판정하므로 띠도 그것이어야 한다.
    const game = createGame({ zoneId: "mine", seed: 601, companions: false })
    const charger = spawnChargerInLane(game)
    advance(game, STEP)
    sync(game)

    const action = charger.enemyAction!
    const charge = ENEMY_DEFS.charger.charge!
    const group = game.res.scene.getObjectByName("telegraph")!
    const extent = group.children.find((c) => c.visible && (c as THREE.Mesh).isMesh)! as THREE.Mesh

    expect(extent.scale.x).toBeCloseTo(charge.halfWidth * 2, 5)
    expect(extent.position.x).toBeCloseTo(action.origin.x, 5)
    expect(extent.position.z).toBeCloseTo(action.origin.z, 5)
    expect(extent.rotation.y).toBeCloseTo(Math.atan2(action.dir.x, action.dir.z), 5)
    // 벽에 막히지 않았다면 도달 거리는 speed × active 다.
    expect(extent.scale.z).toBeGreaterThan(0)
    expect(extent.scale.z).toBeLessThanOrEqual(charge.speed * charge.active + 1e-6)
  })

  it("돌진이 끊기면 예고가 남지 않는다", () => {
    // 취소 이벤트가 없는 경로다. 여기가 깨지면 바닥에 유령 위험 구역이 쌓인다.
    const game = createGame({ zoneId: "mine", seed: 601, companions: false })
    const charger = spawnChargerInLane(game)
    advance(game, STEP)
    sync(game)
    expect(activeTelegraphCount()).toBe(1)

    // ai.ts 의 취소 경로와 동일하게 컴포넌트를 뗀다.
    game.world.removeComponent(charger, "enemyAction")
    sync(game)
    // 바로 사라지지는 않는다 — 무산되는 모습을 보여 준 뒤 걷힌다.
    expect(activeTelegraphCount()).toBe(1)

    advance(game, 0.4)
    sync(game)
    expect(activeTelegraphCount()).toBe(0)
  })

  it("돌진이 끝까지 나가도 예고가 남지 않는다", () => {
    const game = createGame({ zoneId: "mine", seed: 601, companions: false })
    spawnChargerInLane(game)
    advance(game, STEP)
    sync(game)
    expect(activeTelegraphCount()).toBe(1)

    // windup 0.42 + active 0.34 + 소멸 0.22 보다 넉넉히
    for (let i = 0; i < 80; i++) { advance(game, STEP); sync(game) }
    expect(activeTelegraphCount()).toBe(0)
  })

  it("적이 죽으면 예고가 걷힌다", () => {
    const game = createGame({ zoneId: "mine", seed: 601, companions: false })
    const charger = spawnChargerInLane(game)
    advance(game, STEP)
    sync(game)
    expect(activeTelegraphCount()).toBe(1)

    charger.dead = { at: game.res.time.now }
    sync(game)
    advance(game, 0.4)
    sync(game)
    expect(activeTelegraphCount()).toBe(0)
  })

  it("존이 바뀌면 남은 예고를 즉시 지운다", () => {
    const game = createGame({ zoneId: "mine", seed: 601, companions: false })
    spawnChargerInLane(game)
    advance(game, STEP)
    sync(game)
    expect(activeTelegraphCount()).toBe(1)

    clearTelegraphs()
    expect(activeTelegraphCount()).toBe(0)
  })

  it("풀을 넘겨도 던지지 않고, 씬 오브젝트가 늘지 않는다", () => {
    // 밀도를 올리면 돌격병이 동시에 여럿 자세를 잡는다. 그때 풀을 새로 만들면
    // 존 전환마다 텍스처가 쌓이던 그 누수를 그대로 반복한다.
    const game = createGame({ zoneId: "mine", seed: 601, companions: false })
    for (const prop of [...game.world.with("destructible")]) game.world.remove(prop)
    const p = game.player.transform!.position
    for (let i = 0; i < 10; i++) spawnEnemy(game.world, "charger", p.x + i * 0.5, p.z - 4)

    advance(game, STEP)
    sync(game)
    const group = game.res.scene.getObjectByName("telegraph")!
    const before = group.children.length
    expect(activeTelegraphCount()).toBeLessThanOrEqual(6)

    for (let i = 0; i < 60; i++) { advance(game, STEP); sync(game) }
    expect(group.children.length).toBe(before)
  })
})
