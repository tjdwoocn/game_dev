import { TILE } from "../content/map"
import type { Entity } from "../core/world"
import type { CombatEventKind } from "../systems/combatEvents"
import type { Game } from "./headless"
import { livingEnemies, type TimedEvent } from "./run"

/**
 * 텍스트 렌더러 — 시뮬레이션 상태를 사람이 읽는 글자로 바꾼다.
 *
 * 3D 화면은 "무슨 일이 일어났는지" 를 확인하는 데 느리다. 브라우저를 띄우고, 걸어가고,
 * 스크린샷을 찍고, 눈으로 본다. 텍스트는 즉시 읽히고 diff 가 되고 테스트에 넣을 수 있다.
 * 전투 **로직**을 다듬는 동안에는 이쪽이 훨씬 빠르다.
 *
 * 이벤트 문구는 `combatEvents` 가 내보내는 것과 1:1이다 — 소리·이펙트·텍스트가
 * 같은 신호에서 나오므로, 텍스트에 안 찍히면 소리도 안 난다는 뜻이 된다.
 */

const EVENT_TEXT: Record<CombatEventKind, string> = {
  swing: "휘두른다",
  hit: "명중",
  hitHeavy: "급소 명중",
  crit: "치명타",
  enemyDeath: "쓰러뜨렸다",
  playerHurt: "피격",
  lootDrop: "전리품이 떨어졌다",
  lootPickup: "전리품 획득",
  breakOpen: "약점 노출",
  breakSuccess: "무력화 성공",
  propBreak: "소품 파괴",
  levelUp: "레벨 업",
  dash: "돌진",
  whirlwind: "회전베기",
  skillWindup: "스킬 준비",
  skillRelease: "스킬 발동",
  bossTelegraph: "보스가 자세를 잡는다",
}

function who(e: Entity | undefined): string {
  if (!e) return ""
  if (e.player) return "나"
  if (e.boss) return "보스"
  if (e.enemy) return `${e.enemy.kind}#${shortId(e)}`
  if (e.companion) return e.companion.name
  return "?"
}

const ids = new WeakMap<object, number>()
let nextId = 1
function shortId(e: Entity): number {
  let id = ids.get(e as object)
  if (id === undefined) { id = nextId++; ids.set(e as object, id) }
  return id
}

/** 이벤트 한 줄. 시각은 게임 시간(히트스톱이 반영된 시간)이다. */
export function formatEvent(_game: Game, evt: TimedEvent): string {
  const t = evt.t.toFixed(2).padStart(6)
  const subject = who(evt.entity)
  const label = EVENT_TEXT[evt.kind]
  const hp = evt.hpAt !== undefined ? ` (${evt.hpAt}/${evt.hpMax})` : ""
  return `[${t}] ${label}${subject ? ` · ${subject}` : ""}${hp}`
}

/** 현재 상태 한 줄. */
export function statusLine(game: Game): string {
  const p = game.player
  const pc = p.player!
  const pos = p.transform!.position
  const enemies = livingEnemies(game)
  return [
    `존 ${game.res.zoneId}`,
    `HP ${Math.round(p.health!.current)}/${p.health!.max}`,
    `분노 ${Math.round(pc.rage)}`,
    `Lv.${pc.level}`,
    `위치 (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`,
    `적 ${enemies.length}`,
    `인벤 ${pc.inventory.length}`,
  ].join(" · ")
}

/**
 * ASCII 지도. 격자 한 칸이 한 글자다.
 *   `#` 벽  `·` 통로  `@` 나  `w` 근접  `a` 원거리  `c` 돌격  `B` 보스
 *   대문자 = 정예   `+` 동료   `$` 전리품
 *
 * `radius` 를 주면 플레이어 주변만 잘라 낸다 — 30×30 맵 전체는 로그에서 너무 크다.
 */
export function asciiMap(game: Game, radius = 10): string {
  const map = game.res.map
  const p = game.player.transform!.position
  const pc = Math.round(p.x / TILE)
  const pr = Math.round(p.z / TILE)
  const c0 = Math.max(0, pc - radius)
  const c1 = Math.min(map.cols - 1, pc + radius)
  const r0 = Math.max(0, pr - radius)
  const r1 = Math.min(map.rows - 1, pr + radius)

  const glyphs = new Map<string, string>()
  const put = (x: number, z: number, ch: string) => {
    glyphs.set(`${Math.round(x / TILE)},${Math.round(z / TILE)}`, ch)
  }
  for (const e of game.world.with("lootDrop", "transform")) put(e.transform.position.x, e.transform.position.z, "$")
  for (const e of game.world.with("companion", "transform")) if (!e.dead) put(e.transform.position.x, e.transform.position.z, "+")
  // 정예는 대문자로. 종류가 아니라 수식어이므로 글자를 바꾸지 않고 크기만 바꾼다.
  const GLYPH: Record<string, string> = { warrior: "w", archer: "a", charger: "c", boss: "B" }
  for (const e of livingEnemies(game)) {
    const ch = GLYPH[e.enemy!.kind] ?? "?"
    put(e.transform!.position.x, e.transform!.position.z, e.enemy!.isElite ? ch.toUpperCase() : ch)
  }
  put(p.x, p.z, "@")

  const lines: string[] = []
  for (let r = r0; r <= r1; r++) {
    let line = ""
    for (let c = c0; c <= c1; c++) {
      line += glyphs.get(`${c},${r}`) ?? (map.walls[r]?.[c] ? "#" : "·")
    }
    lines.push(line)
  }
  return lines.join("\n")
}

/**
 * 시나리오 기록기 — 한 판을 통째로 글로 남긴다.
 * 테스트에서 스냅샷으로 비교하거나, 콘솔에 그대로 뿌려 읽는다.
 */
export class Transcript {
  readonly lines: string[] = []
  constructor(private readonly game: Game) {}

  say(text: string): void {
    this.lines.push(text)
  }

  /** 장면 구분. */
  scene(title: string): void {
    this.lines.push("", `── ${title} ${"─".repeat(Math.max(0, 46 - title.length))}`)
  }

  events(list: TimedEvent[]): void {
    for (const e of list) this.lines.push(formatEvent(this.game, e))
  }

  status(): void {
    this.lines.push(`   ${statusLine(this.game)}`)
  }

  map(radius = 8): void {
    this.lines.push(asciiMap(this.game, radius).split("\n").map((l) => `   ${l}`).join("\n"))
  }

  toString(): string {
    return this.lines.join("\n")
  }
}
