import type { CompanionRole, Vec2 } from "../core/world"

/**
 * 현재는 플레이어 1명 + 동료 1명으로 운용하지만,
 * 파티 시스템은 최대 3명까지 확장할 수 있도록 슬롯 기준으로 관리한다.
 */
export const PARTY_CONFIG = {
  maxMembers: 3,
  activeCompanionRoles: ["tank"] as const satisfies readonly CompanionRole[],
  availableCompanionRoles: ["tank", "striker", "support"] as const satisfies readonly CompanionRole[],
  formation: {
    tank: { x: -1.6, z: 1.5 },
    striker: { x: 1.6, z: 1.2 },
    support: { x: 0, z: 3 },
  } satisfies Record<CompanionRole, Vec2>,
} as const

export type ActiveCompanionRole = (typeof PARTY_CONFIG.activeCompanionRoles)[number]

export function maxCompanionSlots(): number {
  return Math.max(0, PARTY_CONFIG.maxMembers - 1)
}
