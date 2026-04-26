import Redis from "ioredis";
import { env } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";
import type { PackPurchaseQueuePayload } from "../../modules/pack-queue/packQueue.types";

export class RedisPackPurchasePublisher {
  private redis: Redis | undefined;
  private readonly redisUrlForLogs: string;

  constructor() {
    const url = env.redisUrl.trim();
    this.redisUrlForLogs = url || env.redisShardUrls[0] || "";
    if (url || env.redisShardUrls.length > 0) {
      this.redis = new Redis(url || env.redisShardUrls[0]);
      console.log("[redisPackPurchasePublisher] connected", {
        queueName: env.packPurchaseQueueName,
        redis: this.redisUrlForLogs || "<unset>"
      });
    } else {
      console.warn("[redisPackPurchasePublisher] redis not configured", {
        queueName: env.packPurchaseQueueName
      });
    }
  }

  async enqueue(purchase: PackPurchaseQueuePayload): Promise<void> {
    if (!this.redis) {
      throw new AppError("Redis is not configured.", 503);
    }

    const payloadString = JSON.stringify(purchase);
    const listLength = await this.redis.rpush(env.packPurchaseQueueName, payloadString);
    console.log("[redisPackPurchasePublisher] message pushed", {
      queueName: env.packPurchaseQueueName,
      queueLengthAfterPush: listLength,
      userId: purchase.userId,
      dropId: purchase.dropId,
      tierId: purchase.tierId,
      packId: purchase.packId
    });
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}
