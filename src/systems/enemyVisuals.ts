import * as THREE from "three"
import { ELITE_MODIFIER, ENEMY_LOOKS } from "../content/enemyLooks"
import type { EnemyKind } from "../core/world"

/**
 * 적 외형 덧입히기 — 같은 모델에서 다른 실루엣을 만든다.
 *
 * 우리 적 모델은 KayKit 스켈레톤 한 세트라 근접·원거리·보스가 거의 같아 보인다.
 * 모델을 더 살 수 없으니, 참고한 레퍼런스(Claude of Tanks)가 전차 112종을
 * **하나의 팩토리 + 스펙 레코드**로 만든 방식을 그대로 쓴다 —
 * 공용 모델에 **비율·색·덧붙임** 세 축만 달리 준다.
 *
 * 왜 이 세 축인가:
 *  - **비율**이 가장 강하다. 어두운 곳에서도 넓고 낮은 것과 좁고 높은 것은 구분된다.
 *  - **덧붙임**은 실루엣의 *윗부분*을 바꾼다. 탑뷰에서 제일 먼저 보이는 곳이다.
 *  - **색**은 마지막이다. 색만 다르면 조명이 바뀔 때 같아 보인다.
 *
 * ---
 * **장식은 unlit 재질(`MeshBasicMaterial`)을 쓴다 — 취향이 아니라 필수다.**
 *
 * 처음엔 장식도 툰 재질(`toonMat`)로 만들었는데 **화면 전체가 배경색만 남고 통째로
 * 사라졌다.** 콘솔 에러도, GL 에러도, 컨텍스트 손실도 없었다. 드로우콜은 150개 안팎이
 * 정상적으로 나가고(삼각형 44만) 픽셀만 하나도 안 나왔다.
 *
 * 이분 탐색으로 확인한 것:
 *   - 장식 재질을 `MeshBasicMaterial`(unlit)로 바꾸면 **정상**
 *   - 장식 재질이 `MeshToonMaterial`(lit)이면 **블랭크** — 공유하든 새로 만들든,
 *     그림자 캐스팅을 꺼도, 래퍼 스케일을 빼도, 외곽선을 꺼도 마찬가지
 *   - 같은 `toonMat` 이 던전 벽/바닥(InstancedMesh)과 마을 NPC에서는 멀쩡히 돈다
 *
 * **근본 원인은 아직 못 찾았다.** three r185 쪽 문제로 보이지만 확증이 없다.
 * 재현 조건만 여기 남긴다 — 나중에 장식을 lit 으로 되돌리려면 이 증상부터 확인할 것.
 *
 * 다행히 unlit 은 이 용도에 오히려 맞다. 장식은 실루엣을 읽히게 하는 표식이라
 * 그늘에 들어가도 형태가 죽으면 안 된다. 레퍼런스(Claude of Tanks)도 가독성 요소는
 * unlit 으로 둔다.
 * ---
 *
 * 지오메트리·머티리얼은 모듈에서 한 번만 만들어 공유한다. 적이 죽고 태어날 때마다
 * 새로 만들면 존을 오갈 때 리소스가 쌓인다 (실제로 텍스처 누수를 실측한 적이 있다).
 */

let decorGeo: {
  pauldron: THREE.BufferGeometry
  quiverBody: THREE.BufferGeometry
  arrow: THREE.BufferGeometry
  horn: THREE.BufferGeometry
  crownBand: THREE.BufferGeometry
  crownSpike: THREE.BufferGeometry
  ring: THREE.BufferGeometry
} | null = null

function geo() {
  decorGeo ??= {
    // 견갑 — 어깨에서 바깥으로 벌어진 각진 판. 위쪽 실루엣을 넓힌다.
    pauldron: new THREE.BoxGeometry(0.34, 0.16, 0.3),
    quiverBody: new THREE.CylinderGeometry(0.09, 0.11, 0.42, 8),
    arrow: new THREE.CylinderGeometry(0.015, 0.015, 0.3, 4),
    horn: new THREE.ConeGeometry(0.075, 0.34, 6),
    crownBand: new THREE.TorusGeometry(0.26, 0.045, 6, 14),
    crownSpike: new THREE.ConeGeometry(0.07, 0.24, 5),
    ring: new THREE.RingGeometry(0.72, 0.95, 28),
  }
  return decorGeo
}

const matCache = new Map<number, THREE.Material>()
function decorMat(color: number): THREE.Material {
  let m = matCache.get(color)
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); matCache.set(color, m) }
  return m
}

let ringMat: THREE.Material | null = null

