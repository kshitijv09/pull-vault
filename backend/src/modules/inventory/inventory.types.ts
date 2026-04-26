import { Pack } from "../drop/drop.types";

export type CreatePackInventoryInput = Omit<Pack, "id" | "createdAt" | "updatedAt">;

export interface BulkUploadPacksRequest {
  packs: CreatePackInventoryInput[];
}
