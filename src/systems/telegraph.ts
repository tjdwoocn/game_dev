import * as THREE from "three"
import type { GameWorld, Resources } from "../core/world"
import { ENEMY_DEFS } from "../content/enemies"
import { isWalkable } from "../content/map"

/**
 * 적 행동 텔레그래프 — "곧 여기가 위험하다" 를 화면에 그린다.
 *
 * **왜 이벤트가 아니라 상태를 보는가.** 불꽃이나 소리는 순간이라 이벤트가 맞다. 그러나
 * 위험 구역은 windup 내내 살아 있어야 하는 **지속 표시**다. 그리고 `ai.ts` 는 경직·기절로
 * 돌진이 끊길 때 `enemyAction` 컴포넌트를 조용히 떼기만 하고 **취소 이벤트를 내지 않는다.**
 * 이벤트만 보고 그리면 끊긴 예고가 바닥에 영원히 남는다. 그래서 매 스텝
 * `enemyAction` 을 직접 읽고, 사라진 id 를 취소로 판정한다.
 *
 * **왜 시뮬레이션 값을 그대로 쓰는가.** 레인의 원점·방향·폭·길이는 `combat.ts` 의
 * 접촉 판정이 쓰는 것과 같은 `origin`·`dir`·`halfWidth` 다. 표현이 자기 숫자를 따로 가지면
 * "피했는데 맞았다" 가 생긴다. 눈에 보이는 띠가 곧 판정 범위다.
 *
 * **왜 바닥 판 하나로 끝내지 않는가.** 카메라 각도가 고정이 아니다(탑뷰·저각·정면).
 * 바닥에 눕힌 판은 각도가 낮아질수록 납작해져 사라진다. 그래서 레인을 **바닥 + 양쪽
 * 낮은 벽** 한 덩어리로 만든다. 위에서는 띠로, 옆에서는 두 줄기 빛으로 읽힌다.
 */

/** 레인 옆벽 높이. 저각에서 보이되 시야를 가리지 않는 선. */
const WALL_H = 0.34
/** 동시에 예고할 수 있는 적 수. 초과분은 그리지 않는다(소리·판정은 그대로다). */
const MAX_LANES = 6
/** 돌진 중 남기는 잔상 수. */
const MAX_WAKE = 16
/** 잔상을 떨어뜨리는 간격(초). */
const WAKE_INTERVAL = 0.045
/** 잔상 한 장의 수명(초). */
const WAKE_LIFE = 0.34
/** 발동·취소 후 사라지는 데 걸리는 시간(초). */
const FIRE_FADE = 0.22
const CANCEL_FADE = 0.16

/** 위험 구역 전체 범위(항상 보인다) */
const COLOR_EXTENT = 0xff6a2c
/** 남은 시간을 채우는 부분 */
const COLOR_FILL = 0xffae52
/** 발동 순간 */
const COLOR_FIRE = 0xfff2dc
/** 끊었을 때 — 따뜻한 위협색과 반대편 색이라 "막았다" 가 한눈에 읽힌다 */
const COLOR_CANCEL = 0x7cc0ff

type LanePhase = "windup" | "active" | "fired" | "cancelled"

interface Lane {
  id: number
  used: boolean
  phase: LanePhase
  /** fired·cancelled 로 넘어간 시각. 소멸 애니메이션의 기준. */
  endedAt: number
  extent: THREE.Mesh
  fill: THREE.Mesh
  head: THREE.Mesh
  extentMat: THREE.MeshBasicMaterial
  fillMat: THREE.MeshBasicMaterial
  headMat: THREE.MeshBasicMaterial
  length: number
  /** 잔상을 마지막으로 떨어뜨린 시각 */
  lastWakeAt: number
}

interface Wake {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  active: boolean
  start: number
}

let root: THREE.Group | null = null
let lanes: Lane[] = []
let wakes: Wake[] = []
let wakeCursor = 0

