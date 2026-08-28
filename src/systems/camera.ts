import * as THREE from "three"

export const CAMERA_DEFAULT = { x: 0, y: 16, z: 7 } as const
export const CAMERA_ZOOM = { min: 0.32, max: 1.45, step: 0.0015 } as const
export const CAMERA_ROTATE_STEP = Math.PI / 12
export const CAMERA_PITCH = {
  min: THREE.MathUtils.degToRad(35),
  max: THREE.MathUtils.degToRad(78),
  step: THREE.MathUtils.degToRad(5),
  default: Math.atan2(CAMERA_DEFAULT.y, Math.hypot(CAMERA_DEFAULT.x, CAMERA_DEFAULT.z)),
} as const

const CAMERA_DISTANCE = Math.hypot(CAMERA_DEFAULT.x, CAMERA_DEFAULT.y, CAMERA_DEFAULT.z)
const CAMERA_HORIZONTAL_LENGTH = Math.hypot(CAMERA_DEFAULT.x, CAMERA_DEFAULT.z)

export interface CameraRigState {
  angle: number
  zoom: number
  pitch: number
}

export function createCameraRig(): CameraRigState {
  return { angle: 0, zoom: 1, pitch: CAMERA_PITCH.default }
}

export function updateCameraRig(rig: CameraRigState, zoomDelta: number, rotateSteps: number, pitchSteps = 0): void {
  rig.zoom = Math.min(CAMERA_ZOOM.max, Math.max(CAMERA_ZOOM.min, rig.zoom + zoomDelta * CAMERA_ZOOM.step))
  rig.angle += rotateSteps * CAMERA_ROTATE_STEP
  rig.pitch = Math.min(CAMERA_PITCH.max, Math.max(CAMERA_PITCH.min, rig.pitch + pitchSteps * CAMERA_PITCH.step))
}

export function getCameraPosition(
  rig: CameraRigState,
  target: { x: number; y: number; z: number },
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const distance = CAMERA_DISTANCE * rig.zoom
  const horizontal = distance * Math.cos(rig.pitch)
  const baseX = CAMERA_DEFAULT.x / CAMERA_HORIZONTAL_LENGTH
  const baseZ = CAMERA_DEFAULT.z / CAMERA_HORIZONTAL_LENGTH
  const directionX = baseX * Math.cos(rig.angle) + baseZ * Math.sin(rig.angle)
  const directionZ = -baseX * Math.sin(rig.angle) + baseZ * Math.cos(rig.angle)
  return out.set(
    target.x + directionX * horizontal,
    target.y + distance * Math.sin(rig.pitch),
    target.z + directionZ * horizontal,
  )
}
