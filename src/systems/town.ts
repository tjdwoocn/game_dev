import { TOWN_NPCS, type NpcPlacement } from "../content/maps/town"
import { getZone, ZONE_DEFS } from "../content/zones"
import type { Entity, GameWorld, Resources } from "../core/world"
import { requestZoneTransition, type ZoneRuntime } from "./zone"
import type { ZoneMenuEntry } from "../ui/hud"

const NPC_INTERACT_RADIUS = 2.8
const gatekeeper: NpcPlacement = TOWN_NPCS.find((npc) => npc.role === "gatekeeper")!

export function townZoneChoices(): ZoneMenuEntry[] {
  const town = ZONE_DEFS.town
  if (!town) return []
  return town.exits
    .filter((exit) => exit.interactionOnly)
    .map((exit) => {
      const zone = getZone(exit.targetZoneId)
      return {
        id: exit.targetZoneId,
        name: exit.label,
        suggestedLevel: zone?.suggestedLevel ?? 1,
        kind: zone?.kind === "boss" ? "boss" : "field",
      }
    })
}

function isNearGatekeeper(player: Entity): boolean {
  const pos = player.transform?.position
  if (!pos) return false
  return Math.hypot(pos.x - gatekeeper.cell.col * 2, pos.z - gatekeeper.cell.row * 2) <= NPC_INTERACT_RADIUS
}

function clearPlayerMovement(world: GameWorld, player: Entity): void {
  if (player.moveTarget) world.removeComponent(player, "moveTarget")
  if (player.path) world.removeComponent(player, "path")
}

/** 마을 문지기 상호작용. 상점·퀘스트 NPC 기능과 분리된 존 선택 진입점이다. */
export function townSystem(world: GameWorld, res: Resources, runtime: ZoneRuntime, dt: number): void {
  void dt
  const player = world.with("player", "transform").entities[0]
  if (!player) return

  const inTown = res.zoneId === "town" && runtime.currentZoneId === "town"
  if (!inTown) {
    res.hud.setInteractionHint(null)
    res.hud.hideZoneMenu()
    if (res.input.interactQueued) res.input.interactQueued = false
    return
  }

  const near = isNearGatekeeper(player)
  res.hud.setInteractionHint(near ? "문지기 도른  ·  E 키로 던전 선택" : null)
  if (!res.input.interactQueued) return
  res.input.interactQueued = false
  if (!near) return

  clearPlayerMovement(world, player)
  res.hud.showZoneMenu(
    townZoneChoices(),
    (zoneId) => {
      requestZoneTransition(runtime, zoneId)
      res.hud.hideZoneMenu()
      res.hud.setInteractionHint(null)
    },
    () => res.hud.hideZoneMenu(),
  )
}
