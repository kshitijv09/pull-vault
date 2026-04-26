import Decimal from "decimal.js";
import {
  fetchJustTcgPokemonCards,
  readFirstAvailableJustTcgPriceUsd
} from "../../infra/tcgpricelookup/tcgPriceLookupClient";
import { AppError } from "../../shared/errors/AppError";
import { TcgCatalogRepository } from "./tcgCatalog.repository";
import type { CreatedCatalogCardRow, TcgSearchImportRequestBody, TcgSearchImportResult } from "./tcgCatalog.types";

interface JustTcgVariant {
  condition?: unknown;
  printing?: unknown;
  price?: unknown;
}

interface JustTcgRow {
  id?: unknown;
  name?: unknown;
  set?: unknown;
  set_name?: unknown;
  rarity?: unknown;
  variants?: unknown;
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t.length ? t : null;
}

const PREDEFINED_IMAGE_URLS = [
  "https://cdn.tcgpricelookup.com/cards/4b407eb2380f0202.webp",
  "https://cdn.tcgpricelookup.com/cards/903efe6960330975.webp",
  "https://cdn.tcgpricelookup.com/cards/edad819ee560ea1d.webp",
  "https://cdn.tcgpricelookup.com/cards/c02a7208c0f47de6.webp",
  "https://cdn.tcgpricelookup.com/cards/b51f71f497e7cd82.webp",
  "https://cdn.tcgpricelookup.com/cards/e6c5d120c3fc9107.webp",
  "https://cdn.tcgpricelookup.com/cards/a57975ba779d14b2.webp",
  "https://cdn.tcgpricelookup.com/cards/fc4fe7d1374b755f.webp",
  "https://cdn.tcgpricelookup.com/cards/c88abbadea2d785c.webp",
  "https://cdn.tcgpricelookup.com/cards/b72e8a26b7b422e8.webp",
  "https://cdn.tcgpricelookup.com/cards/8e1654ea74162378.webp",
  "https://cdn.tcgpricelookup.com/cards/300da6d7885db5a2.webp",
  "https://cdn.tcgpricelookup.com/cards/eda8395816ea7e55.webp",
  "https://cdn.tcgpricelookup.com/cards/12ac9a0a021fb7c8.webp",
  "https://cdn.tcgpricelookup.com/cards/4344d1ec9628640a.webp",
  "https://cdn.tcgpricelookup.com/cards/9665e379e35f4ed5.webp",
  "https://cdn.tcgpricelookup.com/cards/91a4100ba41f7f7b.webp",
  "https://cdn.tcgpricelookup.com/cards/08083232bd5bdbe9.webp",
  "https://cdn.tcgpricelookup.com/cards/b018f4390e369644.webp",
  "https://cdn.tcgpricelookup.com/cards/98692791f5098c0c.webp"
];

function mapRowToInsert(
  item: unknown,
  imageIndex: number
): { externalCardId: string; name: string; cardSet: string; imageUrl: string; rarity: string; marketValueUsd: string } | null {
  const row = item as JustTcgRow;
  const externalCardId = asNonEmptyString(row.id);
  if (!externalCardId) {
    return null;
  }

  const baseName = asNonEmptyString(row.name) ?? "Unknown card";
  const cardSet = asNonEmptyString(row.set_name) ?? asNonEmptyString(row.set) ?? "Unknown set";
  
  // Use iterative images from the predefined list
  const imageUrl = PREDEFINED_IMAGE_URLS[imageIndex % PREDEFINED_IMAGE_URLS.length];

  const sealedPriceUsd = readFirstAvailableJustTcgPriceUsd(item);
  if (sealedPriceUsd == null || !Number.isFinite(sealedPriceUsd) || sealedPriceUsd <= 0) {
    return null;
  }
  
  const marketUsd = new Decimal(sealedPriceUsd).toDecimalPlaces(2).toFixed(2);
  const rarity = asNonEmptyString(row.rarity) ?? "Unknown";

  return {
    externalCardId,
    name: baseName,
    cardSet,
    imageUrl,
    rarity,
    marketValueUsd: marketUsd
  };
}

export class TcgCatalogService {
  constructor(private readonly repository: TcgCatalogRepository) {}

  async importFromSearch(body: TcgSearchImportRequestBody): Promise<TcgSearchImportResult> {
    void body;
    let data: unknown[];
    try {
      data = await fetchJustTcgPokemonCards();
    } catch (e) {
      if (e instanceof AppError) {
        throw e;
      }
      const message = e instanceof Error ? e.message : "justtcg cards fetch failed.";
      throw new AppError(message, 502);
    }

    const skipped: { externalCardId: string; reason: string }[] = [];
    const mappedRows: Array<{
      externalCardId: string;
      name: string;
      cardSet: string;
      imageUrl: string;
      rarity: string;
      marketValueUsd: string;
    }> = [];

    let currentImageIndex = 0;
    for (const item of data) {
      const mapped = mapRowToInsert(item, currentImageIndex);
      const row = item as JustTcgRow & { variants?: JustTcgVariant[] };
      const candidateId = asNonEmptyString(row.id) ?? "(invalid)";
      if (!mapped) {
        skipped.push({ externalCardId: candidateId, reason: "missing_id_or_other_invalid_data" });
        continue;
      }
      mappedRows.push(mapped);
      currentImageIndex++;
    }

    const seenInBatch = new Set<string>();
    const pending: typeof mappedRows = [];
    for (const row of mappedRows) {
      if (seenInBatch.has(row.externalCardId)) {
        skipped.push({ externalCardId: row.externalCardId, reason: "duplicate_in_search_results" });
        continue;
      }
      seenInBatch.add(row.externalCardId);
      pending.push(row);
    }

    const insertedRows = await this.repository.insertCatalogCards(pending);

    const created: CreatedCatalogCardRow[] = insertedRows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      name: r.name,
      cardSet: r.card_set,
      imageUrl: r.image_url,
      rarity: r.rarity,
      marketValueUsd: r.market_value_usd
    }));

    return {
      created,
      skipped,
      upstreamResultCount: data.length
    };
  }
}
