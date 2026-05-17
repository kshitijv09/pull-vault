import { createHash, randomBytes } from "crypto";
import { AppError } from "../../shared/errors/AppError";
import {
  PACK_FAIRNESS_CLIENT_SEED_MAX_LENGTH,
  PACK_FAIRNESS_SERVER_CLIENT_SEED_BYTES,
  PACK_FAIRNESS_SERVER_SECRET_BYTES
} from "../../shared/constants/packFairnessCommit.constants";
import { DropRepository } from "./drop.repository";
import { PackFairnessCommitRepository } from "./packFairnessCommit.repository";
import type {
  PackFairnessCommitRequestBody,
  PackFairnessCommitResponse
} from "./packFairnessCommit.types";

export class PackFairnessCommitService {
  constructor(
    private readonly dropRepository: DropRepository,
    private readonly fairnessCommitRepository: PackFairnessCommitRepository
  ) {}

  async createCommit(
    userId: string,
    dropId: string,
    body: unknown
  ): Promise<PackFairnessCommitResponse> {
    const id = dropId.trim();
    if (!id) {
      throw new AppError("Drop id is required.", 400);
    }

    const drop = await this.dropRepository.findDropById(id);
    if (!drop) {
      throw new AppError("Drop not found.", 404);
    }

    const parsed = this.parseBody(body);
    const useUserSeed = parsed.clientSeedRaw !== null;
    const clientSeed = useUserSeed
      ? parsed.clientSeedRaw!
      : randomBytes(PACK_FAIRNESS_SERVER_CLIENT_SEED_BYTES).toString("hex");
    const clientSeedSource = useUserSeed ? "user" : "server";

    const serverSecretBytes = randomBytes(PACK_FAIRNESS_SERVER_SECRET_BYTES);
    const serverSecretHex = serverSecretBytes.toString("hex");
    const serverCommitmentHex = createHash("sha256").update(serverSecretBytes).digest("hex");

    const { id: nonce } = await this.fairnessCommitRepository.insertCommit({
      userId,
      dropId: id,
      clientSeed,
      clientSeedSource,
      serverSecretHex,
      serverCommitmentHex
    });

    return {
      nonce,
      server_commitment: serverCommitmentHex,
      client_seed: clientSeed,
      client_seed_source: clientSeedSource
    };
  }

  private parseBody(body: unknown): { clientSeedRaw: string | null } {
    if (body === null || body === undefined || typeof body !== "object") {
      return { clientSeedRaw: null };
    }
    const raw = (body as PackFairnessCommitRequestBody).client_seed;
    if (raw === null || raw === undefined) {
      return { clientSeedRaw: null };
    }
    if (typeof raw !== "string") {
      throw new AppError("client_seed must be a string when provided.", 400);
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return { clientSeedRaw: null };
    }
    if (trimmed.length > PACK_FAIRNESS_CLIENT_SEED_MAX_LENGTH) {
      throw new AppError(
        `client_seed must be at most ${PACK_FAIRNESS_CLIENT_SEED_MAX_LENGTH} characters.`,
        400
      );
    }
    return { clientSeedRaw: trimmed };
  }
}
