import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { TILE, type DungeonMap } from "../content/map"
import { getZoneDressing, KIT_SCALE, LIGHTS, WALL_VARIANTS } from "../content/dungeonKit"
import { toonMat } from "./toonMaterial"
import { applyShadowFlags } from "./render"
import { dressTownNpcs } from "./townVisuals"
import { dressZoneExits } from "./zoneMarkers"
import { buildProps, planProps, propFiles } from "./dungeonProps"

/**
 * 던전 외형 — 회색 박스 대신 실제 던전 킷 모델을 배치한다.
 *
 * 이 킷의 벽은 칸을 채우는 큐브가 아니라 **칸 경계에 세우는 판넬**이다.
 * 그래서 벽 칸마다 큐브를 하나 놓는 대신, 벽 칸의 네 면 중 통행 칸과 맞닿은
 * 면에만 판넬을 한 장씩 세운다. 보이지 않는 면을 만들지 않으므로 오히려 가볍다.
 *
 * 배치 규칙과 실측 치수는 docs/content/dungeon-dressing.md 참조.
 * 에셋이 없으면 아무것도 하지 않고 false 를 돌려준다 — 호출 측이 기존 박스로 폴백한다.
 */

const KIT_PATH = "/assets/dungeon"

interface KitPiece {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

const kit = new Map<string, KitPiece>()
let kitLoaded = false

/**
 * 킷 모델에서 인스턴싱에 쓸 지오메트리와 머티리얼을 뽑는다.
 *
 * 조각 하나가 메시 여러 개로 이뤄진 경우가 있다(예: 횃불 = 받침 + 불꽃).
 * 첫 메시만 쓰면 일부가 통째로 사라지므로, 같은 머티리얼을 쓰는 메시는 합쳐서 쓴다.
 * KayKit 은 텍스처 아틀라스 하나를 공유하므로 대부분 이 조건에 들어맞는다.
 */
function extractPiece(root: THREE.Object3D): KitPiece | null {
  const geometries: THREE.BufferGeometry[] = []
  let material: THREE.Material | null = null
  root.updateWorldMatrix(true, true)
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const mat = Array.isArray(child.material) ? child.material[0] : child.material
    if (!mat) return
    if (!material) material = mat
    else if (mat !== material) return // 다른 머티리얼은 건너뛴다 (인스턴싱은 하나만 쓴다)
    // 모델의 지역 변환을 지오메트리에 구워 넣어야 인스턴스 행렬만으로 배치할 수 있다.
    const geo = child.geometry.clone()
    geo.applyMatrix4(child.matrixWorld)
    geometries.push(geo)
  })
  if (!material || geometries.length === 0) return null
  const geometry = geometries.length === 1 ? geometries[0]! : mergeGeometries(geometries, false)
  return geometry ? { geometry, material } : null
}

const PIECES = [
  ...WALL_VARIANTS,
  "floor_tile_large",
  "floor_dirt_large",
  "column",
  LIGHTS.lit.file,
  LIGHTS.mounted.file,
  // 소품(통·상자·잔해·탁자·촛대). 카탈로그는 진작 있었는데 **로딩조차 안 하고 있었다**.
  ...propFiles(),
]

/**
 * 던전 킷을 로드한다. 캐릭터 모델과 마찬가지로 실패해도 게임은 그대로 돌아간다.
 * main.ts 부팅 시 한 번 호출한다.
 */
export async function loadDungeonKit(): Promise<boolean> {
  const loader = new GLTFLoader()
  await Promise.all(
    PIECES.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(`${KIT_PATH}/${name}.glb`)
        const piece = extractPiece(gltf.scene)
        if (piece) kit.set(name, piece)
      } catch {
        // 없으면 그 조각만 건너뛴다
      }
    }),
  )
  kitLoaded = kit.size > 0
  return kitLoaded
}

function cellWalkable(map: DungeonMap, c: number, r: number): boolean {
  if (r < 0 || r >= map.rows || c < 0 || c >= map.cols) return false
  return !(map.walls[r]?.[c] ?? true)
}

