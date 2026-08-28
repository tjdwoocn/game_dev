import * as THREE from "three"
import { TILE, type DungeonMap } from "../content/map"
import { instantiate, type ModelRegistry } from "../core/assets"
import { dressEnemy } from "./enemyVisuals"
import { dressLoot } from "./lootVisuals"
import { createPostChain, hasPostChain, renderPost, resizePost } from "./post"
import { OutlineEffect } from "three/examples/jsm/effects/OutlineEffect.js"
import { THEME } from "../content/theme"
import type { GameWorld, ModelKind, Rarity, Resources } from "../core/world"
import { attachAnimations } from "./animation"
import { dressDungeon } from "./dungeonDressing"
import { createCameraRig, getCameraPosition, updateCameraRig, CAMERA_DEFAULT } from "./camera"

export const CAMERA_OFFSET = CAMERA_DEFAULT

const RARITY_COLOR: Record<Rarity, number> = {
  common: 0xd8d2c4,
  magic: 0x5a8ae8,
  rare: 0xe8c83a,
}

let playerLight: THREE.PointLight | null = null
let cameraShakeUntil = 0
let cameraShakeStartedAt = 0
let cameraShakeDuration = 0
let cameraShakeAmplitude = 0
let cameraInitialized = false
const cameraRig = createCameraRig()
let outlineEffect: OutlineEffect | null = null
let shadowSun: THREE.DirectionalLight | null = null
let mainRenderer: THREE.WebGLRenderer | null = null

/** 실시간 시각 기반의 결정적 노이즈. Math.random을 쓰지 않아 리플레이가 재현된다. */
function pseudoNoise(t: number, seed: number): number {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

/**
 * 툰 셰이딩용 명암 계단 텍스처.
 *
 * `MeshToonMaterial` 은 빛의 세기를 이 1픽셀 높이 텍스처로 찾아본다. 필터를 `Nearest` 로
 * 두어야 단계가 뭉개지지 않고 또렷하게 끊긴다 — 그게 셀 셰이딩의 전부다.
 * 가장 어두운 단계를 0 이 아니라 `shadowFloor` 에서 시작시키는 이유는, 0 이면 그림자가
 * 새까매져서 조명을 밝게 올린 의미가 사라지기 때문이다.
 */
function makeGradientMap(steps: number, shadowFloor: number): THREE.DataTexture {
  const data = new Uint8Array(steps)
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 1 : i / (steps - 1)
    data[i] = Math.round((shadowFloor + (1 - shadowFloor) * t) * 255)
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

let gradientMap: THREE.DataTexture | null = null
function getGradientMap(): THREE.DataTexture {
  gradientMap ??= makeGradientMap(THEME.toon.steps, THEME.toon.shadowFloor)
  return gradientMap
}

/** 색조를 건드릴 수 있는(= `emissive` 를 가진) 머티리얼. 피격 점멸이 이 위에서 동작한다. */
type Tintable = THREE.MeshStandardMaterial | THREE.MeshToonMaterial
function isTintable(m: THREE.Material): m is Tintable {
  return (m as Tintable).emissive !== undefined
}

/**
 * PBR 머티리얼을 툰 머티리얼로 바꾼다. 텍스처·색·투명도는 그대로 옮기고
 * `roughness`/`metalness` 는 버린다 — 툰에는 그 개념이 없다.
 * 툰이 꺼져 있으면 원본을 그대로 돌려준다.
 */
function toToon(m: THREE.Material): THREE.Material {
  if (!THEME.toon.enabled || !(m instanceof THREE.MeshStandardMaterial)) return m
  const t = new THREE.MeshToonMaterial({
    color: m.color,
    map: m.map,
    gradientMap: getGradientMap(),
    emissive: m.emissive,
    emissiveMap: m.emissiveMap,
    emissiveIntensity: m.emissiveIntensity,
    normalMap: m.normalMap,
    alphaMap: m.alphaMap,
    alphaTest: m.alphaTest,
    transparent: m.transparent,
    opacity: m.opacity,
    side: m.side,
    vertexColors: m.vertexColors,
  })
  t.name = m.name
  t.userData.baseEmissive = m.emissive.getHex()
  t.userData.baseEmissiveIntensity = m.emissiveIntensity
  return t
}

let registry: ModelRegistry = {}
export function setModelRegistry(r: ModelRegistry): void {
  registry = r
}

let mapRoot: THREE.Group | null = null

const MODEL_HEIGHT: Partial<Record<ModelKind, number>> = {
  player: 1.8, warrior: 1.7, archer: 1.7, boss: 3.4,
  "companion-tank": 1.8, "companion-striker": 1.7, "companion-support": 1.7,
}

/**
 * `OutlineEffect` 는 머티리얼의 `userData.outlineParameters` 를 읽어 외곽선을 그린다.
 * 모델별로 두께를 따로 주기 위해 여기서 심어 둔다.
 */
function setOutlineThickness(root: THREE.Object3D, thickness: number): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    for (const m of mats) {
      m.userData.outlineParameters = {
        thickness,
        color: new THREE.Color(THEME.outline.color).toArray(),
        alpha: THEME.outline.alpha,
        visible: true,
      }
    }
  })
}

