import * as THREE from "three"
import { TILE } from "../content/map"
import { ZONE_DEFS } from "../content/zones"
import { applyOutline, toonMat } from "./toonMaterial"

/**
 * 출구 표식.
 *
 * 지금까지 던전 출구는 **좌표로만 존재**했다. 밟으면 전환되는데 화면에는 아무 표시가 없어서,
 * 플레이어 입장에서는 "돌아가는 방법이 없는" 것과 같았다. 게다가 맵마다 규칙이 달랐다.
 *   - 왕좌의 방: 스폰 칸(14,18)이 곧 출구다. 보스와 싸우다 물러나면 실수로 마을에 튕긴다.
 *   - 지하 납골당: 스폰(15,25)과 출구(20,2)가 완전히 딴 곳이다.
 *
 * 표식은 그 둘을 다 완화한다. 나갈 곳이 보이고, 밟으면 안 되는 칸도 보인다.
 * (스폰 칸과 출구 칸이 겹치는 근본 문제 자체는 레이아웃·존 계약 쪽에서 따로 정리해야 한다)
 *
 * 문 모양 실루엣으로 만든다 — 바닥 링만으로는 전리품 표식과 헷갈린다.
 */

const FRAME = 0xd8b96a
const GLOW = 0xffe9a8

function buildGateway(): THREE.Object3D {
  const g = new THREE.Group()

  // 문설주 두 개 + 상인방. 멀리서도 "출입구" 로 읽히는 최소 형태.
  const postGeo = new THREE.BoxGeometry(0.28, 2.1, 0.28)
  for (const x of [-0.75, 0.75]) {
    const post = new THREE.Mesh(postGeo, toonMat(FRAME))
    post.position.set(x, 1.05, 0)
    g.add(post)
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.3, 0.34), toonMat(FRAME))
  lintel.position.y = 2.25
  g.add(lintel)

  // 문설주 위 등불 한 쌍 — 세계관에서 등불은 안전한 길의 표식이다
  for (const x of [-0.75, 0.75]) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 10, 8),
      toonMat(GLOW, { emissive: 0xffc861, emissiveIntensity: 1.5 }),
    )
    lamp.position.set(x, 2.52, 0)
    g.add(lamp)
  }

  applyOutline(g)

  // 위로 뻗는 빛기둥. 벽 너머에서도 위치가 읽히도록 외곽선은 빼고 가산 합성으로 둔다.
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.8, 5, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: GLOW, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    }),
  )
  beam.position.y = 2.5
  beam.userData.outlineParameters = { visible: false }

  // 밟는 칸을 명확히 하는 바닥 원반
  const ringGeo = new THREE.RingGeometry(0.55, 0.95, 28)
  ringGeo.rotateX(-Math.PI / 2)
  const ring = new THREE.Mesh(
    ringGeo,
    new THREE.MeshBasicMaterial({
      color: GLOW, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  )
  ring.position.y = 0.04
  ring.userData.outlineParameters = { visible: false }

  g.add(beam, ring)
  return g
}

/**
 * 이 맵에 속한 존의 물리 출구마다 표식을 세운다.
 *
 * `interactionOnly` 출구(마을의 문지기 경유)는 밟는 칸이 없으므로 표식을 만들지 않는다.
 * 표식은 맵 루트에 붙어 존을 떠날 때 맵 메시와 함께 정리된다.
 *
 * 반환값은 세운 표식 수.
 */
export function dressZoneExits(parent: THREE.Object3D, mapId: string): number {
  const group = new THREE.Group()
  group.name = "zone-exits"
  const seen = new Set<string>()
  let count = 0

  for (const zone of Object.values(ZONE_DEFS)) {
    if (zone.mapId !== mapId) continue
    for (const exit of zone.exits) {
      if (exit.interactionOnly || !exit.fromCell) continue
      const key = `${exit.fromCell.col},${exit.fromCell.row}`
      if (seen.has(key)) continue // 같은 칸에 두 출구가 걸려도 표식은 하나만
      seen.add(key)
      const gate = buildGateway()
      gate.position.set(exit.fromCell.col * TILE, 0, exit.fromCell.row * TILE)
      group.add(gate)
      count++
    }
  }

  if (count > 0) parent.add(group)
  return count
}
