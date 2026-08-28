import type * as THREE from "three"

/**
 * 품질 티어 — 렌더 예산의 주인.
 *
 * 레퍼런스(Claude of Tanks `src/engine/quality.js`)에서 가져왔다. 그쪽은 5티어에
 * GTAO·CSM·FSR 까지 얹지만, 우리에게 없는 패스의 레버는 빼고 **우리가 실제로 돈을
 * 내는 것만** 남겼다.
 *
 * ## 왜 필요한가 — 우리는 이미 한 번 크게 데었다
 *
 * 헤드리스 하니스가 소프트웨어 렌더러(SwiftShader)로 붙는 걸 몰라서 프레임을
 * 350~430ms 로 측정했고, "밀도 불가" 로 결론 낼 뻔했다. GPU 플래그를 주니 같은 장면이
 * 32ms 였다. **기기가 무엇인지 모른 채 측정한 숫자는 전부 무효였다.**
 * 아래 `heuristicCap()` 의 첫 줄이 정확히 그 경우를 잡는다.
 *
 * ## 무엇을 깎고 무엇을 지키는가
 *
 * 레퍼런스의 사다리는 **룩을 건드리지 않는다.** 우리도 같다 —
 * **외곽선과 블룸은 레버가 아니다.** 툰 셰이딩 + 외곽선이 이 게임의 정체성이라,
 * 그걸 끄면 빨라지는 게 아니라 다른 게임이 된다. 그래서 사다리는
 * **해상도 · 그림자 맵 · AA · 블룸의 내부 해상도**만 깎는다. 블룸은 계속 켜져 있고
 * 더 거칠게 계산될 뿐이다.
 *
 * ## 스크린샷 계약과의 관계
 *
 * 자동 감지가 실행마다 다른 티어를 고르면 대조 시트가 무의미해진다.
 * 하니스는 반드시 `?quality=high` 처럼 **티어를 고정**해서 띄운다.
 */

export type QualityPresetName = "ultra" | "high" | "medium" | "low" | "minimum"

export interface QualityPreset {
  label: string
  /** `renderer.setPixelRatio` 상한. 레티나에서 실제 래스터 픽셀 수를 지배한다. */
  maxPixelRatio: number
  /** 컴포저 타깃의 MSAA 샘플 수. 0 이면 끈다. */
  msaaSamples: number
  /** 그림자를 그릴 것인가. **최하 티어에서만 끈다** — 접지감이 통째로 사라지기 때문이다. */
  shadowEnabled: boolean
  shadowMapSize: number
  /** 그림자 카메라 반경. 좁히면 텍셀이 촘촘해지지만 먼 그림자가 잘린다. */
  shadowExtent: number
  /**
   * 블룸 체인의 내부 해상도 배율. **블룸을 끄는 게 아니다** — 더 거칠게 계산할 뿐이다.
   * UnrealBloom 의 밉 체인은 이미 입력의 1/2 이라 0.5 면 1/4 해상도에서 돈다.
   */
  bloomScale: number
  /** FXAA 패스. 실측 +1.6ms 라 중간 티어부터 뺀다. */
  fxaa: boolean
  /** 캔버스로 굽는 텍스처(불꽃·자국·미니맵)의 크기 배율. */
  textureScale: number
  /** 텍스처 한 변의 절대 상한(px). */
  textureCap: number
}

export const PRESETS: Record<QualityPresetName, QualityPreset> = {
  ultra: {
    label: "최상",
    maxPixelRatio: 2.0,
    msaaSamples: 4,
    shadowEnabled: true,
    shadowMapSize: 4096,
    shadowExtent: 32,
    bloomScale: 1.0,
    fxaa: true,
    textureScale: 1,
    textureCap: 4096,
  },
  /**
   * 기본값. 레퍼런스도 auto 를 여기로 보낸다 —
   * 최상 티어는 "가장 예쁜 티어" 가 아니라 "명시적으로 고르는 검사용 티어" 다.
   */
  high: {
    label: "높음",
    maxPixelRatio: 1.5,
    msaaSamples: 4,
    shadowEnabled: true,
    shadowMapSize: 2048,
    shadowExtent: 26,
    bloomScale: 0.6,
    fxaa: true,
    textureScale: 1,
    textureCap: 2048,
  },
  medium: {
    label: "보통",
    maxPixelRatio: 1.25,
    msaaSamples: 2,
    shadowEnabled: true,
    shadowMapSize: 1536,
    shadowExtent: 24,
    bloomScale: 0.5,
    fxaa: false,
    textureScale: 1,
    textureCap: 2048,
  },
  low: {
    label: "낮음",
    maxPixelRatio: 1.0,
    msaaSamples: 0,
    shadowEnabled: true,
    shadowMapSize: 1024,
    shadowExtent: 22,
    bloomScale: 0.5,
    fxaa: false,
    textureScale: 0.5,
    textureCap: 1024,
  },
  /**
   * 소프트웨어 렌더러와 진짜 낡은 기기용. **여기서만 그림자를 끈다.**
   * 그림자가 없으면 캐릭터가 바닥에서 떠 보이지만, 프레임이 안 나오는 것보다는 낫다.
   */
  minimum: {
    label: "최소",
    maxPixelRatio: 1.0,
    msaaSamples: 0,
    shadowEnabled: false,
    shadowMapSize: 512,
    shadowExtent: 20,
    bloomScale: 0.4,
    fxaa: false,
    textureScale: 0.5,
    textureCap: 512,
  },
}