/** 레지스트리에 glTF가 있으면 그것을, 없으면 프리미티브를 생성 */
function createModel(kind: ModelKind, rarity?: Rarity): THREE.Object3D {
  const loaded = registry[kind]
  if (!loaded) return createPrimitive(kind, rarity)

  const inst = instantiate(loaded)
  inst.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      const cloned = mats.map((m) => {
        const c = toToon(m.clone())
        if (isTintable(c)) {
          c.userData.baseEmissive = c.emissive.getHex()
          c.userData.baseEmissiveIntensity = c.emissiveIntensity
        }
        return c
      })
      child.material = Array.isArray(child.material) ? cloned : cloned[0]!
      // 스킨드 메시는 바인드 포즈 기준으로 바운딩이 잡혀 애니메이션 중 잘려 보일 수 있다.
      // 그렇다고 컬링을 끄면 화면 밖 유닛까지 전부 그리게 되어, 적이 40마리쯤 되면
      // 프레임이 두 배 가까이 느려진다(실측 28.8ms → 16.7ms). 반경을 넉넉히 잡고 컬링은 켠다.
      child.geometry.computeBoundingSphere()
      if (child.geometry.boundingSphere) child.geometry.boundingSphere.radius *= 2.5
    }
  })
  const bbox = new THREE.Box3().setFromObject(inst)
  const height = bbox.max.y - bbox.min.y || 1
  const scale = (MODEL_HEIGHT[kind] ?? 1.7) / height
  inst.scale.setScalar(scale)
  inst.position.y = -bbox.min.y * scale

  // 외곽선 두께는 오브젝트 공간에서 법선 방향으로 밀어낸 뒤 스케일이 곱해진다.
  // 모델마다 원본 크기가 달라 여기서 스케일이 크게 갈리므로(키를 맞추느라 걸어둔 배율),
  // 보정하지 않으면 어떤 캐릭터는 선이 안 보이고 어떤 캐릭터는 통째로 뭉개진다.
  // 실제로 보정 없이 켰을 때 캐릭터가 형체 없는 덩어리가 됐다.
  if (THEME.outline.enabled) setOutlineThickness(inst, THEME.outline.thickness / scale)

  const group = new THREE.Group()
  group.add(inst)
  attachAnimations(inst, loaded.clips)
  return group
}

/**
 * 그림자 캐스터/리시버 지정. three 는 기본이 둘 다 false 라, 켜 주지 않으면
 * shadowMap 을 켜도 화면에는 아무 변화가 없다 — 실제로 처음에 그렇게 나왔다.
 */
export function applyShadowFlags(root: THREE.Object3D, cast: boolean, receive: boolean): void {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = cast
      o.receiveShadow = receive
    }
  })
}

/**
 * 태양을 플레이어 위로 옮긴다. 그림자 카메라가 좁아서(THEME.shadow.extent) 광원이
 * 고정돼 있으면 플레이어가 조금만 걸어도 그림자 영역을 벗어난다.
 *
 * 월드 좌표를 그대로 쓰면 그림자 경계가 매 프레임 반 텍셀씩 흔들려 지글거린다.
 * 그림자 텍셀 크기 단위로 스냅해 그 떨림을 없앤다.
 */
