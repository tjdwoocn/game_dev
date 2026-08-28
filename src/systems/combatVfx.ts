import * as THREE from "three"
import type { Resources, SkillId } from "../core/world"
import type { CombatEvent, CombatEventKind } from "./combatEvents"
import { texSize } from "./quality"

/**
 * 전투 이펙트 — 검격 궤적, 충격 불꽃, 사망·브레이크 파문.
 *
 * **왜 풀링하는가.** 존을 오갈 때 텍스처가 무한히 쌓이는 누수를 실측한 적이 있다
 * (한 바퀴당 +35~48). 이펙트는 초당 수십 개가 태어나고 죽는 물건이라, 매번 지오메트리와
 * 머티리얼을 만들면 같은 함정에 그대로 빠진다. 그래서 **처음에 정해진 수만큼 만들어 두고
 * 재사용한다.** 워밍업 이후 할당이 0이다.
 *
 * **왜 unlit 인가.** 이펙트는 조명을 받으면 안 된다 — 어두운 존에서 타격 불꽃이 어두워지면
 * 그건 신호로서 실패다. `MeshBasicMaterial` + 가산 합성으로 항상 같은 밝기를 유지하고,
 * 외곽선도 끈다(`outlineParameters.visible = false`).
 *
 * **시간은 `res.time.now`(게임 시간)를 쓴다.** 히트스톱이 걸리면 이펙트도 같이 멈춰
 * 정지 프레임을 유지한다 — 그게 타격의 무게를 만든다.
 */

type SlotKind = "slash" | "spark" | "ring" | "sweep"

interface Slot {
  obj: THREE.Object3D
  mat: THREE.MeshBasicMaterial | THREE.PointsMaterial
  kind: SlotKind
  active: boolean
  start: number
  life: number
  /** 시작·끝 스케일 */
  from: number
  to: number
  peak: number
  /** spark 전용 */
  vel?: Float32Array
  origin?: THREE.Vector3
  /** sweep 전용 — 시작 각과 초당 회전(라디안) */
  spinFrom?: number
  spin?: number
}

// 회전베기 한 번에 sweep 3장을 쓴다. 연속 시전을 감안해 9장.
const POOL_SIZE: Record<SlotKind, number> = { slash: 6, spark: 14, ring: 10, sweep: 9 }
const SPARK_POINTS = 10

let root: THREE.Group | null = null
const pools: Record<SlotKind, Slot[]> = { slash: [], spark: [], ring: [], sweep: [] }

/**
 * 입자 텍스처. `PointsMaterial` 은 기본값이 **네모난 점**이라 불꽃이 각진 블록으로 보인다.
 * 실제로 처음 붙였을 때 화면에 흰 네모가 흩날렸다. 가운데가 밝고 가장자리로 사라지는
 * 원형 그라디언트를 캔버스로 한 장 구워 공유한다 — 파일은 여전히 0개다.
 */
let sparkTex: THREE.Texture | null = null
function getSparkTexture(): THREE.Texture | null {
  if (sparkTex) return sparkTex
  // 저사양 티어에서는 절반 크기로 굽는다. 가운데가 밝은 원형 그라디언트라
  // 해상도가 낮아도 형태가 무너지지 않는다.
  const size = texSize(64)
  const cv = document.createElement("canvas")
  cv.width = cv.height = size
  const g = cv.getContext("2d")
  if (!g) return null
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, "rgba(255,255,255,1)")
  grad.addColorStop(0.35, "rgba(255,255,255,0.75)")
  grad.addColorStop(1, "rgba(255,255,255,0)")
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  sparkTex = new THREE.CanvasTexture(cv)
  sparkTex.needsUpdate = true
  return sparkTex
}

/** 검격 궤적: 앞쪽을 훑는 부채꼴. 바닥에 눕혀 탑뷰에서 읽히게 한다. */
function makeSlashGeometry(): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(0.9, 1.75, 20, 1, -Math.PI * 0.42, Math.PI * 0.84)
  g.rotateX(-Math.PI / 2)
  return g
}

/** 파문: 바닥에 퍼지는 얇은 고리. */
function makeRingGeometry(): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(0.72, 1, 28)
  g.rotateX(-Math.PI / 2)
  return g
}

/**
 * 회전 칼날 궤적: 얇고 긴 호. 회전베기는 "주변을 휩쓴다" 는 동작이라
 * 정지한 고리 한 장으로는 회전이 읽히지 않는다. 이 호를 각도를 어긋나게 여러 장 겹쳐
 * 서로 다른 속도로 돌리면 도는 방향과 속도가 눈에 들어온다.
 */