/** 설정 UI가 보여줄 순서(낮음 → 높음). */
export const PRESET_ORDER: QualityPresetName[] = ["minimum", "low", "medium", "high", "ultra"]
/** 자동 감지가 고를 수 있는 범위. ultra 는 사용자가 직접 골라야 한다. */
const AUTO_ORDER: QualityPresetName[] = ["minimum", "low", "medium", "high"]

const LS_KEY = "arpg.quality"
const LS_AUTO = "arpg.quality.auto"

const listeners = new Set<(preset: QualityPreset) => void>()

let gpuString = ""
let glMaxTexSize = 16384
let resolved: QualityPresetName | null = null

/** `window` 없이도 import 되어야 한다 — 단위 테스트와 헤드리스 시나리오가 이 파일을 읽는다. */
function hasDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

function readStorage(key: string): string | null {
  try {
    return hasDom() ? window.localStorage.getItem(key) : null
  } catch {
    return null // 시크릿 모드·차단 설정에서 던진다. 조용히 auto 로 떨어진다.
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (hasDom()) window.localStorage.setItem(key, value)
  } catch { /* 저장 실패는 치명적이지 않다 */ }
}

function urlParam(name: string): string | null {
  try {
    return hasDom() ? new URLSearchParams(window.location.search).get(name) : null
  } catch {
    return null
  }
}

/**
 * 렌더러에서 GPU 문자열과 텍스처 상한을 뽑는다. `createRenderer` 가 딱 한 번 부른다.
 * 어떤 티어 소비자(post·render·텍스처 굽기)보다 **먼저** 불려야 한다.
 */
export function probeRenderer(renderer: THREE.WebGLRenderer): void {
  try {
    glMaxTexSize = renderer.capabilities.maxTextureSize || glMaxTexSize
  } catch { /* 능력 조회 실패는 기본값으로 간다 */ }
  try {
    const gl = renderer.getContext()
    // 최신 브라우저는 RENDERER 를 그대로 준다. 구형은 디버그 확장이 있어야 한다.
    const dbg = gl.getExtension("WEBGL_debug_renderer_info")
    const raw = dbg
      ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER)
    gpuString = String(raw ?? "")
  } catch { gpuString = "" }
  resolved = null // 새 정보가 들어왔으니 다시 판정한다
  if (hasDom()) console.info(`[quality] GPU: ${gpuString || "(가려짐)"} · maxTex ${glMaxTexSize}`)
}

/**
 * 하드웨어로부터 보수적인 상한을 고른다. `null` 이면 상한 없음(= high).
 *
 * **첫 줄이 우리가 실제로 당한 사고다.** 소프트웨어 래스터라이저는 어떤 설정으로도
 * 구제되지 않는다 — 최소 티어로 내리고 프레임을 사수한다.
 */
function heuristicCap(): QualityPresetName | null {
  const gpu = gpuString.toLowerCase()
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(gpu)) return "minimum"
  // 통합 그래픽 — 전용 GPU 급인 Arc·Iris Xe MAX 는 일부러 제외한다.
  const intelIntegrated = /intel/.test(gpu)
    && !/\b(?:arc|iris.*xe\s*max)\b/.test(gpu)
    && /\b(?:u?hd(?:\s+graphics)?|iris|graphics\s+[456]\d{2})\b/.test(gpu)
  const amdIntegrated = /(?:amd|radeon)/.test(gpu)
    && !/\bradeon\s+(?:rx|pro)\b/.test(gpu)
    && /\b(?:radeon(?:\(tm\))?\s+graphics|vega)\b/.test(gpu)
  const mobileGpu = /\b(mali|adreno|powervr|videocore)\b/.test(gpu)
  if (intelIntegrated || amdIntegrated || mobileGpu) return "medium"
  // 텍스처 상한이 4096 이면 GPU 가 좁다 — 데스크톱 UA 라도 믿지 않는다.
  if (glMaxTexSize <= 4096) return "medium"

  let mem: number | undefined
  let cores: number | undefined
  try {
    mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    cores = navigator.hardwareConcurrency
  } catch { /* 없으면 판단에서 뺀다 */ }
  if ((cores !== undefined && cores <= 2) || (mem !== undefined && mem <= 2)) return "low"
  if ((mem !== undefined && mem <= 4) || (cores !== undefined && cores <= 4)) return "medium"
  return null
}

