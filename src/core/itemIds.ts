/** 게임 인스턴스마다 독립적인 아이템 식별자 할당기. */
export interface ItemIdOwner {
  nextItemId?: number
}

export function allocateItemId(owner: ItemIdOwner): number {
  const next = Number.isInteger(owner.nextItemId) && owner.nextItemId! > 0 ? owner.nextItemId! : 1
  owner.nextItemId = next + 1
  return next
}