function makeSweepGeometry(): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(0.62, 1, 24, 1, 0, Math.PI * 0.7)
  g.rotateX(-Math.PI / 2)
  return g
}

function hide(s: Slot): void {
  s.active = false
  s.obj.visible = false
}

function ensurePools(res: Resources): void {
  if (root) return
  root = new THREE.Group()
  root.name = "combat-vfx"
  // 이펙트는 맵 루트가 아니라 씬에 직접 붙인다 — 존이 바뀌어도 풀이 살아 있어야 한다.
  res.scene.add(root)

  const slashGeo = makeSlashGeometry()
  const ringGeo = makeRingGeometry()

  const mkBasic = (color: number) => {
    const m = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    })
    m.userData.outlineParameters = { visible: false }
    return m
  }

  for (let i = 0; i < POOL_SIZE.slash; i++) {
    const mat = mkBasic(0xffffff)
    const mesh = new THREE.Mesh(slashGeo, mat)
    mesh.visible = false
    mesh.renderOrder = 3
    root.add(mesh)
    pools.slash.push({ obj: mesh, mat, kind: "slash", active: false, start: 0, life: 0.18, from: 0.85, to: 1.3, peak: 0.9 })
  }

  for (let i = 0; i < POOL_SIZE.ring; i++) {
    const mat = mkBasic(0xffffff)
    const mesh = new THREE.Mesh(ringGeo, mat)
    mesh.visible = false
    mesh.renderOrder = 3
    root.add(mesh)
    pools.ring.push({ obj: mesh, mat, kind: "ring", active: false, start: 0, life: 0.45, from: 0.2, to: 2.4, peak: 0.75 })
  }

  const sweepGeo = makeSweepGeometry()
  for (let i = 0; i < POOL_SIZE.sweep; i++) {
    const mat = mkBasic(0xffffff)
    const mesh = new THREE.Mesh(sweepGeo, mat)
    mesh.visible = false
    mesh.renderOrder = 3
    root.add(mesh)
    pools.sweep.push({ obj: mesh, mat, kind: "sweep", active: false, start: 0, life: 0.34, from: 1, to: 1, peak: 0.9, spinFrom: 0, spin: 0 })
  }

  for (let i = 0; i < POOL_SIZE.spark; i++) {
    const geo = new THREE.BufferGeometry()
    // 점마다 위치를 매 프레임 갱신하므로 지오메트리는 슬롯 전용이다(공유 불가).
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPARK_POINTS * 3), 3))
    const tex = getSparkTexture()
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.3, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      ...(tex ? { map: tex, alphaMap: tex } : {}),
    })
    mat.userData.outlineParameters = { visible: false }
    const pts = new THREE.Points(geo, mat)
    pts.visible = false
    pts.renderOrder = 4
    pts.frustumCulled = false // 점 구름은 바운딩이 매 프레임 바뀐다
    root.add(pts)
    pools.spark.push({
      obj: pts, mat, kind: "spark", active: false, start: 0, life: 0.32,
      from: 1, to: 1, peak: 1, vel: new Float32Array(SPARK_POINTS * 3), origin: new THREE.Vector3(),
    })
  }
}

/** 가장 오래된 슬롯을 재사용한다. 풀이 꽉 차면 새 이펙트가 조용히 사라지는 게 아니라 밀어낸다. */
function take(kind: SlotKind, now: number): Slot {
  const pool = pools[kind]
  let oldest = pool[0]!
  for (const s of pool) {
    if (!s.active) return s
    if (s.start < oldest.start) oldest = s
  }
  void now
  return oldest
}

interface Spec {
  color: number
  life: number
  scale: number
  peak: number
  size?: number
  spread?: number
}

/** 이벤트별 연출. 값은 귀·눈으로 맞춘 것이라 의도를 주석에 남긴다. */
export const SLASH: Partial<Record<CombatEventKind, Spec>> = {
  swing: { color: 0xfff2cc, life: 0.16, scale: 1.25, peak: 0.55 },
  dash: { color: 0xbfe4ff, life: 0.22, scale: 1.7, peak: 0.5 },
}

