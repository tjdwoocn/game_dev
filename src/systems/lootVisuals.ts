import * as THREE from "three"
import type { ItemInstance, Rarity, Slot } from "../core/world"

/**
 * 전리품 외형 — "아이템이 전부 똑같이 생겼다" 를 고친다.
 *
 * 지금까지 모든 전리품은 **같은 팔면체 보석**이었고 등급 색만 달랐다.
 * 바닥에 뭐가 떨어졌는지 주우러 가기 전에는 알 수 없었다.
 *
 * 축을 둘로 나눈다 — 적 실루엣과 같은 원칙이다:
 *   - **형태 = 부위**. 검·갑옷·반지는 멀리서도 실루엣으로 구분된다.
 *   - **색 = 등급**. 형태가 먼저 읽히고 색이 등급을 얹는다.
 * 색만 다르면 조명이 바뀔 때 같아 보이고, 형태만 다르면 좋은 물건인지 모른다.
 *
 * **재질은 전부 unlit(`MeshBasicMaterial`)이다.** 전리품은 바닥에 떨어진 표식이라
 * 그늘에 들어가도 밝기가 변하면 안 된다. (적 장식에서 lit 재질이 프레임을 통째로
 * 날리는 문제를 만난 적도 있다 — `enemyVisuals.ts` 주석 참조)
 *
 * 지오메트리·머티리얼은 모듈에서 한 번만 만들어 공유한다. 전리품은 계속 떨어지고
 * 사라지는 물건이라 매번 만들면 존을 오갈수록 쌓인다.
 */

const RARITY_COLOR: Record<Rarity, number> = {
  common: 0xd8d2c4,
  magic: 0x6ba0ff,
  rare: 0xffcf3a,
}

let shapes: {
  blade: THREE.BufferGeometry
  guard: THREE.BufferGeometry
  grip: THREE.BufferGeometry
  plate: THREE.BufferGeometry
  pauldron: THREE.BufferGeometry
  band: THREE.BufferGeometry
  stone: THREE.BufferGeometry
  spark: THREE.BufferGeometry
} | null = null

function geo() {
  shapes ??= {
    // 검 — 위로 선 얇고 긴 날. 세로로 긴 실루엣이 제일 멀리서 읽힌다.
    blade: new THREE.BoxGeometry(0.07, 0.62, 0.02),
    guard: new THREE.BoxGeometry(0.28, 0.05, 0.05),
    grip: new THREE.BoxGeometry(0.05, 0.18, 0.05),
    // 갑옷 — 낮고 넓은 흉갑. 검과 정반대 비율이라 헷갈리지 않는다.
    plate: new THREE.BoxGeometry(0.36, 0.3, 0.16),
    pauldron: new THREE.BoxGeometry(0.12, 0.1, 0.18),
    // 반지 — 작고 둥근 고리. 셋 중 유일하게 곡선이다.
    band: new THREE.TorusGeometry(0.16, 0.045, 8, 20),
    stone: new THREE.OctahedronGeometry(0.075),
    // 희귀 등급에만 붙는 궤도 불꽃
    spark: new THREE.OctahedronGeometry(0.045),
  }
  return shapes
}

const matCache = new Map<number, THREE.Material>()
function mat(color: number): THREE.Material {
  let m = matCache.get(color)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color })
    m.userData.outlineParameters = { visible: false }
    matCache.set(color, m)
  }
  return m
}

function buildShape(slot: Slot, color: number): THREE.Object3D {
  const g = geo()
  const group = new THREE.Group()
  const body = mat(color)
  // 손잡이·테두리는 한 단계 어둡게 — 단색 덩어리면 형태가 안 읽힌다
  const trim = mat(new THREE.Color(color).multiplyScalar(0.45).getHex())

  switch (slot) {
    case "weapon": {
      const blade = new THREE.Mesh(g.blade, body)
      blade.position.y = 0.34
      const guard = new THREE.Mesh(g.guard, trim)
      guard.position.y = 0.04
      const grip = new THREE.Mesh(g.grip, trim)
      grip.position.y = -0.08
      group.add(blade, guard, grip)
      break
    }
    case "armor": {
      const plate = new THREE.Mesh(g.plate, body)
      plate.position.y = 0.15
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(g.pauldron, trim)
        p.position.set(side * 0.22, 0.24, 0)
        p.rotation.z = side * -0.35
        group.add(p)
      }
      group.add(plate)
      break
    }
    case "ring": {
      const band = new THREE.Mesh(g.band, body)
      band.position.y = 0.18
      band.rotation.x = Math.PI * 0.42
      const stone = new THREE.Mesh(g.stone, trim)
      stone.position.y = 0.34
      group.add(band, stone)
      break
    }
  }
  return group
}

/** 희귀 등급 표식 — 주위를 도는 작은 불꽃 둘. 등급을 형태로도 알린다. */
function buildRareSparks(color: number): THREE.Object3D {
  const group = new THREE.Group()
  group.name = "rare-sparks"
  for (let i = 0; i < 2; i++) {
    const s = new THREE.Mesh(geo().spark, mat(color))
    s.position.set(Math.cos(i * Math.PI) * 0.3, 0.2, Math.sin(i * Math.PI) * 0.3)
    group.add(s)
  }
  return group
}

const dressed = new WeakSet<object>()

/**
 * 전리품 래퍼에 부위별 형태를 입힌다. 이미 입힌 것은 건너뛴다.
 *
 * `createModel` 이 만든 기본 팔면체는 감춘다 — 지우지 않고 감추는 이유는
 * 그 그룹에 빛기둥(가시성 표식)이 같이 들어 있어서다. 기둥은 그대로 쓴다.
 */
export function dressLoot(wrapper: THREE.Object3D, item: ItemInstance): void {
  if (dressed.has(wrapper as object)) return
  dressed.add(wrapper as object)

  const color = RARITY_COLOR[item.rarity]
  // 기본 보석만 감춘다. 가산 합성 기둥(빛줄기)은 남긴다.
  for (const child of wrapper.children) {
    const m = child as THREE.Mesh
    if (!m.isMesh) continue
    const material = m.material as THREE.Material | undefined
    const additive = material && (material as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending
    if (!additive) { m.visible = false; continue }
    // 빛기둥은 남기되 **가늘고 낮게** 줄인다. 원본(반지름 0.3, 높이 4)은 아이템 형태를
    // 통째로 덮어서, 검인지 반지인지 화면에서 구분이 안 됐다. 기둥은 "여기 뭔가 있다" 만
    // 알리면 되고, 무엇인지는 형태가 말해야 한다.
    ;(material as THREE.MeshBasicMaterial).color.setHex(color)
    ;(material as THREE.MeshBasicMaterial).opacity = 0.18
    m.scale.set(0.45, 0.55, 0.45)
    m.position.y = 1.1
  }

  const shape = buildShape(item.slot, color)
  // 탑뷰에서 작게 보이므로 키운다. 형태가 안 읽히면 부위를 나눈 의미가 없다.
  shape.scale.setScalar(1.55)
  shape.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false }
  })
  wrapper.add(shape)

  if (item.rarity === "rare") wrapper.add(buildRareSparks(color))
}
