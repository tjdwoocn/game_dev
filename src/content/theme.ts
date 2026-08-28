/**
 * 아트 방향 팔레트 — 게임의 "분위기" 를 한곳에 모은다.
 *
 * 초기 프로토타입은 디아블로풍 어둠이었다: 거의 검은 배경(0x07070c)에 안개를 18~46 으로
 * 바짝 당기고, 환경광을 0.7 로 죽인 뒤 플레이어 횃불 하나로만 주변을 밝혔다.
 * 그 결과 횃불 반경 밖은 완전한 검정이 되어, 지금의 캐릭터 모델이 실제로는
 * 3등신 아기자기한 형태인데도 화면에서는 어둡고 칙칙하게만 보였다.
 *
 * 목표 스타일이 마비노기 모바일·테일즈위버 쪽 밝은 톤으로 바뀌면서 조명 상수를 여기로 옮겼다.
 * 분위기를 조정할 때 렌더 코드를 뒤질 필요가 없게 하려는 것이다.
 *
 * **밝은 톤에서 무엇이 달라지는가**
 *   - 하늘/바닥 두 방향에서 오는 반구광(hemisphere)이 기본 밝기를 만든다.
 *     한 방향 directional 만 쓰면 그림자 쪽이 새까매져서 다시 어두워진다.
 *   - 안개를 멀리 밀고 색을 배경과 맞춘다. 안개가 가까우면 "좁고 답답한" 인상이 남는다.
 *   - 플레이어 횃불은 지우지 않고 약하게 남긴다. 완전히 빼면 캐릭터가 배경에 묻힌다.
 */

export interface ArtTheme {
  /** 화면 바탕색. 안개 색과 같아야 지평선이 끊겨 보이지 않는다. */
  background: number
  fog: { color: number; near: number; far: number }
  /** 하늘색·바닥 반사색 두 방향에서 오는 기본 밝기. */
  hemisphere: { sky: number; ground: number; intensity: number }
  /** 형태를 드러내는 주광. 너무 세면 대비가 강해져 다크해진다. */
  directional: { color: number; intensity: number; position: [number, number, number] }
  /** 플레이어를 배경에서 띄우는 보조광. */
  playerLight: { color: number; intensity: number; distance: number; decay: number }
  /** 던전 킷이 없을 때 쓰는 폴백 지오메트리 색. */
  fallback: { floor: number; wall: number }
  /**
   * 툰(셀) 셰이딩 — 마비노기 모바일·테일즈위버 계열 룩의 핵심.
   * PBR 은 빛을 연속적으로 굴려 "사실적" 으로 보이게 하고, 툰은 명암을 몇 단계로 끊어
   * 그림처럼 보이게 한다. 같은 모델이라도 이 차이만으로 인상이 크게 갈린다.
   */
  toon: {
    enabled: boolean
    /** 명암 단계 수. 적을수록 만화적, 많을수록 부드럽다. 3~4 가 무난하다. */
    steps: number
    /**
     * 가장 어두운 단계의 밝기(0~1). 0 이면 그림자가 새까매져 애써 밝힌 톤이 다시 죽는다.
     * 밝고 아기자기한 톤에서는 그림자도 밝게 떠 있어야 한다.
     */
    shadowFloor: number
  }
  /** 캐릭터 실루엣을 또렷하게 만드는 외곽선. 셀 셰이딩과 짝을 이룬다. */
  outline: { enabled: boolean; color: number; thickness: number; alpha: number }
  /**
   * 접지 그림자. **이걸 켜기 전까지 이 게임에는 그림자가 하나도 없었다.**
   * 캐릭터가 바닥에 붙어 있지 않고 떠 보이는 가장 큰 원인이었다.
   *
   * 태양광 하나로 던전 전체를 덮으면 그림자 텍셀이 낭비된다. 광원을 플레이어를
   * 따라 옮기고 직교 절두체를 `extent` 만큼만 잡는다 — 화면에 보이는 범위만 덮으면 된다.
   * `texelSnap` 은 광원이 움직일 때 그림자 경계가 지글거리는 것을 막는다.
   */
  shadow: {
    enabled: boolean
    /** 그림자 카메라 반경(월드 유닛). 화면에 들어오는 범위보다 조금 넓게. */
    extent: number
    /** 그림자 맵 해상도. 2048 이면 이 규모에서 텍셀이 충분히 곱다. */
    mapSize: number
    /** 그림자 여드름(shadow acne) 방지. 표면에 줄무늬가 보이면 키운다. */
    bias: number
    normalBias: number
    /** PCF 흐림 반경. 툰 룩에서는 너무 딱딱한 그림자가 어울리지 않는다. */
    radius: number
  }
  /**
   * 톤 매핑. ACES 는 밝은 부분이 흰색으로 뭉개지는 것을 막아 색이 남는다.
   * 노출은 스타일에 맞춰 조정한다 — 밝고 아기자기한 톤이므로 1 보다 살짝 위.
   */
  tone: { exposure: number }
  /**
   * 블룸. 등불·이펙트·발광 재질이 실제로 "빛나 보이게" 만든다.
   * 마비노기 모바일 계열의 부드러운 인상은 상당 부분 이것이다.
   * threshold 는 HDR 선형 버퍼 기준이라 1 을 넘는 픽셀만 번진다.
   */
  bloom: { enabled: boolean; strength: number; radius: number; threshold: number; fxaa: boolean }
}