function followSun(sun: THREE.DirectionalLight, x: number, z: number): void {
  const sh = THEME.shadow
  const texel = (sh.extent * 2) / sh.mapSize
  const sx = Math.round(x / texel) * texel
  const sz = Math.round(z / texel) * texel
  const [ox, oy, oz] = THEME.directional.position
  const len = Math.hypot(ox, oy, oz) || 1
  const dist = sh.extent * 1.8
  sun.position.set(sx + (ox / len) * dist, (oy / len) * dist, sz + (oz / len) * dist)
  sun.target.position.set(sx, 0, sz)
  sun.target.updateMatrixWorld()
}

export function shakeCamera(res: Resources, duration = 0.15, amplitude = 0.15) {
  const now = res.time.realNow ?? res.time.now
  const safeDuration = Math.max(0, duration)
  const safeAmplitude = Math.min(0.8, Math.max(0, amplitude))
  if (safeDuration <= 0 || safeAmplitude <= 0) return

  const end = now + safeDuration
  if (now >= cameraShakeUntil) {
    cameraShakeStartedAt = now
    cameraShakeDuration = safeDuration
  } else if (end > cameraShakeUntil) {
    cameraShakeDuration = Math.max(cameraShakeDuration, end - cameraShakeStartedAt)
  }
  cameraShakeUntil = Math.max(cameraShakeUntil, end)
  cameraShakeAmplitude = Math.max(cameraShakeAmplitude, safeAmplitude)
}

export function initRender(mount: HTMLElement) {
  cameraInitialized = false
  cameraShakeUntil = 0
  cameraShakeStartedAt = 0
  cameraShakeDuration = 0
  cameraShakeAmplitude = 0
  cameraRig.angle = 0
  cameraRig.zoom = 1
  cameraRig.pitch = Math.atan2(CAMERA_OFFSET.y, Math.hypot(CAMERA_OFFSET.x, CAMERA_OFFSET.z))
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    stencil: false,
  })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  // r155 이후 three 는 물리 기반 조명이 기본이다. 출력 색공간과 톤 매핑을 명시하지 않으면
  // 밝은 부분이 그대로 흰색으로 잘려 색이 사라진다. ACES 는 하이라이트를 눌러 색을 남긴다.
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = THEME.tone.exposure
  // **이 줄이 들어오기 전까지 이 게임에는 그림자가 하나도 없었다.**
  // 캐릭터가 바닥에 붙어 보이지 않던 가장 큰 원인이다.
  renderer.shadowMap.enabled = THEME.shadow.enabled
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  mount.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(THEME.background)
  scene.fog = new THREE.Fog(THEME.fog.color, THEME.fog.near, THEME.fog.far)

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200)
  camera.position.set(CAMERA_OFFSET.x, CAMERA_OFFSET.y, CAMERA_OFFSET.z)
  camera.lookAt(0, 0, 0)

  // 반구광이 기본 밝기를 만든다. 단방향 광만 쓰면 그림자 쪽이 검게 죽어 다시 어두워진다.
  scene.add(
    new THREE.HemisphereLight(THEME.hemisphere.sky, THEME.hemisphere.ground, THEME.hemisphere.intensity),
  )
  const dir = new THREE.DirectionalLight(THEME.directional.color, THEME.directional.intensity)
  dir.position.set(...THEME.directional.position)
  scene.add(dir)
  // 그림자 카메라는 던전 전체가 아니라 **플레이어 주변만** 덮는다. 맵 전체를 덮으면
  // 같은 해상도로 훨씬 넓은 면적을 담당하게 되어 텍셀이 굵어지고 윤곽이 뭉갠다.
  // 광원은 매 프레임 플레이어를 따라 옮긴다(renderSystem 아래쪽).
  if (THEME.shadow.enabled) {
    const sh = THEME.shadow
    dir.castShadow = true
    dir.shadow.mapSize.set(sh.mapSize, sh.mapSize)
    const cam = dir.shadow.camera
    cam.left = -sh.extent
    cam.right = sh.extent
    cam.top = sh.extent
    cam.bottom = -sh.extent
    cam.near = 0.5
    cam.far = sh.extent * 3.2
    cam.updateProjectionMatrix()
    dir.shadow.bias = sh.bias
    dir.shadow.normalBias = sh.normalBias
    dir.shadow.radius = sh.radius
    scene.add(dir.target)
    shadowSun = dir
  }

  playerLight = new THREE.PointLight(
    THEME.playerLight.color,
    THEME.playerLight.intensity,
    THEME.playerLight.distance,
    THEME.playerLight.decay,
  )
  scene.add(playerLight)

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
    resizePost(window.innerWidth, window.innerHeight)
  })

  mainRenderer = renderer
  outlineEffect = THEME.outline.enabled
    ? new OutlineEffect(renderer, {
        defaultColor: new THREE.Color(THEME.outline.color).toArray(),
        defaultThickness: THEME.outline.thickness,
        defaultAlpha: THEME.outline.alpha,
      })
    : null

  createPostChain(renderer, scene, camera, outlineEffect)

  return { scene, camera, renderer }
}

