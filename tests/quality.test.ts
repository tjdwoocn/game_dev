import { beforeEach, describe, expect, it } from "vitest"
import {
  PRESETS,
  PRESET_ORDER,
  _resetQualityForTest,
  getPreset,
  getPresetName,
  resolveAutoTier,
  texSize,
  type QualityPresetName,
} from "../src/systems/quality"

/**
 * 품질 티어 — 사다리가 실제로 단조로운지, 그리고 우리를 물었던 경우를 잡는지.
 *
 * 이 파일은 `window` 없는 환경에서 돈다. 티어 모듈이 DOM 을 건드리면 여기서 먼저 깨진다 —
 * 헤드리스 시나리오와 단위 테스트가 이 모듈을 import 하기 때문이다.
 */

beforeEach(() => { _resetQualityForTest() })

describe("품질 사다리", () => {
  it("DOM 없이도 기본 티어를 준다", () => {
    // 헤드리스에서 localStorage·navigator·location 이 전부 없다. 던지면 안 된다.
    expect(() => getPreset()).not.toThrow()
    expect(getPresetName()).toBe("high")
  })

  it("비용 레버가 티어 순서대로 단조 증가한다", () => {
    // 사다리에 역전이 있으면 "낮음" 이 "보통" 보다 비싼 상황이 생긴다.
    let prevPixel = 0
    let prevShadow = 0
    let prevBloom = 0
    for (const name of PRESET_ORDER) {
      const p = PRESETS[name]
      expect(p.maxPixelRatio, `${name} 픽셀 비율 역전`).toBeGreaterThanOrEqual(prevPixel)
      expect(p.shadowMapSize, `${name} 그림자 맵 역전`).toBeGreaterThanOrEqual(prevShadow)
      expect(p.bloomScale, `${name} 블룸 배율 역전`).toBeGreaterThanOrEqual(prevBloom)
      prevPixel = p.maxPixelRatio
      prevShadow = p.shadowMapSize
      prevBloom = p.bloomScale
    }
  })

  it("어떤 티어에서도 블룸을 끄지 않는다", () => {
    // 발광은 이 게임의 룩이다. 티어는 곱기를 깎을 뿐 존재 여부를 건드리지 않는다.
    for (const name of PRESET_ORDER) {
      expect(PRESETS[name]!.bloomScale, `${name} 에서 블룸이 꺼졌다`).toBeGreaterThan(0)
    }
  })

  it("그림자는 최하 티어에서만 꺼진다", () => {
    // 접지감이 통째로 사라지는 레버라 아무 데서나 쓰면 안 된다.
    const off = PRESET_ORDER.filter((n) => !PRESETS[n]!.shadowEnabled)
    expect(off).toEqual(["minimum"])
  })
})

describe("자동 감지", () => {
  /** 감지 입력을 심고 티어를 판정한다. */
  function tierFor(gpu: string, maxTex = 16384): QualityPresetName {
    _resetQualityForTest(gpu, maxTex)
    return resolveAutoTier()
  }

  it("소프트웨어 렌더러를 최소 티어로 내린다", () => {
    // **이게 실제로 우리를 물었던 경우다.** 헤드리스가 SwiftShader 로 붙는 걸 몰라서
    // 프레임을 350~430ms 로 재고 "밀도 불가" 로 결론 낼 뻔했다. GPU 를 붙이니 32ms 였다.
    expect(tierFor("Google SwiftShader")).toBe("minimum")
    expect(tierFor("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe("minimum")
    expect(tierFor("Microsoft Basic Render Driver")).toBe("minimum")
  })

  it("통합 그래픽을 보통으로 내린다", () => {
    expect(tierFor("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)")).toBe("medium")
    expect(tierFor("ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics)")).toBe("medium")
    expect(tierFor("ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)")).toBe("medium")
    expect(tierFor("Mali-G78")).toBe("medium")
  })

  it("전용 GPU 는 내리지 않는다", () => {
    expect(tierFor("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)")).toBe("high")
    expect(tierFor("ANGLE (AMD, AMD Radeon RX 7900 XTX Direct3D11)")).toBe("high")
    // Arc 와 Iris Xe MAX 는 전용 GPU 급이라 통합 판정에서 일부러 뺐다.
    expect(tierFor("ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics)")).toBe("high")
  })

  it("텍스처 상한이 좁으면 데스크톱 문자열이라도 믿지 않는다", () => {
    // maxTextureSize 4096 은 데스크톱 UA 를 쓰는 좁은 GPU 의 확실한 표식이다.
    expect(tierFor("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)", 4096)).toBe("medium")
  })
})

describe("텍스처 창구", () => {
  it("높은 티어에서는 원본 크기를 그대로 준다", () => {
    _resetQualityForTest()
    expect(texSize(64)).toBe(64)
    expect(texSize(128)).toBe(128)
  })

  it("GL 상한을 절대 넘지 않는다", () => {
    // 기기가 감당 못 하는 텍스처를 만들면 컨텍스트가 날아간다.
    _resetQualityForTest("NVIDIA GeForce RTX 4070", 256)
    expect(texSize(2048)).toBeLessThanOrEqual(256)
  })

  it("항상 1 이상을 준다", () => {
    _resetQualityForTest("Google SwiftShader", 16384)
    expect(texSize(1)).toBeGreaterThanOrEqual(1)
  })
})
