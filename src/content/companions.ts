import type { CompanionRole, Entity, GameWorld, Vec2 } from "../core/world"

export interface CompanionDef {
  role: CompanionRole
  name: string
  model: "companion-tank" | "companion-striker" | "companion-support"
  hp: number
  damage: number
  speed: number
  radius: number
  attackRange: number
  attackCooldown: number
  breakPower: number
  healPercent?: number
  healCooldown?: number
}

export const COMPANION_DEFS: Record<CompanionRole, CompanionDef> = {
  tank: {
    role: "tank", name: "철위병", model: "companion-tank", hp: 90, damage: 8,
    speed: 4.2, radius: 0.42, attackRange: 1.7, attackCooldown: 1.1, breakPower: 16,
  },
  striker: {
    role: "striker", name: "흔적꾼", model: "companion-striker", hp: 58, damage: 9,
    speed: 4.4, radius: 0.36, attackRange: 7, attackCooldown: 1.4, breakPower: 22,
  },
  support: {
    role: "support", name: "등불사제", model: "companion-support", hp: 64, damage: 4,
    speed: 3.8, radius: 0.36, attackRange: 6, attackCooldown: 2.2, breakPower: 8,
    healPercent: 0.12, healCooldown: 5,
  },
}

export function spawnCompanion(world: GameWorld, role: CompanionRole, x: number, z: number, homeOffset: Vec2): Entity {
  const def = COMPANION_DEFS[role]
  return world.add({
    transform: { position: { x, y: 0, z }, yaw: 0 },
    speed: def.speed,
    radius: def.radius,
    health: { current: def.hp, max: def.hp },
    attack: { damage: def.damage, range: def.attackRange, arc: 2.2, cooldown: def.attackCooldown, readyAt: 0, breakPower: def.breakPower },
    companion: { role, name: def.name, homeOffset, state: "follow", attackReadyAt: 0, supportReadyAt: 0 },
    model: { kind: def.model },
  })
}