/** 결정적 의사난수 — 같은 맵은 항상 같은 외형이 되도록 좌표에서 뽑는다. */
function cellHash(c: number, r: number): number {
  const n = Math.sin(c * 127.1 + r * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function pickWallVariant(c: number, r: number, face: number, weights: Record<string, number>): string {
  const h = cellHash(c * 4 + face, r)
  let acc = 0
  for (const [name, weight] of Object.entries(weights)) {
    acc += weight
    if (h < acc && kit.has(name)) return name
  }
  return "wall"
}

function addInstances(
  scene: THREE.Object3D,
  pieceName: string,
  placements: { x: number; z: number; y?: number; yaw?: number; scale?: number }[],
  tint?: number,
): void {
  const piece = kit.get(pieceName)
  if (!piece || placements.length === 0) return
  const mesh = new THREE.InstancedMesh(piece.geometry, piece.material, placements.length)
  // 색조는 인스턴스 색상으로 준다. 머티리얼을 존마다 복제하면 오갈 때마다 리소스가 쌓인다.
  if (tint !== undefined && tint !== 0xffffff) {
    const c = new THREE.Color(tint)
    for (let i = 0; i < placements.length; i++) mesh.setColorAt(i, c)
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  placements.forEach((p, i) => {
    const s = (p.scale ?? 1) * KIT_SCALE
    pos.set(p.x, p.y ?? 0, p.z)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw ?? 0)
    scl.set(s, s, s)
    m.compose(pos, q, scl)
    mesh.setMatrixAt(i, m)
  })
  mesh.instanceMatrix.needsUpdate = true
  // 바닥은 그림자를 받기만, 벽·기둥은 드리우기도 한다. 바닥이 그림자를 드리우면
  // 자기 자신에게 얼룩이 생기고(shadow acne) 얻는 것도 없다.
  const isFloor = pieceName.startsWith("floor_")
  mesh.receiveShadow = true
  mesh.castShadow = !isFloor
  // 인스턴스 전체를 감싸는 바운딩을 계산해야 컬링이 올바르게 동작한다.
  // (컬링을 끄면 화면 밖 벽까지 전부 그린다)
  mesh.computeBoundingSphere()
  scene.add(mesh)
}

/**
 * 벽 속. 킷의 벽은 **두께 없는 판넬**이라, 카메라 각도를 낮추면 부서진 벽의 구멍과
 * 판넬 뒷면 너머로 하늘이 그대로 보인다. 근접 카메라가 들어오면서 실제로 그렇게 나왔다.
 *
 * 벽 칸 안쪽에 판넬보다 조금 작은 덩어리를 하나 채워 두면 구멍 너머로 돌이 보인다.
 * 인스턴스 하나로 처리하므로 벽이 수백 칸이어도 드로우콜은 1이다.
 * 지오메트리·머티리얼은 모듈에서 한 번만 만들어 공유한다 — 존마다 만들면 리소스가 쌓인다.
 */
let coreGeo: THREE.BufferGeometry | null = null
let coreMat: THREE.Material | null = null

function addWallCores(scene: THREE.Object3D, cells: { x: number; z: number }[], tint: number): void {
  if (cells.length === 0) return
  // 판넬 높이는 킷 원본 4 × KIT_SCALE = 2. 속은 그보다 살짝 낮게 둬 위로 삐져나오지 않게 한다.
  coreGeo ??= new THREE.BoxGeometry(TILE * 0.96, 1.94, TILE * 0.96)
  coreMat ??= toonMat(0xffffff)
  const mesh = new THREE.InstancedMesh(coreGeo, coreMat, cells.length)
  const m = new THREE.Matrix4()
  // 판넬은 어두운 돌 텍스처가 색조를 눌러 주지만 속은 민무늬라, 같은 색조를 그대로 쓰면
  // 위에서 내려다볼 때 돌이 아니라 모래처럼 밝게 뜬다(반구광이 윗면을 가장 세게 때린다).
  // 채도와 명도를 함께 내려 존의 색기는 남기고 재질만 돌덩이로 읽히게 한다.
  const c = new THREE.Color(tint)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  c.setHSL(hsl.h, hsl.s * 0.45, hsl.l * 0.32)
  cells.forEach((p, i) => {
    m.makeTranslation(p.x, 0.97, p.z)
    mesh.setMatrixAt(i, m)
    mesh.setColorAt(i, c)
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.computeBoundingSphere()
  scene.add(mesh)
}

/** 벽 칸의 네 면 중 통행 칸을 향한 면 (dc, dr) */
const FACES: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
]

/**
 * 맵에 던전 킷을 입힌다. 킷이 없으면 false — 호출 측이 기존 박스 렌더로 폴백한다.
 * mapId 는 바닥 재질 선택에만 쓴다 (갱도는 흙, 나머지는 석재).
 */
export function dressDungeon(scene: THREE.Object3D, map: DungeonMap, mapId = "mine"): boolean {
  // 킷 유무와 무관하게 세운다. 킷이 없어 폴백 박스로 그려지더라도 NPC 와 출구는 보여야 한다.
  // 둘 다 맵 루트에 붙으므로 존을 떠날 때 맵 메시와 함께 정리된다.
  if (mapId === "town") { dressTownNpcs(scene); applyShadowFlags(scene, true, true) }
  dressZoneExits(scene, mapId)

  if (!kitLoaded) return false

  const dressing = getZoneDressing(mapId)
  const floorName = dressing.floor
  const floors: { x: number; z: number }[] = []
  const wallsByVariant = new Map<string, { x: number; z: number; yaw: number }[]>()
  const torches: { x: number; z: number; y: number; yaw: number }[] = []
  const cores: { x: number; z: number }[] = []

  // **맵 바깥 스커트.** 벽 속은 맵 안쪽 칸만 채우므로 가장자리 너머는 여전히 비어 있고,
  // 카메라가 맵 끝을 넘겨다보면 하늘색 띠가 그대로 보인다(대조 시트에서 잡혔다).
  // 경계 바깥을 몇 칸 둘러 채워 시야가 세계 밖으로 새지 않게 한다.
  const SKIRT = 5
  for (let r = -SKIRT; r < map.rows + SKIRT; r++) {
    for (let c = -SKIRT; c < map.cols + SKIRT; c++) {
      if (r >= 0 && r < map.rows && c >= 0 && c < map.cols) continue
      cores.push({ x: c * TILE, z: r * TILE })
    }
  }

  let panelIndex = 0
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (cellWalkable(map, c, r)) {
        floors.push({ x: c * TILE, z: r * TILE })
        continue
      }
      // 벽 칸은 통행 칸과 맞닿았든 아니든 전부 속을 채운다.
      // 처음엔 판넬이 선 칸(faced)만 채웠는데, **두께 2칸 이상인 벽의 안쪽이 비어**
      // 위에서 내려다보면 그 구멍으로 하늘이 그대로 보였다. 인스턴스 하나라
      // 칸이 몇 개든 드로우콜은 1이다 — 아낄 이유가 없다.
      cores.push({ x: c * TILE, z: r * TILE })
      // 벽 칸: 통행 칸과 맞닿은 면에만 판넬을 세운다
      for (let f = 0; f < FACES.length; f++) {
        const [dc, dr] = FACES[f]!
        if (!cellWalkable(map, c + dc, r + dr)) continue
        const variant = pickWallVariant(c, r, f, dressing.wallWeights)
        const yaw = Math.atan2(dc, dr)
        const list = wallsByVariant.get(variant) ?? []
        list.push({ x: (c + dc / 2) * TILE, z: (r + dr / 2) * TILE, yaw })
        wallsByVariant.set(variant, list)

        // 일정 간격마다 벽걸이 횃불. 세계관에서 등불은 안전의 표식이라 장식이 아니다.
        if (panelIndex % dressing.torchEvery === 0) {
          torches.push({
            x: (c + dc * 0.42) * TILE,
            z: (r + dr * 0.42) * TILE,
            y: 1.15,
            yaw,
          })
        }
        panelIndex++
      }
    }
  }

  // 소품 — 던전을 "사람이 쓰던 곳" 으로 만든다. 벽에 맞닿은 칸에만 놓는다(순수 장식이라
  // 통로 한복판에 두면 플레이어가 통 속을 걸어 지나가는 게 그대로 보인다).
  buildProps(scene, planProps(map, mapId), (f) => kit.get(f), dressing.tint)

  addWallCores(scene, cores, dressing.wallTint)
  addInstances(scene, floorName, floors, dressing.tint)
  for (const [variant, list] of wallsByVariant) addInstances(scene, variant, list, dressing.wallTint)
  if (kit.has(LIGHTS.lit.file)) {
    // 어두운 씬이라 자체 발광이 없으면 횃불이 보이지 않는다. 조명을 30개 추가하는 대신
    // 머티리얼을 발광시켜 표식으로만 읽히게 한다 — 실제 조명은 플레이어의 등불 하나뿐이다.
    const torchPiece = kit.get(LIGHTS.lit.file)!
    const glow = torchPiece.material.clone()
    if (glow instanceof THREE.MeshStandardMaterial) {
      glow.emissive = new THREE.Color(0xff9840)
      glow.emissiveIntensity = 0.9
      glow.userData.baseEmissive = 0xff9840
      glow.userData.baseEmissiveIntensity = 0.9
    }
    kit.set(LIGHTS.lit.file, { geometry: torchPiece.geometry, material: glow })
    addInstances(scene, LIGHTS.lit.file, torches.map((t) => ({ ...t, scale: 1.6 })))
  }
  return true
}
