/**
 * 피격 방향 표시기.
 *
 * 참고한 레퍼런스(Claude of Tanks)의 HUD 계약에 `hit direction indicator` 가 있다.
 * 우리 게임은 카메라가 좁아 **화면 밖에서 날아온 화살**에 맞으면 어디서 맞았는지 알 수 없다.
 * 원거리 적이 세 마리씩 나오는 지금은 더 그렇다.
 *
 * 화면 가장자리에 호를 하나 띄운다. 화살표보다 호가 낫다 — 방향은 정확히 알려 주면서
 * 시선을 뺏지 않는다.
 *
 * **공격자 위치는 넉백 방향에서 얻는다.** 피격 이벤트에는 공격자 정보가 없지만,
 * 맞으면 공격자 반대쪽으로 밀리므로 `-knockback.dir` 이 곧 공격자 방향이다.
 * 전투 시스템에 인자를 추가하지 않고도 정확한 값을 얻을 수 있다.
 */

const LIFE_MS = 1100
const MAX = 4

interface Mark {
  el: HTMLElement
  until: number
}

let layer: HTMLElement | null = null
const marks: Mark[] = []

function ensureLayer(): HTMLElement | null {
  if (typeof document === "undefined") return null
  if (layer) return layer
  layer = document.createElement("div")
  layer.id = "hit-dir"
  document.body.appendChild(layer)
  return layer
}

/**
 * @param yaw 공격자가 있는 방향(라디안). 월드 기준 `atan2(dx, dz)`.
 *            카메라가 회전하지 않으므로 화면 기준과 고정 대응한다.
 * @param power 0~1. 세게 맞을수록 진하다.
 */
export function showHitDirection(yaw: number, power = 1): void {
  const root = ensureLayer()
  if (!root) return

  // 가장 오래된 것부터 지워 화면이 호로 뒤덮이지 않게 한다
  while (marks.length >= MAX) {
    const old = marks.shift()
    old?.el.remove()
  }

  const el = document.createElement("div")
  el.className = "hit-dir-arc"
  // 월드 yaw(=+Z 기준) → 화면 회전. +Z 는 화면 아래쪽이므로 180도 돌린다.
  el.style.transform = `rotate(${(yaw * 180) / Math.PI + 180}deg)`
  el.style.opacity = String(Math.min(1, 0.45 + power * 0.55))
  root.appendChild(el)
  marks.push({ el, until: performance.now() + LIFE_MS })
}

/** 수명이 다한 표식을 지운다. 매 프레임 부른다. */
export function updateHitDirection(): void {
  if (marks.length === 0) return
  const now = performance.now()
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]!
    if (now >= m.until) {
      m.el.remove()
      marks.splice(i, 1)
    } else {
      const t = 1 - (m.until - now) / LIFE_MS
      m.el.style.opacity = String(Math.max(0, (1 - t) * 0.9))
    }
  }
}

/** 존을 옮길 때 남은 표식을 정리한다. */
export function clearHitDirection(): void {
  for (const m of marks) m.el.remove()
  marks.length = 0
}