/**
 * 한 프레임을 그린다. 외곽선이 켜져 있으면 `OutlineEffect` 를 거친다.
 *
 * `OutlineEffect` 는 메시마다 법선 방향으로 살짝 부풀린 뒷면(back face) 복제본을 덧그리는
 * 고전적인 방식이다. 스킨드 메시의 뼈대까지 공유해 주므로 애니메이션 중에도 외곽선이 따라온다.
 * 인스턴스 메시(바닥·벽)에는 적용되지 않는데, 지형에까지 선이 들어가면 오히려 지저분해지므로
 * 우리 목적에는 그편이 맞다.
 */
export function renderFrame(scene: THREE.Scene, camera: THREE.Camera): void {
  // 컴포저가 있으면 그 안의 첫 패스가 외곽선까지 그린다. 여기서 또 그리면 두 번 그린다.
  if (hasPostChain()) { renderPost(); return }
  if (outlineEffect) outlineEffect.render(scene, camera)
  else mainRenderer?.render(scene, camera)
}

export function clearMapMeshes(scene: THREE.Scene): void {
  if (!mapRoot) return
  scene.remove(mapRoot)
  mapRoot = null
}

export function buildMapMeshes(scene: THREE.Scene, map: DungeonMap, mapId = "mine"): void {
  clearMapMeshes(scene)
  mapRoot = new THREE.Group()
  mapRoot.name = "map-root"
  scene.add(mapRoot)
  if (dressDungeon(mapRoot, map, mapId)) return // 던전 킷이 있으면 그것으로, 없으면 아래 박스 폴백
  const floorGeo = new THREE.PlaneGeometry(map.cols * TILE, map.rows * TILE)
  floorGeo.rotateX(-Math.PI / 2)
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ color: THEME.fallback.floor, roughness: 1 }),
  )
  floor.position.set(((map.cols - 1) * TILE) / 2, 0, ((map.rows - 1) * TILE) / 2)
  mapRoot.add(floor)

  let wallCount = 0
  for (const row of map.walls) for (const w of row) if (w) wallCount++

  const wallGeo = new THREE.BoxGeometry(TILE, 3, TILE)
  const wallMat = new THREE.MeshStandardMaterial({ color: THEME.fallback.wall, roughness: 0.95 })
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCount)
  const m = new THREE.Matrix4()
  let i = 0
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (map.walls[r]?.[c]) {
        m.setPosition(c * TILE, 1.5, r * TILE)
        walls.setMatrixAt(i++, m)
      }
    }
  }
  mapRoot.add(walls)
}

/**
 * 프리미티브용 머티리얼. 톤이 툰이면 툰으로, 아니면 PBR 로 만든다.
 * 한 화면에 툰 캐릭터와 PBR 오브젝트가 섞이면 스타일이 어긋나 보이므로 여기서도 맞춘다.
 */
function standardMat(color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  // undefined 를 그대로 넘기면 three 가 파라미터마다 경고를 찍는다. 있는 것만 넣는다.
  const toonParams: THREE.MeshToonMaterialParameters = { color, gradientMap: getGradientMap() }
  if (extra.emissive !== undefined) toonParams.emissive = extra.emissive
  if (extra.emissiveIntensity !== undefined) toonParams.emissiveIntensity = extra.emissiveIntensity
  const mat: Tintable = THEME.toon.enabled
    ? new THREE.MeshToonMaterial(toonParams)
    : new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra })
  mat.userData.baseEmissive = (extra.emissive as number | undefined) ?? 0x000000
  mat.userData.baseEmissiveIntensity = extra.emissiveIntensity ?? 1
  return mat
}