/** 밝고 아기자기한 톤 — 현재 사용 중. */
export const BRIGHT_THEME: ArtTheme = {
  background: 0xa8c8d8,
  fog: { color: 0xa8c8d8, near: 45, far: 130 },
  // ACES 톤 매핑이 들어오기 전에 맞춘 값(2.1)은 과했다. 톤 매핑이 없을 땐 1을 넘는
  // 값이 그냥 잘려서 안 보였는데, ACES 를 태우니 화면 전체가 블룸 임계값 위로 떠올랐다.
  // 반구광을 낮추고 주광을 올려 **형태가 드러나게** 한다 — 채우기광이 세면 납작해진다.
  hemisphere: { sky: 0xfff4e0, ground: 0x9a8570, intensity: 0.95 },
  // 고도를 낮춰야 그림자가 길어져 눈에 들어온다. 처음엔 [6,12,4](고도 59도)였는데
  // 그림자가 물체 바로 밑에 깔려 켜 놓고도 보이지 않았다. 지금은 약 34도.
  directional: { color: 0xfff0d4, intensity: 2.4, position: [9, 6.5, 5] },
  playerLight: { color: 0xffd8a0, intensity: 7, distance: 15, decay: 1.7 },
  fallback: { floor: 0xb59a78, wall: 0x8d8f9c },
  toon: { enabled: true, steps: 3, shadowFloor: 0.52 },
  outline: { enabled: true, color: 0x3f3129, thickness: 0.004, alpha: 0.8 },
  shadow: { enabled: true, extent: 26, mapSize: 2048, bias: -0.0006, normalBias: 0.035, radius: 3 },
  tone: { exposure: 1.08 },
  // threshold 를 처음 0.82 로 잡았더니 일반 조명면까지 번져 캐릭터 머리가 하얗게 날아갔다.
  // 레퍼런스(Claude of Tanks)는 1.78 이다 — HDR 선형 버퍼에서 1을 확실히 넘는 픽셀만
  // 잡겠다는 뜻이다. 우리는 밝은 톤이라 그보다는 낮게, 그러나 1은 넘겨 잡는다.
  bloom: { enabled: true, strength: 0.34, radius: 0.5, threshold: 1.8, fxaa: true },
}

/** 최초 프로토타입의 디아블로풍 어둠. 되돌려 비교할 때 쓴다. */
export const DARK_THEME: ArtTheme = {
  background: 0x07070c,
  fog: { color: 0x07070c, near: 18, far: 46 },
  hemisphere: { sky: 0x2a2a3a, ground: 0x101018, intensity: 0.7 },
  directional: { color: 0x8888aa, intensity: 0.35, position: [5, 10, 2] },
  playerLight: { color: 0xffa050, intensity: 60, distance: 20, decay: 1.8 },
  fallback: { floor: 0x4a4038, wall: 0x2b2b33 },
  toon: { enabled: false, steps: 3, shadowFloor: 0 },
  outline: { enabled: false, color: 0x000000, thickness: 0.003, alpha: 1 },
  shadow: { enabled: true, extent: 26, mapSize: 2048, bias: -0.0006, normalBias: 0.035, radius: 3 },
  tone: { exposure: 1 },
  bloom: { enabled: true, strength: 0.55, radius: 0.7, threshold: 0.7, fxaa: true },
}

export const THEME: ArtTheme = BRIGHT_THEME
