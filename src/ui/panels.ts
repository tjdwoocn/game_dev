import { PLANNED_SKILL_UNLOCKS, SKILLS, SKILL_UNLOCKS } from "../content/skills"
import { xpForLevel } from "../systems/progression"
import type { Affix, GameWorld, ItemInstance, PlayerComp, Slot } from "../core/world"

/**
 * 상태창(C) · 스킬창(K).
 *
 * 지금까지 화면에서 알 수 있는 건 체력·분노·경험치 막대뿐이었다. 공격력이 얼마인지,
 * 뭘 끼고 있는지, 다음 레벨에 뭐가 열리는지 볼 방법이 없었다.
 * 아이템을 먹어도 **뭐가 좋아졌는지 안 보이면** 보상이 성립하지 않는다.
 *
 * 두 창은 같은 틀을 쓴다 — 여닫는 방식과 생김새가 다르면 배우는 게 두 배가 된다.
 * 게임은 열려 있는 동안에도 계속 돌아간다(정지 없음). 그래서 반투명하고 한쪽에 붙는다.
 */

const SLOT_LABEL: Record<Slot, string> = { weapon: "무기", armor: "갑옷", ring: "반지" }
const STAT_LABEL: Record<Affix["stat"], string> = {
  attackPower: "공격력",
  maxHp: "최대 체력",
  moveSpeedPct: "이동 속도",
  critChance: "치명타 확률",
  critDamage: "치명타 피해",
  attackSpeedPct: "공격 속도",
  breakPower: "브레이크 위력",
  cooldownReductionPct: "쿨다운 감소",
  lifeOnKill: "처치 회복",
}

function affixText(a: Affix): string {
  const suffix = a.stat === "moveSpeedPct" || a.stat === "critChance" || a.stat === "critDamage"
    || a.stat === "attackSpeedPct" || a.stat === "cooldownReductionPct" ? "%" : ""
  return `${STAT_LABEL[a.stat]} +${a.value}${suffix}`
}

function itemLine(item: ItemInstance | undefined, slot: Slot): string {
  if (!item) return `<div class="panel-row"><span class="panel-key">${SLOT_LABEL[slot]}</span><span class="panel-empty">비어 있음</span></div>`
  const affixes = [item.base, ...item.affixes].map(affixText).join(" · ")
  return `<div class="panel-row">
    <span class="panel-key">${SLOT_LABEL[slot]}</span>
    <span class="rarity-${item.rarity}">${item.name}</span>
  </div>
  <div class="panel-sub">${affixes}</div>`
}

interface Panel {
  wrap: HTMLElement
  body: HTMLElement
  open: boolean
}

const panels = new Map<string, Panel>()

function ensurePanel(id: string, title: string, hint: string): Panel | null {
  if (typeof document === "undefined") return null
  const found = panels.get(id)
  if (found) return found
  const wrap = document.createElement("div")
  wrap.id = id
  wrap.className = "side-panel hidden"
  const head = document.createElement("div")
  head.className = "panel-title"
  head.innerHTML = `<span>${title}</span><span class="panel-hint">${hint}</span>`
  const body = document.createElement("div")
  body.className = "panel-body"
  wrap.append(head, body)
  document.body.appendChild(wrap)
  const panel: Panel = { wrap, body, open: false }
  panels.set(id, panel)
  return panel
}

function toggle(id: string, title: string, hint: string): void {
  const p = ensurePanel(id, title, hint)
  if (!p) return
  p.open = !p.open
  p.wrap.classList.toggle("hidden", !p.open)
}

export function toggleStatsPanel(): void {
  toggle("stats-panel", "상태", "C 로 닫기")
}

export function toggleSkillsPanel(): void {
  toggle("skills-panel", "스킬", "K 로 닫기")
}

export function isPanelOpen(): boolean {
  for (const p of panels.values()) if (p.open) return true
  return false
}

/** 매 프레임 갱신. 닫혀 있으면 아무것도 하지 않는다. */
export function updatePanels(world: GameWorld): void {
  if (typeof document === "undefined") return
  const stats = panels.get("stats-panel")
  const skills = panels.get("skills-panel")
  if (!stats?.open && !skills?.open) return

  const player = world.with("player", "health").entities[0]
  if (!player?.player || !player.health) return
  const pc: PlayerComp = player.player

  if (stats?.open) {
    const need = xpForLevel(pc.level)
    // 장비가 얹어 준 몫을 따로 보여 준다 — "이 반지가 뭘 해 주는가" 가 보여야 한다.
    const gearAtk = pc.attackPower - pc.baseAttack
    const gearHp = player.health.max - pc.baseMaxHp
    const gearSpd = Math.round((pc.moveSpeed / pc.baseSpeed - 1) * 100)
    const plus = (n: number, unit = "") => (n > 0 ? `<span class="panel-gain">+${n}${unit}</span>` : "")
    stats.body.innerHTML = `
      <div class="panel-row"><span class="panel-key">레벨</span><span>${pc.level}</span></div>
      <div class="panel-row"><span class="panel-key">경험치</span><span>${pc.xp} / ${need}</span></div>
      <div class="panel-sep"></div>
      <div class="panel-row"><span class="panel-key">체력</span><span>${Math.round(player.health.current)} / ${player.health.max} ${plus(gearHp)}</span></div>
      <div class="panel-row"><span class="panel-key">공격력</span><span>${pc.attackPower} ${plus(gearAtk)}</span></div>
      <div class="panel-row"><span class="panel-key">이동 속도</span><span>${pc.moveSpeed.toFixed(1)} ${plus(gearSpd, "%")}</span></div>
      <div class="panel-sep"></div>
      ${(["weapon", "armor", "ring"] as Slot[]).map((s) => itemLine(pc.equipment[s], s)).join("")}
    `
  }

  if (skills?.open) {
    const rows: string[] = []
    const active = [
      { key: "whirlwind" as const, name: "회전베기", input: "우클릭", detail: `분노 ${SKILLS.whirlwind.rageCost} · 반경 ${SKILLS.whirlwind.radius}` },
      { key: "dash" as const, name: "돌진", input: "Space", detail: `쿨다운 ${SKILLS.dash.cooldown}초 · 거리 ${SKILLS.dash.distance}` },
    ]
    for (const s of active) {
      const unlocked = pc.level >= SKILL_UNLOCKS[s.key].requiredLevel
      rows.push(`<div class="panel-row skill-row ${unlocked ? "" : "locked"}">
        <span class="skill-input">${s.input}</span>
        <span class="skill-name">${s.name}</span>
        <span class="skill-need">${unlocked ? "" : `Lv.${SKILL_UNLOCKS[s.key].requiredLevel} 필요`}</span>
      </div>
      <div class="panel-sub">${SKILL_UNLOCKS[s.key].description} · ${s.detail}</div>`)
    }
    rows.push(`<div class="panel-sep"></div><div class="panel-note">예정</div>`)
    for (const [key, def] of Object.entries(PLANNED_SKILL_UNLOCKS)) {
      rows.push(`<div class="panel-row skill-row locked">
        <span class="skill-input">—</span>
        <span class="skill-name">${key === "guard" ? "방어" : "처형"}</span>
        <span class="skill-need">Lv.${def.requiredLevel}</span>
      </div>
      <div class="panel-sub">${def.description}</div>`)
    }
    skills.body.innerHTML = rows.join("")
  }
}