export const SPARK: Partial<Record<CombatEventKind, Spec>> = {
  // 일반 타격 — 짧고 따뜻하게. 자주 나므로 과하면 화면이 지저분해진다
  hit: { color: 0xffc06a, life: 0.26, scale: 1, peak: 1, size: 0.26, spread: 3.4 },
  // 집중 공격(브레이크 중) — 더 크고 밝게. "세게 들어갔다" 를 눈으로도 구분시킨다
  hitHeavy: { color: 0xffe89a, life: 0.36, scale: 1, peak: 1, size: 0.42, spread: 5.2 },
  playerHurt: { color: 0xff6a5a, life: 0.3, scale: 1, peak: 1, size: 0.32, spread: 3.8 },
  enemyDeath: { color: 0xe8d8b8, life: 0.5, scale: 1, peak: 1, size: 0.34, spread: 4.2 },
  breakSuccess: { color: 0x9fe8ff, life: 0.6, scale: 1, peak: 1, size: 0.5, spread: 7 },
  whirlwind: { color: 0xffe0a0, life: 0.4, scale: 1, peak: 1, size: 0.3, spread: 6.2 },
  // 치명타 — 가장 크고 가장 희게. 일반 타격(0.26)·집중(0.42)과 **입자 크기부터** 벌려 둔다.
  // 난전에서는 색 차이보다 크기 차이가 먼저 읽힌다.
  crit: { color: 0xfff4d8, life: 0.44, scale: 1, peak: 1, size: 0.58, spread: 7.6 },
  // 소품 파괴 — 불꽃이 아니라 **파편**이라 차갑고 탁한 색이다.
  // 전투 타격과 같은 색이면 "적을 때렸다" 로 오인된다.
  propBreak: { color: 0xbba98a, life: 0.5, scale: 1, peak: 0.95, size: 0.4, spread: 4.6 },
  // 돌진 발동 — 흙먼지를 걷어차는 순간. 불꽃색이 아니라 흙색이라 타격과 헷갈리지 않는다.
  enemyRelease: { color: 0xc9b38f, life: 0.34, scale: 1, peak: 0.85, size: 0.34, spread: 5.4 },
}

/**
 * **돌진 충돌은 평타 피격보다 세게 보여야 한다.** 같은 `playerHurt` 여도 몸으로 받은
 * 돌진은 예고를 못 읽었다는 뜻이라, 화면이 그 차이를 말해 줘야 다음에 읽게 된다.
 * `sourceActionId` 로 갈라 불꽃을 덧씌운다.
 */
export const CHARGE_IMPACT: Spec = {
  color: 0xff8a62, life: 0.42, scale: 1, peak: 1, size: 0.52, spread: 6.8,
}

export const RING: Partial<Record<CombatEventKind, Spec>> = {
  enemyDeath: { color: 0xd8c4a0, life: 0.45, scale: 2.1, peak: 0.6 },
  // 브레이크 성공은 이 게임에서 가장 큰 순간이라 가장 크게 남긴다
  breakSuccess: { color: 0x7ed5ef, life: 0.75, scale: 5.5, peak: 0.95 },
  breakOpen: { color: 0xe8c85c, life: 0.5, scale: 3.2, peak: 0.5 },
  levelUp: { color: 0xe8c83a, life: 0.8, scale: 4.4, peak: 0.85 },
  lootDrop: { color: 0xd8d2c4, life: 0.35, scale: 1.4, peak: 0.45 },
  // 회전베기 — 판정 반경(SKILLS.whirlwind.radius = 3)과 눈에 보이는 크기를 맞춘다.
  // 이펙트가 판정보다 작으면 "맞았는데 안 닿아 보인다", 크면 "닿았는데 안 맞는다" 가 된다.
  whirlwind: { color: 0xffd98a, life: 0.42, scale: 3, peak: 0.8 },
  // 치명타의 얇은 흰 고리. 레퍼런스(MOON DEFENSE)에서 타격이 그 카메라 거리에서도
  // 읽히는 이유가 이 고리였다 — 대비가 극단적이라 어떤 배경 위에서도 보인다.
  // 불꽃만으로는 밝은 바닥에서 묻힌다.
  crit: { color: 0xffffff, life: 0.3, scale: 2.7, peak: 0.95 },
  // 파괴 지점에 퍼지는 먼지. 낮고 넓게 — 바닥에서 피어오르는 느낌.
  propBreak: { color: 0x9c8f78, life: 0.55, scale: 2.2, peak: 0.5 },
  // 돌진 출발 지점의 흙먼지 고리.
  enemyRelease: { color: 0xcbb392, life: 0.36, scale: 2, peak: 0.6 },
  /**
   * 돌진 후 회복 — **차가운 고리는 "네 차례" 라는 뜻이다.** 텔레그래프의 취소 색과 같다.
   * 위협(따뜻한 주황) / 충돌(흰색) / 기회(차가운 파랑) 세 색이 이 게임의 전투 색 언어다.
   */
  enemyRecovery: { color: 0x8fb9d6, life: 0.5, scale: 1.5, peak: 0.32 },
}

