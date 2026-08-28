import type { EnemyKind } from "../core/world"

/**
 * 적 외형 스펙 — "적이 다 똑같이 생겼다" 를 고치는 데이터.
 *
 * 문제의 실체는 근접·원거리·보스가 전부 KayKit **스켈레톤 계열 한 세트**라
 * 실루엣이 거의 같다는 것이다. 모델을 더 살 수는 없지만, 레퍼런스
 * (Claude of Tanks)가 전차 112종을 **하나의 팩토리 + 스펙 레코드**로 만든 방식이
 * 그대로 적용된다: 공용 모델에 **비율·색·덧붙임(장식)** 세 축만 달리 주면
 * 사람은 다른 종류로 읽는다.
 *
 * 실루엣이 색보다 먼저다 — 어두운 던전에서 색은 뭉개져도 형태는 남는다.
 * 그래서 `heightScale` / `girth` / `decor` 를 먼저 갈라 두고 색은 마지막에 얹는다.
 */

export type EnemyDecor =
  /** 어깨 견갑 — 넓고 각진 위쪽 실루엣. 앞을 막는 놈. */
  | "pauldrons"
  /** 등 화살통 — 위로 삐죽한 선 몇 개. 뒤에서 쏘는 놈. */
  | "quiver"
  /** 뿔투구 — 앞으로 기운 두 뿔. 달려드는 놈. */
  | "horns"
  /** 왕관 — 보스. */
  | "crown"

export interface EnemyLook {
  /** 기준 키(1.7)에 곱한다. 실루엣을 가르는 가장 강한 축이다. */
  heightScale: number
  /** 가로 배율. 1보다 크면 떡 벌어지고, 작으면 홀쭉하다. */
  girth: number
  /** 몸 색조. 모델 머티리얼에 곱한다 — 복제하지 않는다. */
  tint: number
  /** 덧붙이는 장식. 실루엣의 윗부분을 바꾼다. */
  decor: EnemyDecor
  /** 장식 색. 몸과 대비되어야 형태가 읽힌다. */
  decorTint: number
  note: string
}

export const ENEMY_LOOKS: Record<EnemyKind, EnemyLook> = {
  warrior: {
    heightScale: 1.02, girth: 1.22, tint: 0x9fb4c8, decor: "pauldrons", decorTint: 0x4a6076,
    note: "철위병 — 낮고 넓다. 길을 막는 벽처럼 보여야 한다",
  },
  archer: {
    heightScale: 1.06, girth: 0.82, tint: 0xbfd0a8, decor: "quiver", decorTint: 0x6b5434,
    note: "궁수 — 키가 크고 홀쭉하다. 등에 화살통이 삐죽하다",
  },
  charger: {
    heightScale: 0.92, girth: 1.1, tint: 0xd99a86, decor: "horns", decorTint: 0x8c3a2a,
    note: "돌격병 — 낮게 웅크리고 뿔이 앞으로 기울었다. 달려온다는 게 형태로 보여야 한다",
  },
  boss: {
    heightScale: 1.55, girth: 1.35, tint: 0xb08ac0, decor: "crown", decorTint: 0xffd15c,
    note: "보스 — 압도적으로 크다. 크기 자체가 첫 번째 경고다",
  },
}

/**
 * 정예 — 같은 종류의 강화판. 종류를 바꾸지 않고 **한 단계 크고 진하게** 만든다.
 * 완전히 다른 모습으로 만들면 새 몹으로 오해한다. "저건 저놈인데 세다" 로 읽혀야 한다.
 */
export const ELITE_MODIFIER = {
  heightScale: 1.18,
  girth: 1.12,
  /** 몸 색조에 곱한다. 어두워지면서 채도가 오른다. */
  tintScale: 0.82,
  /** 발밑 고리 — 정예임을 알리는 유일한 추가 요소. */
  ringColor: 0xffc24a,
  ringRadius: 0.95,
} as const
