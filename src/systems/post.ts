import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { Pass } from "three/examples/jsm/postprocessing/Pass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import { FXAAPass } from "three/examples/jsm/postprocessing/FXAAPass.js"
import type { OutlineEffect } from "three/examples/jsm/effects/OutlineEffect.js"
import { THEME } from "../content/theme"

/**
 * 포스트 프로세싱 체인.
 *
 * 지금까지 우리 렌더 경로는 `renderer.render()` 한 줄이 전부였다. 참고한 레퍼런스
 * (Claude of Tanks, 같은 three@0.185)는 렌더러·조명·포스트를 독립 레이어로 두고
 * MSAA → AO → Bloom → SMAA → Output 을 태운다. 우리는 툰/밝은 룩이라 그중
 * **블룸과 SMAA 만** 가져온다.
 *
 *  - **블룸**: 등불·이펙트·발광 재질이 실제로 "빛나 보이게" 만든다. 마비노기 모바일
 *    계열의 부드러운 인상은 상당 부분 이것이다. HDR 선형 버퍼에서 임계값을 넘는
 *    픽셀만 번지므로, 밝은 바닥이 통째로 흐려지지 않는다.
 *  - **AA**: 컴포저를 태우면 컨텍스트 MSAA(`antialias: true`)는 최종 화면에 닿지 않는다.
 *    처음엔 SMAA 패스를 넣었는데 저각 갱도에서 16.1ms → 20.6ms 였다. 대신 컴포저
 *    타깃에 `samples: 4` 를 줘 래스터 단계에서 처리한다 — 풀스크린 패스가 늘지 않는다.
 *  - **AO(GTAO)는 넣지 않는다.** 사실적 렌더용이고 셀 셰이딩에서는 때가 낀 것처럼 보인다.
 *
 * 순서 규칙: OutputPass 가 ACES + sRGB 를 **마지막에** 적용한다. 그 앞의 모든 패스는
 * 선형 HDR 에서 돈다.
 */

/**
 * 씬을 그리는 첫 패스. three 기본 `RenderPass` 를 쓸 수 없다 —
 * 우리는 `OutlineEffect` 로 그려야 외곽선이 나오는데, 그건 렌더러 래퍼라서
 * `renderer.render` 대신 `outline.render` 를 불러야 한다.
 */
class OutlineRenderPass extends Pass {
  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly outline: OutlineEffect | null,
  ) {
    super()
    this.needsSwap = false
    this.clear = true
  }

  override render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const oldAutoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer)
    if (this.clear) renderer.clear(true, true, true)
    if (this.outline) this.outline.render(this.scene, this.camera)
    else renderer.render(this.scene, this.camera)
    renderer.autoClear = oldAutoClear
  }
}

let composer: EffectComposer | null = null
let bloomPass: UnrealBloomPass | null = null

/**
 * 체인을 만든다. 블룸이 꺼져 있으면 컴포저를 아예 만들지 않는다 —
 * 패스 하나짜리 컴포저는 풀스크린 복사만 늘리는 순수 손해다.
 */
export function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  outline: OutlineEffect | null,
): boolean {
  if (!THEME.bloom.enabled) return false

  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  // AA 는 SMAA(풀스크린 패스 3장) 대신 **컴포저 타깃의 MSAA** 로 처리한다.
  // SMAA 를 넣었을 때 저각 갱도에서 16.1ms → 20.6ms 였다. MSAA 는 래스터 단계에서
  // 처리되므로 풀스크린 패스가 늘지 않는다. 툰 룩은 외곽선이 핵심이라 기하 에지만
  // 잡아도 충분하고, 그건 정확히 MSAA 가 잘하는 일이다.
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType, // 선형 HDR — 블룸 임계값이 1을 넘는 픽셀만 잡으려면 필요하다
  })
  composer = new EffectComposer(renderer, target)
  composer.setSize(size.x, size.y)

  composer.addPass(new OutlineRenderPass(scene, camera, outline))

  bloomPass = new UnrealBloomPass(
    size.clone(),
    THEME.bloom.strength,
    THEME.bloom.radius,
    THEME.bloom.threshold,
  )
  composer.addPass(bloomPass)

  // ACES + sRGB 는 여기서 한 번에 적용된다.
  composer.addPass(new OutputPass())
  // AA 는 마지막. FXAA 는 sRGB 공간에서 도므로 OutputPass **뒤**여야 한다.
  if (THEME.bloom.fxaa) composer.addPass(new FXAAPass())
  return true
}

export function hasPostChain(): boolean {
  return composer !== null
}

export function renderPost(): void {
  composer?.render()
}

export function resizePost(width: number, height: number): void {
  composer?.setSize(width, height)
  bloomPass?.setSize(width, height)
}

/** 존을 옮기거나 테마를 바꿀 때 초기화한다. */
export function disposePostChain(): void {
  composer?.dispose()
  composer = null
  bloomPass = null
}
