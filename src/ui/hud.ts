import type { Affix, CompanionRole, ItemInstance, PlayerComp, Rarity, Slot } from "../core/world"

export interface WorldLabelEntry {
  key: object
  x: number
  y: number
}
export interface EnemyBarEntry extends WorldLabelEntry {
  frac: number
}
export interface LootLabelEntry extends WorldLabelEntry {
  name: string
  rarity: Rarity
  onClick: () => void
}
export interface PartyStatusEntry {
  name: string
  role: CompanionRole
  hp: number
  maxHp: number
}

export interface ZoneMenuEntry {
  id: string
  name: string
  suggestedLevel: number
  kind: "field" | "boss"
}

export interface Hud {
  setHp(cur: number, max: number): void
  setRage(cur: number, max: number): void
  setXp(cur: number, need: number, level: number): void
  setSkillCooldown(slot: "whirlwind" | "dash", remain01: number): void
  setSkillInsufficient(on: boolean): void
  showDamage(screenX: number, screenY: number, text: string, cls?: string): void
  setOverlay(html: string | null, cls?: string): void
  setBossBar(cur: number | null, max?: number): void
  setBossBreak(frac: number | null, exposed: boolean, broken: boolean): void
  setInteractionHint(text: string | null): void
  showZoneMenu(entries: readonly ZoneMenuEntry[], onSelect: (zoneId: string) => void, onClose: () => void): void
  hideZoneMenu(): void
  flashLevelUp(): void
  syncEnemyBars(entries: EnemyBarEntry[]): void
  syncLootLabels(entries: LootLabelEntry[]): void
  toggleInventory(): void
  isInventoryOpen(): boolean
  renderInventory(player: PlayerComp, onEquip: (item: ItemInstance) => void): void
  setPartyStatus(entries: PartyStatusEntry[]): void
}

const SLOT_LABEL: Record<Slot, string> = { weapon: "무기", armor: "갑옷", ring: "반지" }
const SLOT_ICON: Record<Slot, string> = { weapon: "🗡", armor: "🛡", ring: "💍" }
const RARITY_LABEL: Record<Rarity, string> = { common: "일반", magic: "마법", rare: "희귀" }
const STAT_LABEL: Record<Affix["stat"], string> = {
  attackPower: "공격력",
  maxHp: "최대 생명력",
  moveSpeedPct: "이동 속도",
  critChance: "치명타 확률",
  critDamage: "치명타 피해",
  attackSpeedPct: "공격 속도",
  breakPower: "브레이크 위력",
  cooldownReductionPct: "쿨다운 감소",
  lifeOnKill: "처치 회복",
}