/** 장식 하나. 좌표는 래퍼 기준의 월드 단위다 — 캐릭터 키가 1.7 기준이다. */
function buildDecor(kind: EnemyKind, tint: number): THREE.Object3D {
  const g = geo()
  const group = new THREE.Group()
  const mat = decorMat(tint)
  const look = ENEMY_LOOKS[kind]

  switch (look.decor) {
    case "pauldrons": {
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(g.pauldron, mat)
        p.position.set(side * 0.33, 1.28, 0)
        p.rotation.z = side * -0.32
        group.add(p)
      }
      break
    }
    case "quiver": {
      const q = new THREE.Mesh(g.quiverBody, mat)
      q.position.set(-0.16, 1.15, -0.2)
      q.rotation.set(0.42, 0, 0.3)
      group.add(q)
      // 화살 깃 — 위로 삐죽한 선 세 개가 실루엣을 만든다
      for (let i = 0; i < 3; i++) {
        const a = new THREE.Mesh(g.arrow, mat)
        a.position.set(-0.16 + (i - 1) * 0.05, 1.44, -0.28 + i * 0.02)
        a.rotation.set(0.42, 0, 0.3)
        group.add(a)
      }
      break
    }
    case "horns": {
      for (const side of [-1, 1]) {
        const h = new THREE.Mesh(g.horn, mat)
        h.position.set(side * 0.14, 1.5, 0.08)
        // 앞으로 기울인다 — "달려든다" 가 형태로 읽혀야 한다
        h.rotation.set(0.85, 0, side * 0.34)
        group.add(h)
      }
      break
    }
    case "crown": {
      const band = new THREE.Mesh(g.crownBand, mat)
      band.position.y = 1.62
      band.rotation.x = Math.PI / 2
      group.add(band)
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        const s = new THREE.Mesh(g.crownSpike, mat)
        s.position.set(Math.cos(a) * 0.26, 1.74, Math.sin(a) * 0.26)
        group.add(s)
      }
      break
    }
  }
  // unlit 이라 그림자를 받지 않는다. 드리우는 것도 끈다 — 몸통이 이미 그림자를 만들고,
  // 몸에 붙은 작은 조각이 따로 그림자를 만들 이유가 없다.
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false }
  })
  return group
}

/**
 * 모델 래퍼에 외형을 입힌다. `createModel` 이 돌려준 그룹에 대고 한 번만 부른다.
 * glTF 가 없어 프리미티브로 폴백된 경우에도 그대로 동작한다 — 둘 다 래퍼 그룹이다.
 */
export function dressEnemy(wrapper: THREE.Object3D, kind: EnemyKind, isElite = false): void {
  const look = ENEMY_LOOKS[kind]
  if (!look) return

  const h = look.heightScale * (isElite ? ELITE_MODIFIER.heightScale : 1)
  const w = look.girth * (isElite ? ELITE_MODIFIER.girth : 1)
  // **래퍼가 아니라 안쪽 모델을 늘린다.** 래퍼에 스케일을 걸면 화면이 통째로 사라진다
  // (위 주석 참조). 안쪽 인스턴스는 이미 키 정규화 배율이 걸려 있으므로 곱해서 준다.
  // 발이 바닥에 붙어 있어야 하므로 y 오프셋도 같은 비율로 늘린다.
  wrapper.scale.set(w, h, w)

  // 색조는 머티리얼 색에 곱한다. `createModel` 이 인스턴스마다 머티리얼을 복제해 두므로
  // 여기서 직접 써도 다른 적에게 번지지 않는다.
  const tint = new THREE.Color(look.tint)
  if (isElite) tint.multiplyScalar(ELITE_MODIFIER.tintScale)
  wrapper.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const c = (m as THREE.MeshStandardMaterial).color
      if (c) c.multiply(tint)
    }
  })

  wrapper.add(buildDecor(kind, look.decorTint))

  if (isElite) {
    // 발밑 고리 하나. 정예를 알리는 유일한 추가 요소다 — 더 붙이면 종류가 바뀐 것처럼 보인다.
    ringMat ??= new THREE.MeshBasicMaterial({
      color: ELITE_MODIFIER.ringColor,
      transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    })
    ringMat.userData.outlineParameters = { visible: false }
    const ring = new THREE.Mesh(geo().ring, ringMat)
    ring.castShadow = false
    ring.receiveShadow = false
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.04
    ring.scale.setScalar(ELITE_MODIFIER.ringRadius / 0.95)
    wrapper.add(ring)
  }
}
