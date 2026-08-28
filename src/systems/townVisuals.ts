import * as THREE from "three"
import { TILE } from "../content/map"
import { TOWN_NPCS, type NpcPlacement, type NpcRole } from "../content/maps/town"
import { applyOutline, toonMat } from "./toonMaterial"

/**
 * 마을 NPC 시각 표현.
 *
 * 그동안 `TOWN_NPCS` 는 좌표·이름·대사만 있고 화면에는 아무것도 없었다. 문지기 기능은
 * 돌아가는데 서 있는 사람이 안 보이니, 플레이어는 어디에 말을 걸어야 하는지 알 수 없었다.
 * (마을 엔티티 실측 2개 = 플레이어 + 동료. NPC 는 0개였다)
 *
 * **역할을 색으로만 구분하지 않는다.** 색각 이상이나 저대비 화면에서 색은 가장 먼저
 * 무너지는 단서다. 그래서 세 축을 겹친다.
 *   1. 소품 실루엣 — 등짐·모루·창 처럼 멀리서도 형태로 읽힌다
 *   2. 머리 위 표식 — 형태가 다른 발광 도형
 *   3. 색 — 위 둘을 보조한다
 *
 * 지금은 KayKit 에 역할별 NPC 모델이 없어 프리미티브로 만든다. 나중에 모델이 생기면
 * `buildNpc` 만 갈아끼우면 되고, 배치·표식 규칙은 그대로 쓴다.
 */

/** 역할이 한눈에 읽히는 소품. 실루엣 축의 단서. */
type PropKind = "pack" | "spear" | "lantern" | "crates" | "scroll" | "anvil" | "halberd"
/** 머리 위 표식. 소품과 다른 축의 단서를 하나 더 준다. */
type EmblemKind = "coin" | "cone" | "orb" | "cube" | "plate" | "octa" | "ring"

interface NpcStyle {
  robe: number
  accent: number
  prop: PropKind
  emblem: EmblemKind
}

const STYLES: Record<NpcRole, NpcStyle> = {
  merchant: { robe: 0xc98b4b, accent: 0x7a4a22, prop: "pack", emblem: "coin" },
  trainer: { robe: 0x8d5a5a, accent: 0x4a2a2a, prop: "spear", emblem: "cone" },
  healer: { robe: 0xe8dcc0, accent: 0xffc46b, prop: "lantern", emblem: "orb" },
  storage: { robe: 0x7d8a6a, accent: 0x4b5540, prop: "crates", emblem: "cube" },
  questgiver: { robe: 0x6b7fa8, accent: 0x36466a, prop: "scroll", emblem: "plate" },
  blacksmith: { robe: 0x6a6a72, accent: 0x36363c, prop: "anvil", emblem: "octa" },
  gatekeeper: { robe: 0xb8562f, accent: 0x5e2a15, prop: "halberd", emblem: "ring" },
}

const SKIN = 0xe8b98c

function buildProp(kind: PropKind, style: NpcStyle): THREE.Object3D {
  const g = new THREE.Group()
  switch (kind) {
    case "pack": {
      // 등에 진 짐 — 행상
      const sack = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.46, 0.3), toonMat(style.accent))
      sack.position.set(0, 0.95, 0.3)
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8), toonMat(0xb9a37a))
      roll.rotation.z = Math.PI / 2
      roll.position.set(0, 1.22, 0.3)
      g.add(sack, roll)
      break
    }
    case "spear": {
      // 세워둔 훈련용 창 — 교관
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.7, 6), toonMat(0x7a5a3a))
      shaft.position.set(0.42, 0.85, 0)
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 6), toonMat(0xb8bcc4))
      tip.position.set(0.42, 1.82, 0)
      g.add(shaft, tip)
      break
    }
    case "lantern": {
      // 등불 — 등불지기. 세계관의 중심 소품이라 이 NPC 만 실제로 빛난다.
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6), toonMat(0x5a4632))
      pole.position.set(0.44, 0.75, 0)
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 12, Math.PI), toonMat(0x5a4632))
      hook.position.set(0.44, 1.5, 0)
      hook.rotation.y = Math.PI / 2
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 10, 8),
        toonMat(0xffd9a0, { emissive: 0xffb24a, emissiveIntensity: 1.4 }),
      )
      lamp.position.set(0.44, 1.32, 0)
      g.add(pole, hook, lamp)
      break
    }
    case "crates": {
      // 쌓인 상자 — 창고지기
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.36, 0.44), toonMat(style.accent))
      a.position.set(0.55, 0.18, 0.1)
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.34), toonMat(0x8a7550))
      b.position.set(0.55, 0.51, 0.1)
      b.rotation.y = 0.4
      g.add(a, b)
      break
    }
    case "scroll": {
      // 펼친 기록 — 기록관
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.32), toonMat(0xf0e6cc))
      sheet.position.set(0, 0.95, -0.32)
      sheet.rotation.x = -0.5
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.46, 6), toonMat(style.accent))
      rod.rotation.z = Math.PI / 2
      rod.position.set(0, 0.86, -0.44)
      g.add(sheet, rod)
      break
    }
    case "anvil": {
      // 모루 — 대장장이. 바닥에 놓여 실루엣이 낮고 넓다.
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), toonMat(style.accent))
      base.position.set(0.62, 0.08, 0)
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.2), toonMat(style.accent))
      neck.position.set(0.62, 0.24, 0)
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.26), toonMat(0x8b8b94))
      top.position.set(0.62, 0.39, 0)
      g.add(base, neck, top)
      break
    }
    case "halberd": {
      // 긴 미늘창 — 문지기. 유일하게 기능이 붙은 NPC 라 실루엣을 가장 높게 잡는다.
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), toonMat(0x6a4a2a))
      shaft.position.set(0.46, 1.1, 0)
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.44, 4), toonMat(0xc8ccd4))
      blade.position.set(0.46, 2.4, 0)
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.07), toonMat(0xc8ccd4))
      guard.position.set(0.46, 2.12, 0)
      g.add(shaft, blade, guard)
      break
    }
  }
  return g
}

