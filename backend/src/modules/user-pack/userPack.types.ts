export type UserPackAssignmentStatus = "assigned" | "revealing" | "revealed" | "voided";

/** User-owned pack from purchase/assignment through reveal summary. */
export interface UserPack {
  id: string;
  userId: string;
  packId: string;
  dropId: string | null;
  assignmentStatus: UserPackAssignmentStatus;
  assignedAt: string;
  openedAt: string | null;
  revealCompletedAt: string | null;
  cardsRevealedCount: number;
  totalCards: number;
  purchasePriceUsd: string;
  revealedMarketValueUsd: string | null;
  netResultUsd: string | null;
  queueMessageId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
