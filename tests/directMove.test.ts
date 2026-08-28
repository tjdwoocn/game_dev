import { describe, it, expect } from "vitest"
import { directionFromKeys } from "../src/systems/directMove"

describe("directionFromKeys", () => {
  it("누른 키가 없으면 null", () => {
    expect(directionFromKeys([])).toBeNull()
  })

  it("W 는 화면 위(-Z), S 는 아래(+Z)", () => {
    expect(directionFromKeys(["KeyW"])).toEqual({ x: 0, z: -1 })
    expect(directionFromKeys(["KeyS"])).toEqual({ x: 0, z: 1 })
  })

  it("A 는 좌(-X), D 는 우(+X)", () => {
    expect(directionFromKeys(["KeyA"])).toEqual({ x: -1, z: 0 })
    expect(directionFromKeys(["KeyD"])).toEqual({ x: 1, z: 0 })
  })

  it("방향키도 같은 방향으로 동작한다", () => {
    expect(directionFromKeys(["ArrowUp"])).toEqual(directionFromKeys(["KeyW"]))
    expect(directionFromKeys(["ArrowRight"])).toEqual(directionFromKeys(["KeyD"]))
  })

  it("대각선이 직선보다 빠르지 않다", () => {
    const d = directionFromKeys(["KeyW", "KeyD"])!
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1)
    expect(d.x).toBeCloseTo(Math.SQRT1_2)
    expect(d.z).toBeCloseTo(-Math.SQRT1_2)
  })

  it("반대 방향을 함께 누르면 상쇄되어 null", () => {
    expect(directionFromKeys(["KeyW", "KeyS"])).toBeNull()
    expect(directionFromKeys(["KeyA", "KeyD"])).toBeNull()
  })

  it("이동과 무관한 키는 무시한다", () => {
    expect(directionFromKeys(["KeyI", "Space"])).toBeNull()
    expect(directionFromKeys(["KeyW", "KeyI"])).toEqual({ x: 0, z: -1 })
  })
})
