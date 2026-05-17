import { query } from "../../db";
import type { PackFairnessClientSeedSource } from "./packFairnessCommit.types";

export class PackFairnessCommitRepository {
  async insertCommit(input: {
    userId: string;
    dropId: string;
    clientSeed: string;
    clientSeedSource: PackFairnessClientSeedSource;
    serverSecretHex: string;
    serverCommitmentHex: string;
  }): Promise<{ id: string }> {
    const result = await query<{ id: string }>(
      `
        INSERT INTO pack_fairness_commit (
          user_id,
          drop_id,
          client_seed,
          client_seed_source,
          server_secret_hex,
          server_commitment_hex
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
        RETURNING id
      `,
      [
        input.userId,
        input.dropId,
        input.clientSeed,
        input.clientSeedSource,
        input.serverSecretHex,
        input.serverCommitmentHex
      ]
    );
    const row = result.rows[0];
    if (!row?.id) {
      throw new Error("pack_fairness_commit insert returned no id");
    }
    return { id: row.id };
  }
}