export function createPrimitive(kind: ModelKind, rarity?: Rarity): THREE.Object3D {
  const g = new THREE.Group()
  switch (kind) {
    case "player": {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.9), standardMat(0x8a94a8, { metalness: 0.4 }))
      body.position.y = 0.9
      const sword = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.2), standardMat(0xc8ccd8, { metalness: 0.7 }))
      sword.position.set(0.55, 0.85, 0.45)
      g.add(body, sword)
      break
    }
    case "warrior": {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.8), standardMat(0xd8d0c0))
      body.position.y = 0.8
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.9), standardMat(0x9a8f78))
      blade.position.set(0.45, 0.75, 0.35)
      g.add(body, blade)
      break
    }
    case "archer": {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.8), standardMat(0xc8c0a8))
      body.position.y = 0.8
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 8, 16, Math.PI), standardMat(0x6a4a28))
      bow.position.set(0.5, 0.9, 0.1)
      bow.rotation.y = Math.PI / 2
      g.add(body, bow)
      break
    }
    case "boss": {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 1.6), standardMat(0x7a1818))
      body.position.y = 1.7
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.6, 5), standardMat(0x3a3040, { emissive: 0x601010, emissiveIntensity: 0.6 }))
      crown.position.y = 3.1
      g.add(body, crown)
      break
    }
    case "companion-tank": {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.85), standardMat(0x587b92, { metalness: 0.3 }))
      body.position.y = 0.86
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 8), standardMat(0x9cb8c7, { metalness: 0.7 }))
      shield.rotation.z = Math.PI / 2
      shield.position.set(0.52, 0.9, 0.15)
      g.add(body, shield)
      break
    }
    case "companion-striker": {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.8), standardMat(0x765995, { metalness: 0.2 }))
      body.position.y = 0.82
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 16, Math.PI), standardMat(0xd2a35c))
      bow.rotation.y = Math.PI / 2
      bow.position.set(0.44, 0.9, 0.1)
      g.add(body, bow)
      break
    }
    case "companion-support": {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.8), standardMat(0xb48a46, { emissive: 0x8a5d1d, emissiveIntensity: 0.35 }))
      body.position.y = 0.82
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.045, 8, 18), standardMat(0xffdf83, { emissive: 0xffb52e, emissiveIntensity: 0.8 }))
      halo.position.y = 1.55
      halo.rotation.x = Math.PI / 2
      g.add(body, halo)
      break
    }
    case "projectile": {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 8, 8),
        standardMat(0xffcc66, { emissive: 0xffaa33, emissiveIntensity: 1.5 }),
      )
      ball.position.y = 1.0
      g.add(ball)
      break
    }
    case "loot": {
      const color = RARITY_COLOR[rarity ?? "common"]
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.3),
        standardMat(color, { emissive: color, emissiveIntensity: 0.5 }),
      )
      gem.position.y = 0.5
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.3, 4, 12, 1, true),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.3,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
        }),
      )
      pillar.position.y = 2
      g.add(gem, pillar)
      break
    }
  }
  return g
}

function setFlash(obj: THREE.Object3D, on: boolean) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.Material && isTintable(child.material)) {
      const mat = child.material
      if (on) {
        mat.emissive.setHex(0xffffff)
        mat.emissiveIntensity = 0.85
      } else {
        mat.emissive.setHex(mat.userData.baseEmissive as number)
        mat.emissiveIntensity = mat.userData.baseEmissiveIntensity as number
      }
    }
  })
}

function setOpacity(obj: THREE.Object3D, opacity: number) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
      child.material.transparent = true
      child.material.opacity = opacity
    }
  })
  obj.userData.faded = true
}

/** 사망 페이드를 되돌린다. 부활한 플레이어가 투명인 채로 남지 않도록. */
function clearFade(obj: THREE.Object3D) {
  if (!obj.userData.faded) return
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
      child.material.opacity = 1
      child.material.transparent = false
    }
  })
  obj.userData.faded = false
}