/**
 * 움직임 줄이기 설정. 맥동과 잔상은 정보가 아니라 강조라서, 꺼도 위험 구역은 그대로 읽힌다.
 * 반대로 범위와 채움은 절대 끄지 않는다 — 그건 게임 규칙이다.
 */
let reducedMotion = false
function detectReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

/**
 * 단위 레인: 바닥 판(z 0~1, x -0.5~0.5)과 양쪽 낮은 벽.
 * 스케일은 x=폭, z=길이, y=1 로 준다. 벽 높이는 지오메트리에 구워 두었으므로
 * 레인이 길어져도 벽이 같이 늘어나지 않는다.
 */
function makeLaneGeometry(): THREE.BufferGeometry {
  const floor = new THREE.PlaneGeometry(1, 1)
  floor.rotateX(-Math.PI / 2)
  floor.translate(0, 0.015, 0.5)

  const left = new THREE.PlaneGeometry(1, WALL_H)
  left.rotateY(Math.PI / 2)
  left.translate(-0.5, WALL_H / 2, 0.5)

  const right = new THREE.PlaneGeometry(1, WALL_H)
  right.rotateY(-Math.PI / 2)
  right.translate(0.5, WALL_H / 2, 0.5)

  // 세 판의 정점을 하나로 합친다 — 레인 하나가 드로우콜 하나다.
  return mergeGeometries([floor, left, right])
}

/** three 의 BufferGeometryUtils 를 끌어오지 않기 위한 최소 병합. 모두 비인덱스 삼각형으로 편다. */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  for (const part of parts) {
    const g = part.index ? part.toNonIndexed() : part
    const arr = g.getAttribute("position").array
    for (let i = 0; i < arr.length; i++) positions.push(arr[i] as number)
    g.dispose()
    if (g !== part) part.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  return out
}

/** 화살촉. 원뿔이라 어느 각도에서 봐도 방향이 읽힌다. */
function makeHeadGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.26, 0.62, 12)
  g.rotateX(Math.PI / 2) // +Y 를 +Z 로 눕힌다
  g.translate(0, 0.14, 0)
  return g
}

function makeWakeGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1)
  g.rotateX(-Math.PI / 2)
  return g
}

function unlit(color: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  // 텔레그래프에 외곽선이 그려지면 위험 구역이 아니라 물체로 보인다.
  ;(m as unknown as { outlineParameters?: { visible: boolean } }).outlineParameters = { visible: false }
  return m
}

function ensurePools(res: Resources): void {
  if (root) return
  reducedMotion = detectReducedMotion()
  root = new THREE.Group()
  root.name = "telegraph"
  // 이펙트 풀과 같은 이유로 씬에 직접 붙인다 — 존이 바뀌어도 살아 있어야 한다.
  res.scene.add(root)

  const laneGeo = makeLaneGeometry()
  const headGeo = makeHeadGeometry()
  const wakeGeo = makeWakeGeometry()

  for (let i = 0; i < MAX_LANES; i++) {
    const extentMat = unlit(COLOR_EXTENT)
    const fillMat = unlit(COLOR_FILL)
    const headMat = unlit(COLOR_FILL)
    const extent = new THREE.Mesh(laneGeo, extentMat)
    const fill = new THREE.Mesh(laneGeo, fillMat)
    const head = new THREE.Mesh(headGeo, headMat)
    extent.frustumCulled = false
    fill.frustumCulled = false
    head.frustumCulled = false
    extent.visible = fill.visible = head.visible = false
    // 채움이 범위 위에 겹쳐 그려지도록 순서를 고정한다.
    extent.renderOrder = 2
    fill.renderOrder = 3
    head.renderOrder = 4
    root.add(extent, fill, head)
    lanes.push({
      id: -1, used: false, phase: "windup", endedAt: 0,
      extent, fill, head, extentMat, fillMat, headMat, length: 0, lastWakeAt: 0,
    })
  }

  for (let i = 0; i < MAX_WAKE; i++) {
    const mat = unlit(COLOR_FILL)
    const mesh = new THREE.Mesh(wakeGeo, mat)
    mesh.frustumCulled = false
    mesh.visible = false
    mesh.renderOrder = 1
    root.add(mesh)
    wakes.push({ mesh, mat, active: false, start: 0 })
  }
}

