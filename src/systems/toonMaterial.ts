import * as THREE from "three"
import { THEME } from "../content/theme"

/**
 * 툰 머티리얼 공장 — 코드로 만드는 오브젝트(NPC·출구 표식 등)가 캐릭터·던전과
 * 같은 셰이딩 위에 놓이도록 한 곳에서 만든다.
 *
 * 한 화면에 툰 오브젝트와 PBR 오브젝트가 섞이면 스타일이 어긋나 보인다.
 * `docs/content/art-direction.md` 의 안티패턴 첫 줄이 그것이다.
 *
 * NOTE: `systems/render.ts` 안에도 같은 목적의 그라디언트 맵이 있다. 지금은 카메라 작업이
 * 그 파일에서 진행 중이라 손대지 않았다. 정리되면 render.ts 가 이 모듈을 쓰도록 합치면 된다.
 * (텍스처 3바이트짜리 하나가 더 생기는 정도라 당장의 비용은 없다)
 */

let gradient: THREE.DataTexture | null = null

/** 명암 계단 텍스처. `Nearest` 필터라야 단계가 뭉개지지 않고 또렷하게 끊긴다. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient
  const { steps, shadowFloor } = THEME.toon
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
  gradient = tex
  return tex
}

export interface ToonMatOptions {
  emissive?: number
  emissiveIntensity?: number
  transparent?: boolean
  opacity?: number
  side?: THREE.Side
  depthWrite?: boolean
}

/** 테마가 툰이면 툰 머티리얼을, 아니면 PBR 을 만든다. */
export function toonMat(color: number, opts: ToonMatOptions = {}): THREE.Material {
  const { emissive, emissiveIntensity, ...rest } = opts
  if (!THEME.toon.enabled) {
    return new THREE.MeshStandardMaterial({
      color, roughness: 0.85,
      ...(emissive !== undefined ? { emissive } : {}),
      ...(emissiveIntensity !== undefined ? { emissiveIntensity } : {}),
      ...rest,
    })
  }
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: toonGradient(),
    ...(emissive !== undefined ? { emissive } : {}),
    ...(emissiveIntensity !== undefined ? { emissiveIntensity } : {}),
    ...rest,
  })
}

/**
 * 외곽선 두께를 심는다. `OutlineEffect` 가 머티리얼의 `userData.outlineParameters` 를 읽는다.
 * 두께는 오브젝트 스케일이 곱해지므로, 스케일을 건 오브젝트는 그만큼 나눠서 넘겨야 한다.
 */
export function applyOutline(root: THREE.Object3D, thickness = THEME.outline.thickness): void {
  if (!THEME.outline.enabled) return
  const params = {
    thickness,
    color: new THREE.Color(THEME.outline.color).toArray(),
    alpha: THEME.outline.alpha,
    visible: true,
  }
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    for (const m of mats) m.userData.outlineParameters = { ...params }
  })
}