/** 프레임 예산을 계속 놓쳐 자동 티어가 한 칸 내려간 기록. */
function storedAutoTier(): QualityPresetName | null {
  const v = readStorage(LS_AUTO)
  return v && (AUTO_ORDER as string[]).includes(v) ? (v as QualityPresetName) : null
}

/** 사용자가 고정한 선택. auto 가 기본이다. */
export function getStoredChoice(): QualityPresetName | "auto" {
  const forced = urlParam("quality")
  if (forced && (PRESET_ORDER as string[]).includes(forced)) return forced as QualityPresetName
  if (forced === "auto") return "auto"
  const v = readStorage(LS_KEY)
  if (v === "auto" || (v && (PRESET_ORDER as string[]).includes(v))) {
    return v as QualityPresetName | "auto"
  }
  return "auto"
}

/** auto 가 이 기기에서 무엇을 뜻하는지 판정한다. */
export function resolveAutoTier(): QualityPresetName {
  let tier: QualityPresetName = "high"
  for (const candidate of [heuristicCap(), storedAutoTier()]) {
    if (candidate && AUTO_ORDER.indexOf(candidate) < AUTO_ORDER.indexOf(tier)) tier = candidate
  }
  return tier
}

export function getPresetName(): QualityPresetName {
  if (resolved) return resolved
  const choice = getStoredChoice()
  resolved = choice === "auto" ? resolveAutoTier() : choice
  return resolved
}

export function getPreset(): QualityPreset {
  return PRESETS[getPresetName()]
}

/**
 * 티어를 바꾸고 구독자에게 알린다. 설정 UI가 부른다.
 * 명시적 선택은 자동 강등 기록을 지운다 — 나중에 auto 로 돌아가면 처음부터 다시 본다.
 */
export function setPresetName(name: QualityPresetName | "auto"): void {
  if (name !== "auto" && !PRESET_ORDER.includes(name)) return
  writeStorage(LS_KEY, name)
  if (name !== "auto") {
    try { if (hasDom()) window.localStorage.removeItem(LS_AUTO) } catch { /* ok */ }
  }
  resolved = null
  const preset = getPreset()
  for (const fn of listeners) fn(preset)
}

/**
 * 프레임 예산을 계속 못 맞출 때 자동 티어를 한 칸 내린다.
 * 사용자가 티어를 고정했거나 이미 바닥이면 아무것도 하지 않는다.
 * @returns 실제로 내렸으면 true
 */
export function reportSustainedOverload(): boolean {
  if (getStoredChoice() !== "auto") return false
  const cur = resolveAutoTier()
  const i = AUTO_ORDER.indexOf(cur)
  if (i <= 0) return false
  const next = AUTO_ORDER[i - 1]!
  writeStorage(LS_AUTO, next)
  resolved = null
  if (hasDom()) console.info(`[quality] 프레임 예산 초과가 계속됨 — 자동 티어 ${cur} → ${next}`)
  const preset = getPreset()
  for (const fn of listeners) fn(preset)
  return true
}

/** 티어 변경 구독. 해제 함수를 돌려준다. */
export function onPresetChange(fn: (preset: QualityPreset) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * **텍스처 해상도의 단일 창구.** 캔버스를 굽는 모든 곳이 원하는 크기를 여기 통과시킨다.
 * 티어 배율과 절대 상한, 그리고 실제 GL 상한까지 한 번에 적용된다 —
 * 어떤 텍스처도 기기가 감당 못 하는 크기로 만들어지지 않는다.
 */
export function texSize(px: number): number {
  const p = getPreset()
  return Math.max(1, Math.round(Math.min(px * p.textureScale, p.textureCap, glMaxTexSize)))
}

/** 테스트 전용 — 감지 상태를 초기화한다. */
export function _resetQualityForTest(gpu = "", maxTex = 16384): void {
  gpuString = gpu
  glMaxTexSize = maxTex
  resolved = null
}
