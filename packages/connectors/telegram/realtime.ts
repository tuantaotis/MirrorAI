/**
 * MirrorAI — Telegram Real-time Message Listener.
 * Uses grammY bot framework to capture outgoing messages
 * and incoming messages for real-time persona updates.
 */

import type { MessageHandler, UniversalMessage } from "../base/types.js";

export interface TelegramRealtimeConfig {
  botToken: string;
  selfId: string;
}

/**
 * Create a real-time message capture middleware for grammY.
 * This hooks into the OpenClaw Telegram channel to capture messages.
 *
 * NOTE: In production, this integrates with OpenClaw's grammY instance.
 * Standalone usage requires grammy as a peer dependency.
 */
export function createRealtimeCapture(
  config: TelegramRealtimeConfig,
  handler: MessageHandler
) {
  return async function captureMiddleware(ctx: any, next: () => Promise<void>) {
    // Capture text messages
    if (ctx.message?.text) {
      const isOutgoing = String(ctx.from?.id) === config.selfId;
      const chatType = ctx.chat?.type ?? "private";
      const isGroup = chatType !== "private";

      const message: UniversalMessage = {
        id: `tg_rt_${ctx.chat?.id}_${ctx.message.message_id}`,
        platform: "telegram",
        timestamp: new Date(ctx.message.date * 1000).toISOString(),
        authorId: String(ctx.from?.id ?? "unknown"),
        text: ctx.message.text,
        context: {
          threadId: String(ctx.chat?.id ?? "unknown"),
          threadName: ctx.chat?.title ?? ctx.chat?.first_name ?? "DM",
          isGroup,
          replyTo: ctx.message.reply_to_message
            ? String(ctx.message.reply_to_message.message_id)
            : undefined,
        },
        metadata: {
          isOutgoing,
          chatType,
          fromUsername: ctx.from?.username,
        },
      };

      // Fire-and-forget: don't block message flow
      handler(message).catch((err) => {
        console.error("[TelegramRealtime] Error handling message:", err);
      });
    }

    await next();
  };
}
