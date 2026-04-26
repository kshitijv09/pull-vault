import { Router } from "express";
import { RedisPackPurchasePublisher } from "../../infra/mq/redisPackPurchasePublisher";
import { ShardedRedisPackCounter } from "../../infra/redis/shardedRedisPackCounter";
import { PackQueueController } from "./packQueue.controller";
import { PackQueueService } from "./packQueue.service";
import { authMiddleware } from "../../shared/middleware/authMiddleware";

const packCounter = new ShardedRedisPackCounter();
const publisher = new RedisPackPurchasePublisher();
const packQueueService = new PackQueueService(packCounter, publisher);
const packQueueController = new PackQueueController(packQueueService);

export const packQueueRouter = Router();

/** Body: { dropId, tierId }; header `x-user-id` — validates + Redis Lua + RabbitMQ enqueue (skeleton). */
packQueueRouter.post("/purchases", authMiddleware, packQueueController.enqueuePackPurchase);
