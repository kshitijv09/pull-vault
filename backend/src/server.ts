import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { app } from "./app";
import { env } from "./config/env";
import { ShardedRedisPackCounter } from "./infra/redis/shardedRedisPackCounter";
import { attachWebSocketUpgrades } from "./infra/ws/attachWebSocketUpgrades";
import { AuctionSocketServer } from "./infra/ws/auctionSocketServer";
import { CollectionCardSocketServer } from "./infra/ws/collectionCardSocketServer";
import { startAuctionExpiryProcessor } from "./modules/auction/auctionExpiryProcessor";
import { PackAvailabilitySocketServer } from "./modules/pack-availability/packAvailabilitySocketServer";
import {
  getPackSeedRows,
  getTierQueueSeedsForRedis,
  prefetchPackInventoryCaps
} from "./modules/pack-queue/packInventoryCapStore";
import { startInventoryCardPriceRefreshJob } from "./jobs/inventoryCardPriceRefreshJob";
import { startDropSaleLifecycleScheduler } from "./jobs/dropSaleLifecycleScheduler";
import { startAuctionSlotLifecycleScheduler } from "./jobs/auctionSlotLifecycleScheduler";
import { startUserPortfolioSnapshotJob } from "./jobs/userPortfolioSnapshotJob";

async function start(): Promise<void> {
  await prefetchPackInventoryCaps(); // Fetch and load in-memory so that requests can be served faster. Data is there in redis as well
  console.log("Pack tier order and inventory prefetched from database.");

  const counter = new ShardedRedisPackCounter();
  await counter.seedPackRemaining(getPackSeedRows(), getTierQueueSeedsForRedis());
  console.log("Redis per-pack remaining counters and tier available lists seeded.");

  const httpServer = createServer(app);

  const packAvailabilityWss = new WebSocketServer({ noServer: true });
  const collectionWss = new WebSocketServer({ noServer: true });
  const auctionWss = new WebSocketServer({ noServer: true });

  attachWebSocketUpgrades(httpServer, [
    { pathname: "/ws/pack-availability", wss: packAvailabilityWss },
    { pathname: "/ws/collection", wss: collectionWss },
    { pathname: "/ws/auction", wss: auctionWss }
  ]);

  const socketServer = new PackAvailabilitySocketServer(packAvailabilityWss, counter);
  await socketServer.start();

  const collectionSocketServer = new CollectionCardSocketServer(collectionWss);
  await collectionSocketServer.start();

  const auctionSocketServer = new AuctionSocketServer(auctionWss);
  await auctionSocketServer.start();
  const auctionExpiryProcessor = startAuctionExpiryProcessor();
  const inventoryPriceRefresh = startInventoryCardPriceRefreshJob();
  const dropLifecycleScheduler = startDropSaleLifecycleScheduler();
  const auctionSlotLifecycleScheduler = startAuctionSlotLifecycleScheduler();
  const portfolioSnapshots = startUserPortfolioSnapshotJob();

  const shutdownPeriodicJobs = (): void => {
    inventoryPriceRefresh.stop();
    dropLifecycleScheduler.stop();
    auctionSlotLifecycleScheduler.stop();
    portfolioSnapshots.stop();
    void auctionExpiryProcessor.stop();
  };
  process.once("SIGTERM", shutdownPeriodicJobs);
  process.once("SIGINT", shutdownPeriodicJobs);

  httpServer.listen(env.port, () => {
    console.log(`pullvault-backend listening on port ${env.port}`);
    console.log("Pack availability WebSocket server running at /ws/pack-availability");
    console.log("Collection card WebSocket server running at /ws/collection");
    console.log("Auction WebSocket server running at /ws/auction");
  });
}

start().catch((error) => {
  console.error("Failed to start server.", error);
  process.exit(1);
});
