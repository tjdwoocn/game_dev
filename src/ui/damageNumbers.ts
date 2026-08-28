import * as THREE from "three"
import type { Resources } from "../core/world"
import type { CombatEvent, CombatEventKind } from "../systems/combatEvents"

/**
 * 피해 숫자 — 얼마나 들어갔는지 화면에서 읽힌다.
 *
 * **왜 이제야 붙는가.** 지금까지 이벤트에는 "맞았다" 만 있고 **얼마나** 가 없었다.
 * S1 의 `damageResolved` 가 `amount` 와 `critical` 을 처음 실어 주면서 붙일 수 있게 됐다.
 *
 * **왜 DOM 인가.** 숫자는 카메라 거리와 무관하게 항상 같은 크기로 읽혀야 한다.
 * 월드 공간 스프라이트로 만들면 줌아웃에서 뭉개지고 줌인에서 화면을 덮는다.
 * 월드 좌표를 화면 좌표로 투영해 HUD 위에 얹는다.
 *
 * **왜 풀링하는가.** 전투 밀도가 높으면 초당 수십 개가 태어난다.
 * `combatVfx` 와 같은 이유로 처음에 만들어 두고 재사용한다 — 워밍업 이후 할당 0.
 *
 * 시간은 `res.time.now`(게임 시간)를 쓴다. 히트스톱이 걸리면 숫자도 같이 멈춰
 * 정지 프레임에 그대로 머문다 — 이펙트와 어긋나지 않는다.
 */

interface Style {
  /** 글자 크기(px). 세기의 1차 신호다 — 색보다 크기가 먼저 읽힌다. */
  size: number
  color: string
  /** 어두운 바닥 위에서도 읽히도록 두르는 외곽선 */
  shadow: string
  life: number
  /** 위로 떠오르는 거리(px) */
  rise: number
  weight: number
}

const STYLE: Partial<Record<CombatEventKind, Style>> = {
  hit: {
    size: 17, color: "#ffd9a8", shadow: "0 0 3px rgba(0,0,0,0.95)",
    life: 0.62, rise: 42, weight: 600,
  },
  hitHeavy: {
    size: 23, color: "#ffe89a", shadow: "0 0 4px rgba(0,0,0,0.95)",
    life: 0.76, rise: 54, weight: 700,
  },
  /**
   * 치명타 — 가장 크고 가장 밝다. 흰색에 가까운 금색으로 두고 외곽에 빛을 준다.
   * 일반 타격과 **크기부터** 달라야 한다(17 → 30). 색만 바꾸면 난전에서 안 읽힌다.
   */
  crit: {
    size: 30, color: "#fff6d0", shadow: "0 0 6px rgba(255,180,60,0.9), 0 0 3px rgba(0,0,0,0.95)",
    life: 0.9, rise: 68, weight: 800,
  },
  /** 내가 맞은 피해. 붉게, 그리고 확실히 크게 — 위험은 놓치면 안 된다. */
  playerHurt: {
    size: 25, color: "#ff8a78", shadow: "0 0 4px rgba(0,0,0,0.95)",
    life: 0.8, rise: 50, weight: 700,
  },
}

const POOL_SIZE = 24
/** 숫자가 정확히 겹쳐 한 덩어리로 보이지 않도록 주는 좌우 흔들림(px) */
const JITTER = 26

interface Slot {
  el: HTMLElement
  active: boolean
  start: number
  life: number
  rise: number
  /** 발행 시점의 월드 좌표. 대상이 죽거나 밀려나도 숫자는 그 자리에 남는다. */
  world: THREE.Vector3
  offsetX: number
  baseSize: number
}

let container: HTMLElement | null = null
const pool: Slot[] = []
const projected = new THREE.Vector3()