/**
 * 벽에 막히는 지점까지만 레인을 그린다. 돌진은 `moveWithWalls` 로 멈추므로,
 * 벽 너머까지 위험을 표시하면 플레이어가 있지도 않은 위협을 피해 움직인다.
 */
function clipToWalls(res: Resources, ox: number, oz: number, dx: number, dz: number, max: number): number {
  const step = 0.3
  for (let d = step; d <= max; d += step) {
    if (!isWalkable(res.map, ox + dx * d, oz + dz * d)) return Math.max(0.6, d - step)
  }
  return max
}

function freeLane(l: Lane): void {
  l.used = false
  l.id = -1
  l.extent.visible = false
  l.fill.visible = false
  l.head.visible = false
}

function placeLane(l: Lane, ox: number, oz: number, yaw: number, width: number, length: number): void {
  l.length = length
  l.extent.position.set(ox, 0, oz)
  l.extent.rotation.y = yaw
  l.extent.scale.set(width, 1, length)
  l.fill.position.set(ox, 0, oz)
  l.fill.rotation.y = yaw
  l.head.rotation.y = yaw
}

function dropWake(res: Resources, x: number, z: number, yaw: number, width: number): void {
  const w = wakes[wakeCursor % wakes.length]!
  wakeCursor++
  w.active = true
  w.start = res.time.now
  w.mesh.visible = true
  w.mesh.position.set(x, 0.02, z)
  w.mesh.rotation.y = yaw
  w.mesh.scale.set(width, 1, width * 1.6)
  w.mat.opacity = 0.5
}

/**
 * 매 스텝 `enemyAction` 을 읽어 레인을 맞춘다. 사라진 id 는 취소로 처리한다.
 */
