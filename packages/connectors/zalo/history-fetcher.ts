/**
 * MirrorAI — Zalo History Fetcher.
 * Uses zca-cli API to fetch chat history with pagination and rate limiting.
 */

import type { UniversalMessage } from "../base/types.js";

export interface ZaloHistoryConfig {
  selfId: string;
  maxDays: number;
  rateLimitMs: number; // delay between API calls
}

interface ZaloRawMessage {
  msgId: string;
  uidFrom: string;
  content: string;
  ts: number; // unix timestamp ms
  threadId: string;
  threadName?: string;
  isGroup?: boolean;
}

/**
 * Normalize a Zalo raw message into UniversalMessage format.
 */
export function normalizeZaloMessage(msg: ZaloRawMessage): UniversalMessage {
  return {
    id: `zalo_${msg.threadId}_${msg.msgId}`,
    platform: "zalo",
    timestamp: new Date(msg.ts).toISOString(),
    authorId: msg.uidFrom,
    text: msg.content,
    context: {
      threadId: msg.threadId,
      threadName: msg.threadName,
      isGroup: msg.isGroup ?? false,
    },
    metadata: {
      originalMsgId: msg.msgId,
    },
  };
}

/**
 * Sleep utility for rate limiting.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch all historical messages from Zalo using zca-cli API.
 * Implements pagination with rate limiting.
 *
 * @param zcaApi - The zca-cli API instance
 * @param config - Fetch configuration
 * @returns AsyncGenerator yielding batches of UniversalMessage
 */
export async function* fetchZaloHistory(
  zcaApi: any, // zca-js API interface
  config: ZaloHistoryConfig
): AsyncGenerator<UniversalMessage[], void, unknown> {
  const cutoffDate = Date.now() - config.maxDays * 24 * 60 * 60 * 1000;

  // Fetch friend list + group list
  let threads: Array<{ threadId: string; name: string; isGroup: boolean }> = [];

  try {
    const friends = await zcaApi.fetchAllFriends();
    threads.push(
      ...friends.map((f: any) => ({
        threadId: f.userId ?? f.uid,
        name: f.displayName ?? f.name ?? "Unknown",
        isGroup: false,
      }))
    );
  } catch (err) {
    console.error("[ZaloHistory] Failed to fetch friends:", err);
  }

  try {
    const groups = await zcaApi.fetchAllGroups();
    threads.push(
      ...groups.map((g: any) => ({
        threadId: g.groupId ?? g.gid,
        name: g.name ?? "Group",
        isGroup: true,
      }))
    );
  } catch (err) {
    console.error("[ZaloHistory] Failed to fetch groups:", err);
  }

  console.log(`[ZaloHistory] Found ${threads.length} threads to fetch`);

  let totalMessages = 0;

  for (const thread of threads) {
    let lastMsgId: string | null = null;
    let threadMessages: UniversalMessage[] = [];
    let reachedCutoff = false;

    while (!reachedCutoff) {
      // Rate limit
      await sleep(config.rateLimitMs);

      try {
        const batch: ZaloRawMessage[] = await zcaApi.getHistory({
          threadId: thread.threadId,
          count: 50,
          lastMsgId,
        });

        if (!batch || batch.length === 0) break;

        for (const msg of batch) {
          // Check cutoff date
          if (msg.ts < cutoffDate) {
            reachedCutoff = true;
            break;
          }

          // Only keep messages from self
          if (msg.uidFrom !== config.selfId) continue;

          // Skip empty messages
          if (!msg.content || msg.content.trim().length === 0) continue;

          threadMessages.push(
            normalizeZaloMessage({
              ...msg,
              threadName: thread.name,
              isGroup: thread.isGroup,
            })
          );
        }

        lastMsgId = batch[batch.length - 1].msgId;
      } catch (err) {
        console.error(`[ZaloHistory] Error fetching thread ${thread.threadId}:`, err);
        // Exponential backoff on error
        await sleep(config.rateLimitMs * 3);
        break;
      }
    }

    if (threadMessages.length > 0) {
      totalMessages += threadMessages.length;
      console.log(
        `[ZaloHistory] Thread "${thread.name}": ${threadMessages.length} messages`
      );
      yield threadMessages;
    }
  }

  console.log(`[ZaloHistory] Total: ${totalMessages} messages from ${threads.length} threads`);
}