function ensurePool(): boolean {
  if (container) return true
  if (typeof document === "undefined") return false // 헤드리스에서는 조용히 비활성

  container = document.createElement("div")
  container.id = "damage-numbers"
  // 클릭 이동을 막으면 안 된다 — 숫자는 순수 표시물이다.
  container.style.cssText =
    "position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:6;"
  document.body.appendChild(container)

  for (let i = 0; i < POOL_SIZE; i++) {
    const el = document.createElement("div")
    el.style.cssText =
      "position:absolute;left:0;top:0;font-family:inherit;font-variant-numeric:tabular-nums;" +
      "white-space:nowrap;will-change:transform,opacity;opacity:0;visibility:hidden;"
    container.appendChild(el)
    pool.push({
      el, active: false, start: 0, life: 0, rise: 0,
      world: new THREE.Vector3(), offsetX: 0, baseSize: 16,
    })
  }
  return true
}

/** 가장 오래된 슬롯을 재사용한다. 풀이 꽉 차도 새 숫자가 조용히 사라지지 않는다. */
function take(): Slot {
  let oldest = pool[0]!
  for (const s of pool) {
    if (!s.active) return s
    if (s.start < oldest.start) oldest = s
  }
  return oldest
}

export function spawnDamageNumber(res: Resources, evt: CombatEvent): void {
  const style = STYLE[evt.kind]
  if (!style || !evt.at || evt.amount === undefined) return
  if (!ensurePool()) return

  // 반올림해서 0 이 되는 피해는 띄우지 않는다 — "0" 이 뜨면 안 맞은 것처럼 읽힌다.
  const shown = Math.max(1, Math.round(evt.amount))

  const s = take()
  s.active = true
  s.start = res.time.now
  s.life = style.life
  s.rise = style.rise
  s.baseSize = style.size
  s.offsetX = (res.rng() - 0.5) * JITTER
  // 발 밑이 아니라 몸통 위에서 뜬다. 캐릭터에 가려지면 숫자가 반쯤 잘린다.
  s.world.set(evt.at.x, evt.at.y + 1.65, evt.at.z)

  s.el.textContent = evt.kind === "crit" ? `${shown}!` : `${shown}`
  s.el.style.color = style.color
  s.el.style.textShadow = style.shadow
  s.el.style.fontWeight = String(style.weight)
  s.el.style.visibility = "visible"
  return
}

export function updateDamageNumbers(res: Resources): void {
  if (!container) return
  const now = res.time.now
  const w = res.renderer.domElement.clientWidth
  const h = res.renderer.domElement.clientHeight

  for (const s of pool) {
    if (!s.active) continue
    const t = (now - s.start) / s.life
    if (t >= 1 || t < 0) {
      s.active = false
      s.el.style.visibility = "hidden"
      s.el.style.opacity = "0"
      continue
    }

    projected.copy(s.world).project(res.camera)
    // 카메라 뒤로 넘어간 좌표는 화면 앞쪽으로 되접혀 엉뚱한 곳에 찍힌다.
    if (projected.z > 1) {
      s.el.style.visibility = "hidden"
      continue
    }
    s.el.style.visibility = "visible"

    const x = (projected.x * 0.5 + 0.5) * w + s.offsetX
    const y = (-projected.y * 0.5 + 0.5) * h - s.rise * (1 - (1 - t) * (1 - t)) // ease-out 상승

    // 태어날 때 살짝 크게 튀었다가 제 크기로 앉는다 — 타격의 순간을 강조한다.
    const punch = t < 0.14 ? 1 + (1 - t / 0.14) * 0.35 : 1
    s.el.style.fontSize = `${s.baseSize}px`
    s.el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) scale(${punch.toFixed(3)})`
    // 끝까지 또렷하다가 마지막 35% 구간에서만 사라진다. 일찍 옅어지면 못 읽는다.
    s.el.style.opacity = t < 0.65 ? "1" : String(Math.max(0, (1 - t) / 0.35))
  }
}

/** 존을 옮기면 이전 맵의 숫자가 남아 있으면 안 된다. */
export function clearDamageNumbers(): void {
  for (const s of pool) {
    s.active = false
    s.el.style.visibility = "hidden"
    s.el.style.opacity = "0"
  }
}