function buildEmblem(kind: EmblemKind, color: number): THREE.Mesh {
  const mat = toonMat(color, { emissive: color, emissiveIntensity: 0.9 })
  let geo: THREE.BufferGeometry
  switch (kind) {
    case "coin": geo = new THREE.CylinderGeometry(0.15, 0.15, 0.04, 12); break
    case "cone": geo = new THREE.ConeGeometry(0.14, 0.26, 6); break
    case "orb": geo = new THREE.SphereGeometry(0.14, 10, 8); break
    case "cube": geo = new THREE.BoxGeometry(0.22, 0.22, 0.22); break
    case "plate": geo = new THREE.BoxGeometry(0.28, 0.04, 0.2); break
    case "octa": geo = new THREE.OctahedronGeometry(0.16); break
    case "ring": geo = new THREE.TorusGeometry(0.14, 0.045, 8, 16); break
  }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = 2.05
  if (kind === "ring") mesh.rotation.x = Math.PI / 2
  return mesh
}

/** 상호작용 지점임을 알리는 바닥 원반. 문지기는 더 크고 밝게 둔다. */
function buildGroundRing(color: number, radius: number, opacity: number): THREE.Mesh {
  const geo = new THREE.RingGeometry(radius * 0.62, radius, 24)
  geo.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  )
  mesh.position.y = 0.03
  mesh.userData.outlineParameters = { visible: false }
  return mesh
}

function buildNpc(npc: NpcPlacement): THREE.Object3D {
  const style = STYLES[npc.role]
  const g = new THREE.Group()
  g.name = `npc-${npc.role}`

  // 3등신 비율 — 기존 KayKit 캐릭터와 실루엣을 맞춘다
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.36, 0.55, 10), toonMat(style.robe))
  robe.position.y = 0.28
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.34), toonMat(style.robe))
  torso.position.y = 0.78
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.14, 10), toonMat(style.accent))
  collar.position.y = 1.02
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), toonMat(SKIN))
  head.position.y = 1.34
  g.add(robe, torso, collar, head)
  g.add(buildProp(style.prop, style))

  const isGate = npc.role === "gatekeeper"
  g.add(buildEmblem(style.emblem, isGate ? 0xffd36b : style.accent))
  g.add(buildGroundRing(isGate ? 0xffd36b : 0xe8dcc0, isGate ? 1.5 : 1.0, isGate ? 0.5 : 0.22))

  applyOutline(g)
  g.position.set(npc.cell.col * TILE, 0, npc.cell.row * TILE)
  // 광장 안쪽(남쪽)을 바라보게 — 건물 앞에 서서 플레이어를 맞는 자세
  g.rotation.y = Math.PI
  return g
}

/**
 * 마을 NPC 전원을 만들어 `parent` 에 붙인다. 맵 루트에 붙으므로 존을 떠날 때
 * 맵 메시와 함께 정리된다 — 별도 수명 관리가 필요 없다.
 *
 * 반환값은 붙인 NPC 수. 0 이면 배치 데이터가 비어 있다는 뜻이다.
 */
export function dressTownNpcs(parent: THREE.Object3D): number {
  const group = new THREE.Group()
  group.name = "town-npcs"
  for (const npc of TOWN_NPCS) group.add(buildNpc(npc))
  parent.add(group)
  return TOWN_NPCS.length
}
