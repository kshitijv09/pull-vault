import { env } from "../config/env";
import { PortfolioRepository } from "../modules/portfolio/portfolio.repository";
import { PortfolioService } from "../modules/portfolio/portfolio.service";

export interface UserPortfolioSnapshotJobHandles {
  stop: () => void;
}

/**
 * Periodically records `user_portfolio_snapshots` for every user via {@link computeUserPortfolioValueUsd}.
 * Disabled when `PORTFOLIO_SNAPSHOT_INTERVAL_MS` is `0`.
 */
export function startUserPortfolioSnapshotJob(): UserPortfolioSnapshotJobHandles {
  const intervalMs = env.portfolioSnapshotIntervalMs;
  if (intervalMs <= 0) {
    return { stop: () => {} };
  }

  const repository = new PortfolioRepository();
  const service = new PortfolioService(repository);

  const tick = (): void => {
    void service
      .recordSnapshotsForAllUsers()
      .then(({ users, snapshots, failures }) => {
        console.log(
          `[portfolioSnapshot] users=${users} snapshots_written=${snapshots} failures=${failures}`
        );
      })
      .catch((err) => {
        console.error("[portfolioSnapshot] tick failed", err);
      });
  };

  const initialDelay = Math.max(0, env.portfolioSnapshotInitialDelayMs);
  let initialHandle: ReturnType<typeof setTimeout> | undefined;
  if (initialDelay === 0) {
    tick();
  } else {
    initialHandle = setTimeout(tick, initialDelay);
  }

  const intervalHandle = setInterval(tick, intervalMs);

  console.log(
    `[portfolioSnapshot] scheduled every ${intervalMs}ms (first run after ${initialDelay === 0 ? "0" : String(initialDelay)}ms)`
  );

  return {
    stop: () => {
      if (initialHandle) clearTimeout(initialHandle);
      clearInterval(intervalHandle);
    }
  };
}
