export interface TcgSearchImportRequestBody {
  /** Currently unused; import reads from configured upstream Pokemon cards feed. */
  searchParams?: Record<string, string>;
}

export interface CreatedCatalogCardRow {
  id: string;
  cardId: string;
  name: string;
  cardSet: string;
  imageUrl: string;
  rarity: string;
  marketValueUsd: string;
}

export interface TcgSearchImportResult {
  created: CreatedCatalogCardRow[];
  skipped: { externalCardId: string; reason: string }[];
  upstreamResultCount: number;
}
