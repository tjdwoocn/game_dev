import { describe, expect, it } from "vitest"
import { createWorld, type Entity, type GameWorld } from "../src/core/world"
import { ADJACENT_ARC, GRAB_PX, GRAB_WORLD, grabEnemyNear } from "../src/systems/targeting"

/**
 * 클릭 관대함 규칙 — "적을 정확히 찍어야만 공격이 나간다" 를 없앤 판정.
 *
 * 투영을 인자로 받으므로 카메라 없이 규칙만 검증한다.
 * 여기서는 월드 (x, z) 를 화면 (x*10, z*10) 픽셀로 두는 가상의 투영을 쓴다.
 */
const project = (x: number, _y: number, z: number) => ({ x: x * 10, y: z * 10 })

function makePlayer(world: GameWorld, range = 1.6): Entity {
  return world.add({
    player: {} as Entity["player"],
    transform: { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
    attack: { damage: 10, range, arc: 1.2, cooldown: 0.5, readyAt: 0 },
  })
}

function addEnemy(world: GameWorld, x: number, z: number): Entity {
  return world.add({
    enemy: { kind: "warrior", state: "idle", home: { x, z } } as Entity["enemy"],
    transform: { position: { x, y: 0, z }, yaw: 0 },
    health: { current: 30, max: 30 },
  })
}

describe("클릭 타겟팅 관대함", () => {
  it("적을 정확히 찍지 않아도 화면상 GRAB_PX 안이면 잡는다", () => {
    const world = createWorld()
    const player = makePlayer(world)
    const enemy = addEnemy(world, 4, 0) // 화면 (40, 0)
    // 적 화면 좌표에서 GRAB_PX 보다 조금 안쪽으로 빗나간 클릭
    const click = { x: 40 + GRAB_PX - 5, y: 0 }
    expect(grabEnemyNear(world, player, click, { x: 4, z: 0 }, project)).toBe(enemy)
  })

  it("GRAB_PX 를 벗어나고 코앞도 아니면 잡지 않는다 — 이동 명령이어야 한다", () => {
    const world = createWorld()
    const player = makePlayer(world)
    addEnemy(world, 4, 0)
    const click = { x: 40 + GRAB_PX + 20, y: 0 }
    expect(grabEnemyNear(world, player, click, { x: 10, z: 0 }, project)).toBeNull()
  })

  it("화면상 가까워도 지면 지점에서 GRAB_WORLD 밖이면 잡지 않는다", () => {
    // 저각 카메라에서 멀리 있는 적이 화면상 겹쳐 보이는 상황을 막는다
    const world = createWorld()
    const player = makePlayer(world)
    addEnemy(world, 4, 0)
    const click = { x: 40, y: 0 } // 화면상 정확히 겹친다
    const farGround = { x: 4 + GRAB_WORLD + 1, z: 0 }
    expect(grabEnemyNear(world, player, click, farGround, project)).toBeNull()
  })

  it("코앞의 적은 그 방향을 찍기만 하면 잡는다", () => {
    const world = createWorld()
    const player = makePlayer(world)
    const enemy = addEnemy(world, 0, 1.5) // 사거리 1.6 + 여유 안쪽
    // 화면상으로는 한참 빗나간 클릭이지만 방향은 적 쪽이다
    const click = { x: 9999, y: 9999 }
    expect(grabEnemyNear(world, player, click, { x: 0, z: 8 }, project)).toBe(enemy)
  })

  it("코앞의 적이라도 반대쪽을 찍으면 잡지 않는다 — 후퇴가 막히면 안 된다", () => {
    const world = createWorld()
    const player = makePlayer(world)
    addEnemy(world, 0, 1.5)
    const click = { x: 9999, y: 9999 }
    // 적은 +z, 클릭은 -z (180도 차이) — ADJACENT_ARC 밖이다
    expect(ADJACENT_ARC).toBeLessThan(Math.PI)
    expect(grabEnemyNear(world, player, click, { x: 0, z: -8 }, project)).toBeNull()
  })

  it("후보가 여럿이면 화면상 더 가까운 적을 고른다", () => {
    const world = createWorld()
    const player = makePlayer(world)
    addEnemy(world, 4, 0) // 화면 (40, 0)
    const nearer = addEnemy(world, 4.3, 0) // 화면 (43, 0)
    expect(grabEnemyNear(world, player, { x: 45, y: 0 }, { x: 4.3, z: 0 }, project)).toBe(nearer)
  })

  it("죽은 적은 잡지 않는다", () => {
    const world = createWorld()
    const player = makePlayer(world)
    const enemy = addEnemy(world, 4, 0)
    world.addComponent(enemy, "dead", { at: 0 })
    expect(grabEnemyNear(world, player, { x: 40, y: 0 }, { x: 4, z: 0 }, project)).toBeNull()
  })
})
