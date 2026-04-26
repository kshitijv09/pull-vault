import { InventoryRepository } from "./inventory.repository";
import { CreatePackInventoryInput } from "./inventory.types";
import { Pack } from "../drop/drop.types";

export class InventoryService {
  constructor(private readonly repository: InventoryRepository) {}

  async bulkUploadPacks(packs: CreatePackInventoryInput[]): Promise<Pack[]> {
    return this.repository.bulkInsert(packs);
  }
}