function affixSuffix(stat: Affix["stat"]): string {
  return stat === "moveSpeedPct" || stat === "critChance" || stat === "critDamage"
    || stat === "attackSpeedPct" || stat === "cooldownReductionPct" ? "%" : ""
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

function itemTooltip(item: ItemInstance): string {
  const lines = [
    `${item.name} (${RARITY_LABEL[item.rarity]})`,
    `${STAT_LABEL[item.base.stat]} +${item.base.value}${affixSuffix(item.base.stat)}`,
  ]
  for (const a of item.affixes) {
    lines.push(`${STAT_LABEL[a.stat]} +${a.value}${affixSuffix(a.stat)}`)
  }
  return lines.join("\n")
}

export function createHud(): Hud {
  const hpFill = el("hp-fill")
  const hpText = el("hp-text")
  const rageFill = el("rage-fill")
  const rageText = el("rage-text")
  const xpFill = el("xp-fill")
  const levelText = el("level-text")
  const overlay = el("overlay")
  const floatingLayer = el("floating-layer")
  const nameplates = el("nameplates")
  const bossBar = el("boss-bar")
  const bossBarName = el("boss-bar-name")
  const bossBarFill = el("boss-bar-fill")
  const bossBreakStatus = el("boss-break-status")
  const partyPanel = el("party-panel")
  const interactionHint = el("interaction-hint")
  const zoneMenu = el("zone-menu")
  const inventory = el("inventory")
  const equipmentRow = el("equipment-row")
  const inventoryGrid = el("inventory-grid")
  const tooltip = el("item-tooltip")
  const hud = el("hud")
  const cooldownSlots = {
    whirlwind: document.querySelector<HTMLElement>("#skill-whirlwind .cooldown-overlay")!,
    dash: document.querySelector<HTMLElement>("#skill-dash .cooldown-overlay")!,
  }
  const whirlwindSlot = el("skill-whirlwind")

  const enemyBarPool = new Map<object, HTMLElement>()
  const lootLabelPool = new Map<object, HTMLElement>()

  function syncPool<E extends WorldLabelEntry>(
    pool: Map<object, HTMLElement>,
    parent: HTMLElement,
    entries: E[],
    create: (e: E) => HTMLElement,
    update: (div: HTMLElement, e: E) => void,
  ) {
    const seen = new Set<object>()
    for (const entry of entries) {
      seen.add(entry.key)
      let div = pool.get(entry.key)
      if (!div) {
        div = create(entry)
        pool.set(entry.key, div)
        parent.appendChild(div)
      }
      div.style.left = `${entry.x}px`
      div.style.top = `${entry.y}px`
      update(div, entry)
    }
    for (const [key, div] of pool) {
      if (!seen.has(key)) {
        div.remove()
        pool.delete(key)
      }
    }
  }

  return {
    setHp(cur, max) {
      hpFill.style.height = `${(Math.max(0, cur) / max) * 100}%`
      hpText.textContent = `${Math.ceil(Math.max(0, cur))}`
    },
    setRage(cur, max) {
      rageFill.style.height = `${(cur / max) * 100}%`
      rageText.textContent = `${Math.floor(cur)}`
    },
    setXp(cur, need, level) {
      xpFill.style.width = `${Math.min(100, (cur / need) * 100)}%`
      levelText.textContent = `Lv.${level}  ${Math.floor(cur)} / ${need}`
    },
    setSkillCooldown(slot, remain01) {
      cooldownSlots[slot].style.height = `${Math.max(0, Math.min(1, remain01)) * 100}%`
    },
    setSkillInsufficient(on) {
      whirlwindSlot.classList.toggle("insufficient", on)
    },
    showDamage(screenX, screenY, text, cls) {
      const div = document.createElement("div")
      div.className = `float-dmg${cls ? ` ${cls}` : ""}`
      div.textContent = text
      div.style.left = `${screenX + (Math.random() - 0.5) * 24}px`
      div.style.top = `${screenY}px`
      floatingLayer.appendChild(div)
      setTimeout(() => div.remove(), 720)
    },
    setOverlay(html, cls) {
      if (html === null) {
        overlay.classList.add("hidden")
      } else {
        overlay.className = cls ?? ""
        overlay.innerHTML = html
        overlay.classList.remove("hidden")
      }
    },
    setBossBar(cur, max = 1) {
      if (cur === null) {
        bossBar.classList.add("hidden")
      } else {
        bossBar.classList.remove("hidden")
        bossBarFill.style.width = `${(Math.max(0, cur) / max) * 100}%`
      }
    },
    setBossBreak(frac, exposed, broken) {
      if (frac === null) {
        bossBreakStatus.textContent = ""
        bossBarName.textContent = "해골 군주"
        bossBar.classList.remove("break-open", "broken")
        return
      }
      bossBarName.textContent = broken ? "해골 군주 · 무력화" : exposed ? "해골 군주 · 약점 노출" : "해골 군주"
      bossBreakStatus.textContent = broken ? "집중 공격 기회" : exposed ? `브레이크 ${Math.ceil(frac * 100)}%` : ""
      bossBar.classList.toggle("break-open", exposed)
      bossBar.classList.toggle("broken", broken)
    },
    setInteractionHint(text) {
      if (text === null) {
        interactionHint.classList.add("hidden")
      } else {
        interactionHint.textContent = text
        interactionHint.classList.remove("hidden")
      }
    },
    showZoneMenu(entries, onSelect, onClose) {
      zoneMenu.innerHTML = ""
      const panel = document.createElement("div")
      panel.className = "zone-menu-panel"
      const title = document.createElement("h3")
      title.textContent = "어디로 향할까?"
      panel.appendChild(title)

      for (const entry of entries) {
        const button = document.createElement("button")
        button.className = `zone-choice zone-choice-${entry.kind}`
        button.type = "button"
        button.innerHTML = `<span>${entry.name}</span><small>권장 Lv.${entry.suggestedLevel}</small>`
        button.addEventListener("click", () => onSelect(entry.id))
        panel.appendChild(button)
      }

      const close = document.createElement("button")
      close.className = "zone-menu-close"
      close.type = "button"
      close.textContent = "돌아가기"
      close.addEventListener("click", onClose)
      panel.appendChild(close)
      zoneMenu.appendChild(panel)
      zoneMenu.classList.remove("hidden")
    },
    hideZoneMenu() {
      zoneMenu.classList.add("hidden")
      zoneMenu.innerHTML = ""
    },
    flashLevelUp() {
      hud.classList.remove("levelup-flash")
      void hud.offsetWidth // 애니메이션 재시작 강제
      hud.classList.add("levelup-flash")
    },
    syncEnemyBars(entries) {
      syncPool(enemyBarPool, nameplates, entries, () => {
        const div = document.createElement("div")
        div.className = "enemy-hpbar"
        div.appendChild(document.createElement("div"))
        return div
      }, (div, e) => {
        ;(div.firstElementChild as HTMLElement).style.width = `${e.frac * 100}%`
      })
    },
    syncLootLabels(entries) {
      syncPool(lootLabelPool, nameplates, entries, (e) => {
        const div = document.createElement("div")
        div.className = `loot-label rarity-${e.rarity}`
        div.textContent = e.name
        div.addEventListener("click", (ev) => {
          ev.stopPropagation()
          e.onClick()
        })
        return div
      }, () => {})
    },
    toggleInventory() {
      inventory.classList.toggle("hidden")
    },
    isInventoryOpen() {
      return !inventory.classList.contains("hidden")
    },
    renderInventory(player, onEquip) {
      equipmentRow.innerHTML = ""
      for (const slot of ["weapon", "armor", "ring"] as Slot[]) {
        const item = player.equipment[slot]
        const div = document.createElement("div")
        div.className = `equip-slot${item ? ` filled rarity-${item.rarity}` : ""}`
        div.innerHTML = item
          ? `<span>${SLOT_ICON[slot]}</span><span>${item.name}</span>`
          : `<span>${SLOT_ICON[slot]}</span><span>${SLOT_LABEL[slot]}</span>`
        if (item) {
          div.addEventListener("mouseenter", () => {
            tooltip.textContent = itemTooltip(item)
            tooltip.classList.remove("hidden")
          })
          div.addEventListener("mouseleave", () => tooltip.classList.add("hidden"))
        }
        equipmentRow.appendChild(div)
      }
      inventoryGrid.innerHTML = ""
      for (const item of player.inventory) {
        const cell = document.createElement("div")
        cell.className = `inv-cell rarity-${item.rarity}`
        cell.textContent = SLOT_ICON[item.slot]
        cell.addEventListener("click", () => onEquip(item))
        cell.addEventListener("mouseenter", () => {
          tooltip.textContent = itemTooltip(item)
          tooltip.classList.remove("hidden")
        })
        cell.addEventListener("mouseleave", () => tooltip.classList.add("hidden"))
        inventoryGrid.appendChild(cell)
      }
      for (let i = player.inventory.length; i < 20; i++) {
        const cell = document.createElement("div")
        cell.className = "inv-cell"
        inventoryGrid.appendChild(cell)
      }
    },
    setPartyStatus(entries) {
      partyPanel.innerHTML = entries.map((e) => {
        const role = e.role === "tank" ? "전열" : e.role === "striker" ? "타격" : "지원"
        const frac = Math.max(0, Math.min(1, e.hp / e.maxHp)) * 100
        return `<div class="party-member"><span class="party-role">${role}</span><span class="party-name">${e.name}</span><div class="party-hp"><i style="width:${frac}%"></i></div></div>`
      }).join("")
    },
  }
}
