import { describe, expect, it } from "vitest"
import { CAMERA_PITCH, CAMERA_ZOOM, createCameraRig, getCameraPosition, updateCameraRig } from "../src/systems/camera"

describe("camera rig", () => {
  it("기본 오프셋을 적용한다", () => {
    const rig = createCameraRig()
    const pos = getCameraPosition(rig, { x: 10, y: 0, z: 20 })
    expect(pos.x).toBeCloseTo(10)
    expect(pos.y).toBeCloseTo(16)
    expect(pos.z).toBeCloseTo(27)
  })

  it("줌을 제한한다", () => {
    const rig = createCameraRig()
    updateCameraRig(rig, -99999, 0)
    expect(rig.zoom).toBe(CAMERA_ZOOM.min)
    updateCameraRig(rig, 99999, 0)
    expect(rig.zoom).toBe(CAMERA_ZOOM.max)
  })

  it("수평 오프셋만 회전한다", () => {
    const rig = createCameraRig()
    updateCameraRig(rig, 0, 6)
    const pos = getCameraPosition(rig, { x: 0, y: 0, z: 0 })
    expect(pos.y).toBeCloseTo(16)
    expect(pos.x).toBeCloseTo(7)
    expect(pos.z).toBeCloseTo(0)
  })

  it("pitch를 35도에서 78도 사이로 제한한다", () => {
    const rig = createCameraRig()
    updateCameraRig(rig, 0, 0, -999)
    expect(rig.pitch).toBe(CAMERA_PITCH.min)
    updateCameraRig(rig, 0, 0, 999)
    expect(rig.pitch).toBe(CAMERA_PITCH.max)
  })

  it("최소 줌에서도 플레이어를 향한 카메라 오프셋을 유지한다", () => {
    const rig = createCameraRig()
    updateCameraRig(rig, -99999, 0)
    const pos = getCameraPosition(rig, { x: 0, y: 0, z: 0 })
    expect(Math.hypot(pos.x, pos.y, pos.z)).toBeCloseTo(Math.hypot(0, 16, 7) * CAMERA_ZOOM.min)
    expect(pos.y).toBeGreaterThan(0)
  })
})
