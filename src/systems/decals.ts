import * as THREE from "three"
import type { Resources } from "../core/world"
import type { CombatEvent, CombatEventKind } from "./combatEvents"

/**
 * 바닥 자국 — 전투가 지나간 흔적을 남긴다.
 *
 * 참고한 레퍼런스(Claude of Tanks)에는 `fx/impactDecals.js` 가 따로 있다. 포탄이 떨어진
 * 자리에 자국이 남아 **전장이 시간에 따라 변한다**. 우리 게임은 지금 적을 아무리 잡아도
 * 바닥이 처음 그대로여서, 방을 정리하고 나면 아무 일도 없었던 것처럼 보인다.
 *
 * 우리 톤은 밝고 아기자기하므로 핏자국이 아니라 **흙먼지 자국**으로 간다.
 * 어두운 얼룩 하나면 충분하다 — 여기서 뭔가 쓰러졌다는 것만 읽히면 된다.
 *
 * 다른 이펙트와 마찬가지로 **풀링**한다. 자국은 수명이 길어(8초) 동시에 여러 개가
 * 살아 있으므로 매번 만들면 금세 쌓인다.
 *
 * 수명은 `res.time.now`(게임 시간)를 쓴다 — 히트스톱 중에는 같이 멈춘다.
 */

const POOL = 26
/** 자국이 완전히 사라지기까지(초). 전투 한 번의 흔적이 다음 교전까지 남을 정도. */
const LIFE = 8
/** 사라지기 시작하는 시점(0~1). 앞부분은 진하게 유지된다. */
const HOLD = 0.55

interface Spec {
  color: number
  radius: number
  opacity: number
}

const SPEC: Partial<Record<CombatEventKind, Spec>> = {
  // 일반 타격은 남기지 않는다 — 초당 몇 번씩 나므로 바닥이 금세 지저분해진다.
  hitHeavy: { color: 0x6b4a2c, radius: 0.5, opacity: 0.3 },
  enemyDeath: { color: 0x5a3f28, radius: 0.85, opacity: 0.42 },
  playerHurt: { color: 0x7a3028, radius: 0.6, opacity: 0.3 },
  breakSuccess: { color: 0x2f5a68, radius: 1.15, opacity: 0.4 },
  whirlwind: { color: 0x6b512c, radius: 1.5, opacity: 0.22 },
}

let texture: THREE.Texture | null = null

/**
 * 자국 텍스처. 가운데가 진하고 가장자리로 사라지는 얼룩을 캔버스로 굽는다.
 * 원본 이미지 파일은 여전히 0개다 — 레퍼런스의 절차적 텍스처 방식 그대로다.
 */
function getTexture(): THREE.Texture | null {
  if (texture) return texture
  if (typeof document === "undefined") return null
  const size = 128
  const cv = document.createElement("canvas")
  cv.width = cv.height = size
  const g = cv.getContext("2d")
  if (!g) return null
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, "rgba(255,255,255,0.95)")
  grad.addColorStop(0.45, "rgba(255,255,255,0.55)")
  grad.addColorStop(1, "rgba(255,255,255,0)")
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  // 완전한 원은 인공적으로 보인다. 가장자리를 조금 갉아 낸다.
  g.globalCompositeOperation = "destination-out"
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    const r = size * (0.34 + (i % 3) * 0.045)
    g.beginPath()
    g.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, size * 0.11, 0, Math.PI * 2)
    g.fill()
  }
  texture = new THREE.CanvasTexture(cv)
  texture.needsUpdate = true
  return texture
}

interface Slot {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  start: number
  peak: number
  active: boolean
}

let root: THREE.Group | null = null
const pool: Slot[] = []
let geometry: THREE.PlaneGeometry | null = null

function ensurePool(res: Resources): boolean {
  if (root) return true
  const tex = getTexture()
  if (!tex) return false
  root = new THREE.Group()
  root.name = "decals"
  res.scene.add(root)
  geometry = new THREE.PlaneGeometry(1, 1)
  geometry.rotateX(-Math.PI / 2)
  for (let i = 0; i < POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, map: tex, transparent: true, opacity: 0,
      depthWrite: false,
      // 바닥과 같은 평면이라 z-파이팅이 난다. 폴리곤 오프셋으로 살짝 앞으로 당긴다.
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    })
    mat.userData.outlineParameters = { visible: false }
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.visible = false
    mesh.renderOrder = 1
    mesh.castShadow = false
    mesh.receiveShadow = false
    root.add(mesh)
    pool.push({ mesh, mat, start: 0, peak: 0, active: false })
  }
  return true
}

function take(now: number): Slot {
  let oldest = pool[0]!
  for (const s of pool) {
    if (!s.active) return s
    if (s.start < oldest.start) oldest = s
  }
  void now
  return oldest
}

export function spawnDecal(res: Resources, evt: CombatEvent): void {
  const spec = SPEC[evt.kind]
  if (!spec || !evt.at) return
  if (!ensurePool(res)) return
  const now = res.time.now
  const s = take(now)
  s.active = true
  s.start = now
  s.peak = spec.opacity * evt.power
  s.mat.color.setHex(spec.color)
  s.mesh.position.set(evt.at.x, 0.03, evt.at.z)
  // 회전을 무작위로 줘야 같은 얼룩이 반복돼 보이지 않는다
  s.mesh.rotation.y = res.rng() * Math.PI * 2
  const r = spec.radius * (0.85 + res.rng() * 0.3)
  s.mesh.scale.set(r * 2, 1, r * 2)
  s.mesh.visible = true
}

export function updateDecals(res: Resources): void {
  if (!root) return
  const now = res.time.now
  for (const s of pool) {
    if (!s.active) continue
    const t = (now - s.start) / LIFE
    if (t >= 1 || t < 0) {
      s.active = false
      s.mesh.visible = false
      continue
    }
    s.mat.opacity = t < HOLD ? s.peak : s.peak * (1 - (t - HOLD) / (1 - HOLD))
  }
}

/** 존을 옮길 때 이전 맵의 자국을 지운다. */
export function clearDecals(): void {
  for (const s of pool) {
    s.active = false
    s.mesh.visible = false
  }
}
