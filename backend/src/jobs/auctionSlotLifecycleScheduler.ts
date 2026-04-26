import { env } from "../config/env";
import { AuctionRepository } from "../modules/auction/auction.repository";
import { AuctionService } from "../modules/auction/auction.service";

export interface AuctionSlotLifecycleSchedulerHandles {
  stop: () => void;
}

/**
 * Polls due auction slot transitions:
 * - scheduled -> active (start auction)
 */
export function startAuctionSlotLifecycleScheduler(): AuctionSlotLifecycleSchedulerHandles {
  const intervalMs = Math.max(5_000, Number(process.env.AUCTION_LIFECYCLE_SCHEDULER_INTERVAL_MS ?? 15_000));

  const repository = new AuctionRepository();
  const service = new AuctionService(repository);

  const tick = (): void => {
    void service
      .processDueSlotTransitions()
      .then(({ startedSlotIds }) => {
        if (startedSlotIds.length === 0) {
          return;
        }
        console.log(`[auctionLifecycle] started=${startedSlotIds.length} slots`);
      })
      .catch((error) => {
        console.error("[auctionLifecycle] tick failed", error);
      });
  };

  const initialDelay = Math.max(0, Number(process.env.AUCTION_LIFECYCLE_SCHEDULER_INITIAL_DELAY_MS ?? 3_000));
  let initialHandle: ReturnType<typeof setTimeout> | undefined;
  if (initialDelay === 0) {
    tick();
  } else {
    initialHandle = setTimeout(tick, initialDelay);
  }

  const intervalHandle = setInterval(tick, intervalMs);
  console.log(
    `[auctionLifecycle] scheduled every ${intervalMs}ms (first run after ${initialDelay}ms) [env=${env.nodeEnv}]`
  );

  return {
    stop: () => {
      if (initialHandle) clearTimeout(initialHandle);
      clearInterval(intervalHandle);
    }
  };
}
