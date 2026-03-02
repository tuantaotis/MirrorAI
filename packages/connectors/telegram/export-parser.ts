/**
 * MirrorAI — Telegram Desktop JSON Export Parser.
 * Parses the result.json file from Telegram Desktop export
 * and converts to UniversalMessage format.
 */

import { readFile } from "node:fs/promises";
import type { UniversalMessage } from "../base/types.js";

interface TelegramExportChat {
  id: number;
  name: string;
  type: "personal_chat" | "private_group" | "private_supergroup" | "public_supergroup";
  messages: TelegramExportMessage[];
}

interface TelegramExportMessage {
  id: number;
  type: "message" | "service";
  date: string;
  date_unixtime: string;
  from?: string;
  from_id?: string;
  reply_to_message_id?: number;
  forwarded_from?: string;
  text: string | TelegramTextEntity[];
  text_entities?: TelegramTextEntity[];
}

interface TelegramTextEntity {
  type: string;
  text: string;
}

export interface ParseOptions {
  selfName: string;
  selfId?: string;
  maxDays?: number;
  onProgress?: (processed: number, total: number) => void;
}

/**
 * Extract plain text from Telegram's text field (can be string or entity array).
 */
function extractText(text: string | TelegramTextEntity[]): string {
  if (typeof text === "string") return text;
  return text.map((entity) => entity.text).join("");
}

/**
 * Parse a Telegram Desktop JSON export file.
 * Returns only messages from the specified user (selfName/selfId).
 */
export async function parseTelegramExport(
  filePath: string,
  options: ParseOptions
): Promise<UniversalMessage[]> {
  const raw = await readFile(filePath, "utf-8");
  const data = JSON.parse(raw) as { chats?: { list?: TelegramExportChat[] } };

  const chatList = data.chats?.list ?? [];
  const messages: UniversalMessage[] = [];
  const cutoffDate = options.maxDays
    ? new Date(Date.now() - options.maxDays * 24 * 60 * 60 * 1000)
    : null;

  let totalMessages = 0;
  for (const chat of chatList) {
    totalMessages += chat.messages.length;
  }

  let processed = 0;

  for (const chat of chatList) {
    const isGroup = chat.type !== "personal_chat";

    for (const msg of chat.messages) {
      processed++;
      if (processed % 1000 === 0) {
        options.onProgress?.(processed, totalMessages);
      }

      // Skip non-text messages
      if (msg.type !== "message") continue;

      // Skip forwarded messages (not user's own voice)
      if (msg.forwarded_from) continue;

      // Filter by author
      const isAuthor = options.selfId
        ? msg.from_id === options.selfId
        : msg.from === options.selfName;
      if (!isAuthor) continue;

      // Extract text
      const text = extractText(msg.text);
      if (!text || text.trim().length === 0) continue;

      // Date filter
      const msgDate = new Date(msg.date);
      if (cutoffDate && msgDate < cutoffDate) continue;

      messages.push({
        id: `tg_${chat.id}_${msg.id}`,
        platform: "telegram",
        timestamp: msgDate.toISOString(),
        authorId: msg.from_id ?? options.selfName,
        text: text.trim(),
        context: {
          threadId: String(chat.id),
          threadName: chat.name,
          isGroup,
          replyTo: msg.reply_to_message_id ? String(msg.reply_to_message_id) : undefined,
        },
        metadata: {
          chatType: chat.type,
          originalId: msg.id,
        },
      });
    }
  }

  options.onProgress?.(totalMessages, totalMessages);
  console.log(
    `[TelegramParser] Parsed ${messages.length} messages from ${chatList.length} chats`
  );
  return messages;
}
