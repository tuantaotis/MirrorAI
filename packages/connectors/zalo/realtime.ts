/**
 * MirrorAI — Zalo Real-time Message Listener.
 * Hooks into zca-cli's message event to capture outgoing messages.
 */

import type { MessageHandler, UniversalMessage } from "../base/types.js";
import { normalizeZaloMessage } from "./history-fetcher.js";

export interface ZaloRealtimeConfig {
  selfId: string;
}

/**
 * Attach a real-time listener to the zca-cli API instance.
 * Captures outgoing messages for persona updates.
 */
export function attachZaloListener(
  zcaApi: any,
  config: ZaloRealtimeConfig,
  handler: MessageHandler
): () => void {
  const onMessage = async (message: any) => {
    try {
      // Capture all messages (both incoming and outgoing)
      const normalized: UniversalMessage = normalizeZaloMessage({
        msgId: message.msgId ?? String(Date.now()),
        uidFrom: message.uidFrom ?? message.fromUid ?? "unknown",
        content: message.content ?? message.text ?? "",
        ts: message.ts ?? Date.now(),
        threadId: message.threadId ?? message.toUid ?? "unknown",
        threadName: message.threadName,
        isGroup: message.isGroup ?? false,
      });

      // Mark if outgoing
      const isOutgoing = normalized.authorId === config.selfId;
      normalized.metadata.isOutgoing = isOutgoing;

      // Fire-and-forget
      handler(normalized).catch((err) => {
        console.error("[ZaloRealtime] Error handling message:", err);
      });
    } catch (err) {
      console.error("[ZaloRealtime] Error normalizing message:", err);
    }
  };

  // Attach listener
  zcaApi.listener.on("message", onMessage);
  console.log("[ZaloRealtime] Listener attached");

  // Return cleanup function
  return () => {
    zcaApi.listener.off("message", onMessage);
    console.log("[ZaloRealtime] Listener detached");
  };
}