/**
 * 회전 칼날 — 회전베기 전용. 호 3장을 각도를 어긋나게 놓고 서로 다른 속도로 돌린다.
 * 한 장만 돌리면 그냥 도는 고리로 보이고, 속도가 같으면 겹쳐서 한 덩어리로 읽힌다.
 */
const SWEEP_BLADES = [
  { angle: 0, spin: 15, scale: 3, peak: 0.85, life: 0.34 },
  { angle: Math.PI * 0.7, spin: 12.5, scale: 2.45, peak: 0.6, life: 0.3 },
  { angle: Math.PI * 1.35, spin: 18, scale: 1.85, peak: 0.45, life: 0.26 },
]

/**
 * 시전 준비 고리 — **안으로 모인다.** 타격 고리가 밖으로 퍼지는 것과 방향이 반대라
 * "터졌다" 가 아니라 "곧 나간다" 로 읽힌다. 예고가 타격처럼 보이면 회피 판단이 늦는다.
 *
 * `life` 는 각 스킬의 실제 windup 시간(S2 계약)과 맞춘다. 연출이 준비동작보다 길면
 * 이미 나간 스킬에 예고가 남고, 짧으면 예고 없는 구간이 생긴다.
 */
export const WINDUP: Partial<Record<SkillId, { color: number; from: number; life: number; peak: number }>> = {
  whirlwind: { color: 0xffd98a, from: 2.8, life: 0.14, peak: 0.8 },
  dash: { color: 0xbfe4ff, from: 1.9, life: 0.09, peak: 0.65 },
  guard: { color: 0x9fd8ff, from: 2.1, life: 0.12, peak: 0.7 },
  execution: { color: 0xff9a7a, from: 3.0, life: 0.28, peak: 0.9 },
}

/**
 * 시전 발동 고리 — windup 과 **같은 색, 반대 방향**이다.
 * 모였다가(windup) 터진다(release). 같은 색으로 묶어야 `castId` 로 이어진 한 동작으로 읽힌다.
 * 회전베기·돌진은 이미 전용 연출이 있으므로 여기서는 방어·처형만 받는다.
 */
export const RELEASE: Partial<Record<SkillId, { color: number; scale: number; life: number; peak: number }>> = {
  guard: { color: 0x9fd8ff, scale: 2.3, life: 0.34, peak: 0.75 },
  execution: { color: 0xff9a7a, scale: 3.4, life: 0.4, peak: 0.95 },
}

export function spawnCombatVfx(res: Resources, evt: CombatEvent): void {
  ensurePools(res)
  if (!evt.at) return
  const now = res.time.now

  const slash = SLASH[evt.kind]
  if (slash) {
    const s = take("slash", now)
    s.active = true; s.start = now; s.life = slash.life
    s.from = 0.85; s.to = slash.scale; s.peak = slash.peak * evt.power
    s.mat.color.setHex(slash.color)
    s.obj.position.set(evt.at.x, 0.9, evt.at.z)
    s.obj.rotation.y = evt.yaw ?? 0
    s.obj.visible = true
  }

  const ring = RING[evt.kind]
  if (ring) {
    const s = take("ring", now)
    s.active = true; s.start = now; s.life = ring.life
    s.from = 0.25; s.to = ring.scale; s.peak = ring.peak * evt.power
    s.mat.color.setHex(ring.color)
    s.obj.position.set(evt.at.x, 0.06, evt.at.z)
    s.obj.visible = true
  }

  if (evt.kind === "skillRelease" && evt.skillId) {
    const rl = RELEASE[evt.skillId]
    if (rl) {
      const s = take("ring", now)
      s.active = true; s.start = now; s.life = rl.life
      s.from = 0.4; s.to = rl.scale; s.peak = rl.peak * evt.power
      s.mat.color.setHex(rl.color)
      s.obj.position.set(evt.at.x, 0.09, evt.at.z)
      s.obj.visible = true
    }
  }

  if (evt.kind === "skillWindup" && evt.skillId) {
    const wu = WINDUP[evt.skillId]
    if (wu) {
      const s = take("ring", now)
      s.active = true; s.start = now; s.life = wu.life
      // from > to 라서 고리가 안으로 조여든다.
      s.from = wu.from; s.to = 0.35; s.peak = wu.peak * evt.power
      s.mat.color.setHex(wu.color)
      s.obj.position.set(evt.at.x, 0.08, evt.at.z)
      s.obj.visible = true
    }
  }

  if (evt.kind === "whirlwind") {
    for (const b of SWEEP_BLADES) {
      const s = take("sweep", now)
      s.active = true; s.start = now; s.life = b.life
      s.from = b.scale; s.to = b.scale; s.peak = b.peak * evt.power
      s.spinFrom = (evt.yaw ?? 0) + b.angle
      s.spin = b.spin
      s.mat.color.setHex(0xffd98a)
      s.obj.position.set(evt.at.x, 0.5, evt.at.z)
      s.obj.scale.setScalar(b.scale)
      s.obj.rotation.y = s.spinFrom
      s.obj.visible = true
    }
  }

  // 돌진 충돌은 같은 playerHurt 라도 더 크게 튄다.
  const spark = evt.kind === "playerHurt" && evt.sourceActionId === "charge"
    ? CHARGE_IMPACT
    : SPARK[evt.kind]
  if (spark) {
    const s = take("spark", now)
    s.active = true; s.start = now; s.life = spark.life
    s.peak = spark.peak * evt.power
    s.mat.color.setHex(spark.color)
    ;(s.mat as THREE.PointsMaterial).size = spark.size ?? 0.3
    s.origin!.set(evt.at.x, 1.05, evt.at.z)
    const vel = s.vel!
    const spread = spark.spread ?? 3.5
    for (let i = 0; i < SPARK_POINTS; i++) {
      // 반구 방향으로 흩뿌린다. 아래로 튀면 바닥에 묻혀 안 보인다.
      const a = res.rng() * Math.PI * 2
      const up = 0.35 + res.rng() * 0.75
      const r = (0.45 + res.rng() * 0.55) * spread
      vel[i * 3] = Math.cos(a) * r
      vel[i * 3 + 1] = up * spread * 0.55
      vel[i * 3 + 2] = Math.sin(a) * r
    }
    s.obj.visible = true
  }
}