export function renderSystem(world: GameWorld, res: Resources): void {
  const now = res.time.now

  for (const e of world.with("transform", "model")) {
    const m = e.model
    if (!m.object) {
      m.object = createModel(m.kind, m.rarity)
      m.object.userData.entity = e
      // 전리품과 투사체는 그림자를 만들지 않는다 — 작고 떠 있어서 얼룩으로만 보인다.
      if (!e.lootDrop && !e.projectile) applyShadowFlags(m.object, true, false)
      // 같은 스켈레톤 모델에서 종류별 실루엣을 만든다 (비율·색·덧붙임).
      // **applyShadowFlags 뒤에** 와야 한다 — 장식이 스스로 정한 그림자 플래그가 살아남아야 하고,
      // 스케일된 래퍼 아래에서 그림자를 드리우는 lit 장식이 프레임을 통째로 날리는 문제가 있다.
      if (e.enemy) dressEnemy(m.object, e.enemy.kind, !!e.enemy.isElite)
      // 부위별 형태 — 검·갑옷·반지를 멀리서도 실루엣으로 구분한다
      if (e.lootDrop) dressLoot(m.object, e.lootDrop.item)
      res.scene.add(m.object)
    }
    const p = e.transform.position
    m.object.position.set(p.x, p.y, p.z)
    m.object.rotation.y = e.transform.yaw

    if (e.lootDrop) {
      m.object.position.y = 0.15 + Math.sin(now * 2.2 + (e.lootDrop.item.id % 10)) * 0.08
      m.object.rotation.y = now * 1.2
      // 희귀 등급의 궤도 불꽃은 본체와 반대로 돌려 눈에 띄게 한다
      const sparks = m.object.getObjectByName("rare-sparks")
      if (sparks) sparks.rotation.y = -now * 2.6
    }

    setFlash(m.object, !!e.hitFlash && now < e.hitFlash.until)

    if (e.dead) {
      // 사망 모션이 먼저 보이도록 0.5초 후부터 가라앉으며 사라진다
      const t = now - e.dead.at
      m.object.position.y = p.y - Math.max(0, t - 0.5) * 1.2
      setOpacity(m.object, Math.max(0, 1 - Math.max(0, t - 0.4) * 1.3))
    } else {
      clearFade(m.object)
    }
  }

  // 카메라 · 횃불 추적
  for (const pl of world.with("player", "transform")) {
    const p = pl.transform.position
    updateCameraRig(cameraRig, res.input.zoomDelta, res.input.rotateCamera, res.input.pitchCamera)
    res.input.zoomDelta = 0
    res.input.rotateCamera = 0
    res.input.pitchCamera = 0
    const target = new THREE.Vector3(p.x, p.y, p.z)
    const desired = getCameraPosition(cameraRig, target)
    if (!cameraInitialized) {
      res.camera.position.copy(desired)
      cameraInitialized = true
    } else {
      res.camera.position.lerp(desired, 0.12)
    }
    const realNow = res.time.realNow ?? now
    if (realNow < cameraShakeUntil && cameraShakeDuration > 0) {
      const progress = Math.min(1, Math.max(0, (realNow - cameraShakeStartedAt) / cameraShakeDuration))
      const envelope = (1 - progress) * (1 - progress)
      const shake = cameraShakeAmplitude * envelope
      const phase = realNow * 32
      res.camera.position.x += shake * pseudoNoise(phase, 1)
      res.camera.position.z += shake * pseudoNoise(phase, 2)
    } else if (cameraShakeAmplitude > 0) {
      cameraShakeAmplitude = 0
    }
    res.camera.lookAt(p.x, p.y, p.z)
    playerLight?.position.set(p.x, 2.4, p.z)
    if (shadowSun) followSun(shadowSun, p.x, p.z)
    break
  }
}

/** 월드 좌표 → 화면 픽셀 좌표 (HUD 네임플레이트/데미지 텍스트용) */
export function worldToScreen(res: Resources, x: number, y: number, z: number): { x: number; y: number } {
  const v = new THREE.Vector3(x, y, z).project(res.camera)
  // 헤드리스(시나리오 하니스·단위 테스트)에는 window 가 없다. 전투 시스템이 데미지 숫자를
  // 띄우려고 이 함수를 부르므로, 여기서 막히면 시뮬레이션 자체가 돌지 않는다.
  // 원래는 전투가 화면 좌표를 알 이유가 없다 — 이벤트로 분리하는 게 옳고, 그건 별도 작업이다.
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth
  const vh = typeof window === "undefined" ? 800 : window.innerHeight
  return {
    x: ((v.x + 1) / 2) * vw,
    y: ((1 - v.y) / 2) * vh,
  }
}
