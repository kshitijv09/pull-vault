import { env } from "../config/env";
import { ShardedRedisPackCounter } from "../infra/redis/shardedRedisPackCounter";
import { DropRepository } from "../modules/drop/drop.repository";
import { DropService } from "../modules/drop/drop.service";
import { UserRepository } from "../modules/user/user.repository";

export interface DropSaleLifecycleSchedulerHandles {
  stop: () => void;
}

/**
 * Polls due drop transitions:
 * - upcoming -> live (seed counters)
 * - live -> ended (close sale window)
 */
export function startDropSaleLifecycleScheduler(): DropSaleLifecycleSchedulerHandles {
  const intervalMs = Math.max(5_000, Number(process.env.DROP_LIFECYCLE_SCHEDULER_INTERVAL_MS ?? 15_000));

  const repository = new DropRepository();
  const userRepository = new UserRepository();
  const counter = new ShardedRedisPackCounter();
  const service = new DropService(repository, userRepository, counter);

  const tick = (): void => {
    void service
      .processDueDropTransitions()
      .then(({ startedDropIds, endedDropIds }) => {
        if (startedDropIds.length === 0 && endedDropIds.length === 0) {
          return;
        }
        console.log(
          `[dropLifecycle] started=${startedDropIds.length} ended=${endedDropIds.length}`
        );
      })
      .catch((error) => {
        console.error("[dropLifecycle] tick failed", error);
      });
  };

  const initialDelay = Math.max(0, Number(process.env.DROP_LIFECYCLE_SCHEDULER_INITIAL_DELAY_MS ?? 2_000));
  let initialHandle: ReturnType<typeof setTimeout> | undefined;
  if (initialDelay === 0) {
    tick();
  } else {
    initialHandle = setTimeout(tick, initialDelay);
  }

  const intervalHandle = setInterval(tick, intervalMs);
  console.log(
    `[dropLifecycle] scheduled every ${intervalMs}ms (first run after ${initialDelay}ms) [env=${env.nodeEnv}]`
  );

  return {
    stop: () => {
      if (initialHandle) clearTimeout(initialHandle);
      clearInterval(intervalHandle);
    }
  };
}
