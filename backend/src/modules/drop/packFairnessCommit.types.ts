export type PackFairnessClientSeedSource = "user" | "server";

export interface PackFairnessCommitRequestBody {
  /** Optional. If omitted or blank, the server generates a client seed and returns it. */
  client_seed?: string | null;
}

export interface PackFairnessCommitResponse {
  /** Fairness session id (nonce); use at purchase to finalize the transcript. */
  nonce: string;
  /** SHA-256(server_secret) as lowercase hex (64 chars). */
  server_commitment: string;
  /** Effective client seed (user-provided or server-generated). */
  client_seed: string;
  client_seed_source: PackFairnessClientSeedSource;
}
