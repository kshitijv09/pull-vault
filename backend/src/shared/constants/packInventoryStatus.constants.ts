/**
 * `pack_inventory.status` — lifecycle of each sellable pack unit (FK target of `user_packs.pack_id`).
 *
 * - **created** — row exists; not assigned to a drop (`drop_id` may be null) or not yet listed.
 * - **in_drop_sale** — assigned to a drop and offered for purchase.
 * - **reserved** — temporarily held (e.g. queue / checkout); still not owned.
 * - **owned** — sold / fulfilled; corresponds to a user purchase (`user_packs`).
 * - **legacy** — pre-migration / special rows.
 */
export const PACK_INVENTORY_STATUS = {
  CREATED: "created",
  IN_DROP_SALE: "in_drop_sale",
  RESERVED: "reserved",
  OWNED: "owned",
  LEGACY: "legacy"
} as const;

export type PackInventoryStatus = (typeof PACK_INVENTORY_STATUS)[keyof typeof PACK_INVENTORY_STATUS];

export const PACK_INVENTORY_STATUS_VALUES: readonly PackInventoryStatus[] = [
  PACK_INVENTORY_STATUS.CREATED,
  PACK_INVENTORY_STATUS.IN_DROP_SALE,
  PACK_INVENTORY_STATUS.RESERVED,
  PACK_INVENTORY_STATUS.OWNED,
  PACK_INVENTORY_STATUS.LEGACY
];

/** Inventory rows that can be purchased for a drop (not held, not already sold). */
export const PURCHASABLE_PACK_INVENTORY_STATUSES: readonly PackInventoryStatus[] = [
  PACK_INVENTORY_STATUS.IN_DROP_SALE
];