/** 살아 있는 이펙트를 진행시킨다. 수명이 다하면 감춰서 풀로 돌려보낸다. */
export function updateCombatVfx(res: Resources): void {
  if (!root) return
  const now = res.time.now

  for (const kind of ["slash", "ring", "spark", "sweep"] as const) {
    for (const s of pools[kind]) {
      if (!s.active) continue
      const t = (now - s.start) / s.life
      if (t >= 1 || t < 0) { hide(s); continue }

      // **첫 프레임부터 최대 밝기로 나타나** 잠시 머물렀다가 사라진다.
      //
      // 처음엔 15% 구간을 페이드인으로 뒀는데, 녹화 스트립을 프레임 단위로 뜯어 보니
      // 정작 타격 프레임의 불투명도가 0이라 화면에 아무것도 없었다. 이펙트가 +2프레임에야
      // 보이기 시작했다. 히트스톱까지 겹치면 게임 시간이 7ms 밖에 안 흘러(실시간 34ms)
      // 페이드인이 더 늘어난다 — **멈춰 세운 그 프레임이 가장 밝아야 하는데 정반대였다.**
      const HOLD = 0.12
      const u = t < HOLD ? 0 : (t - HOLD) / (1 - HOLD)
      const fade = (1 - u) * (1 - u * 0.6) // 잠깐 유지하다 뒤로 갈수록 빠르게 옅어진다
      s.mat.opacity = Math.max(0, s.peak * fade)

      if (kind === "spark") {
        const geo = (s.obj as THREE.Points).geometry
        const arr = geo.getAttribute("position") as THREE.BufferAttribute
        const p = arr.array as Float32Array
        const vel = s.vel!
        const o = s.origin!
        const age = t * s.life
        for (let i = 0; i < SPARK_POINTS; i++) {
          p[i * 3] = o.x + vel[i * 3]! * age
          p[i * 3 + 1] = o.y + vel[i * 3 + 1]! * age - 4.2 * age * age // 중력
          p[i * 3 + 2] = o.z + vel[i * 3 + 2]! * age
        }
        arr.needsUpdate = true
      } else if (kind === "sweep") {
        // 시작이 가장 빠르고 끝으로 갈수록 느려진다 — 휘두르고 멎는 느낌이 난다
        const eased = 1 - (1 - t) * (1 - t)
        s.obj.rotation.y = s.spinFrom! + s.spin! * eased * s.life
        s.obj.scale.setScalar(s.from * (0.82 + 0.18 * eased))
      } else {
        const scale = s.from + (s.to - s.from) * (1 - (1 - t) * (1 - t)) // ease-out
        s.obj.scale.setScalar(scale)
      }
    }
  }
}

/** 존을 옮길 때 남아 있던 이펙트를 정리한다. 새 맵에 이전 맵의 불꽃이 떠 있으면 안 된다. */
export function clearCombatVfx(): void {
  for (const kind of ["slash", "ring", "spark", "sweep"] as const) {
    for (const s of pools[kind]) hide(s)
  }
}