export function updateTelegraphs(world: GameWorld, res: Resources): void {
  if (!res.scene) return
  ensurePools(res)
  const now = res.time.now

  const alive = new Set<number>()

  for (const e of world.with("enemy", "enemyAction", "transform")) {
    if (e.dead) continue
    const action = e.enemyAction
    if (action.actionId !== "charge") continue
    const def = ENEMY_DEFS[e.enemy.kind]
    const charge = def.charge
    if (!charge) continue
    if (action.phase === "recovery") continue // 회복 단계엔 위험 구역이 없다

    alive.add(action.instanceId)
    let lane = lanes.find((l) => l.used && l.id === action.instanceId)
    if (!lane) {
      lane = lanes.find((l) => !l.used)
      if (!lane) continue // 자리가 없으면 그리지 않는다. 판정은 영향받지 않는다
      lane.used = true
      lane.id = action.instanceId
      lane.lastWakeAt = 0
      const reach = charge.speed * charge.active
      const length = clipToWalls(res, action.origin.x, action.origin.z, action.dir.x, action.dir.z, reach)
      const yaw = Math.atan2(action.dir.x, action.dir.z)
      placeLane(lane, action.origin.x, action.origin.z, yaw, charge.halfWidth * 2, length)
      lane.extent.visible = true
      lane.fill.visible = true
      lane.head.visible = true
    }
    lane.phase = action.phase

    const span = Math.max(1e-4, action.phaseUntil - action.phaseStartedAt)
    const t = Math.min(1, Math.max(0, (now - action.phaseStartedAt) / span))

    if (action.phase === "windup") {
      // 범위는 처음부터 전부 보인다(어디가 위험한가). 채움이 시간을 알려 준다(언제).
      const pulse = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(now * 26)
      lane.extentMat.color.setHex(COLOR_EXTENT)
      lane.extentMat.opacity = (0.16 + 0.12 * t) * pulse
      lane.fillMat.color.setHex(COLOR_FILL)
      lane.fillMat.opacity = 0.3 + 0.25 * t
      lane.fill.scale.set(lane.extent.scale.x, 1, Math.max(0.001, lane.length * t))
      // 화살촉은 채움의 앞머리를 타고 달린다. 끝에 닿는 순간이 발동이다.
      const d = lane.length * t
      lane.head.position.set(
        lane.extent.position.x + action.dir.x * d,
        0.16,
        lane.extent.position.z + action.dir.z * d,
      )
      lane.headMat.color.setHex(COLOR_FILL)
      lane.headMat.opacity = 0.55 + 0.35 * t
      lane.head.visible = true
    } else {
      // active — 흰 섬광으로 한 번 치고 빠르게 사라진다. 이제 피하는 게 아니라 맞는 시간이다.
      lane.extentMat.color.setHex(COLOR_FIRE)
      lane.extentMat.opacity = 0.34 * (1 - t)
      lane.fillMat.color.setHex(COLOR_FIRE)
      lane.fillMat.opacity = 0.42 * (1 - t)
      lane.fill.scale.set(lane.extent.scale.x, 1, lane.length)
      lane.head.visible = false
      if (!reducedMotion && now - lane.lastWakeAt >= WAKE_INTERVAL) {
        lane.lastWakeAt = now
        const p = e.transform.position
        dropWake(res, p.x, p.z, e.transform.yaw, charge.halfWidth * 2)
      }
    }
  }

  // 사라진 레인 정리. active 까지 갔던 것은 "발동", windup 에서 끊긴 것은 "취소" 다.
  for (const lane of lanes) {
    if (!lane.used) continue
    if (alive.has(lane.id)) continue
    if (lane.phase === "windup" || lane.phase === "active") {
      lane.endedAt = now
      lane.phase = lane.phase === "windup" ? "cancelled" : "fired"
      if (lane.phase === "cancelled") {
        lane.extentMat.color.setHex(COLOR_CANCEL)
        lane.fillMat.color.setHex(COLOR_CANCEL)
        lane.headMat.color.setHex(COLOR_CANCEL)
      }
    }
    const fade = lane.phase === "cancelled" ? CANCEL_FADE : FIRE_FADE
    const k = Math.min(1, Math.max(0, (now - lane.endedAt) / fade))
    if (k >= 1) { freeLane(lane); continue }
    const falloff = 1 - k
    lane.extentMat.opacity = (lane.phase === "cancelled" ? 0.3 : 0.28) * falloff
    lane.fillMat.opacity = (lane.phase === "cancelled" ? 0.34 : 0.3) * falloff
    lane.headMat.opacity = 0.4 * falloff
    if (lane.phase === "cancelled") {
      // 끊긴 예고는 오므라들며 사라진다 — 뻗어 나가던 것과 반대 방향이라 무산이 읽힌다.
      lane.fill.scale.set(lane.extent.scale.x, 1, Math.max(0.001, lane.length * falloff))
      lane.head.visible = false
    }
  }

  for (const w of wakes) {
    if (!w.active) continue
    const k = (now - w.start) / WAKE_LIFE
    if (k >= 1) { w.active = false; w.mesh.visible = false; continue }
    // 폭·길이는 떨어뜨린 그대로 둔다. 잔상이 커지면 지나간 자리가 아니라
    // 새 위험 구역으로 오인된다. 옅어지면서 살짝 떠오르기만 한다.
    w.mat.opacity = 0.5 * (1 - k) * (1 - k)
    w.mesh.position.y = 0.02 + k * 0.14
  }
}

/** 존 전환·정리용. 남아 있는 예고를 전부 지운다. */
export function clearTelegraphs(): void {
  for (const l of lanes) freeLane(l)
  for (const w of wakes) { w.active = false; w.mesh.visible = false }
}

/** 테스트 전용 — 풀 상태를 되돌린다. */
export function _resetTelegraphsForTest(): void {
  root = null
  lanes = []
  wakes = []
  wakeCursor = 0
}

/** 테스트·검증용 관측 창구. 지금 몇 개의 예고가 살아 있는가. */
export function activeTelegraphCount(): number {
  return lanes.filter((l) => l.used).length
}
