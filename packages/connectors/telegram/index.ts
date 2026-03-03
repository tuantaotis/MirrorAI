/**
 * MirrorAI — Telegram Connector.
 * Implements SocialConnector for Telegram platform.
 * Supports: JSON export parsing + real-time capture via grammY.
 */

import { SocialConnector } from "../base/connector.js";
import { ConnectorRegistry } from "../base/registry.js";
import type {
  ConnectorStatus,
  HistoricalOptions,
  MessageHandler,
  TelegramConfig,
  Thread,
  UniversalMessage,
} from "../base/types.js";
import { parseTelegramExport } from "./export-parser.js";
import { createRealtimeCapture } from "./realtime.js";

const TELEGRAM_API = "https://api.telegram.org";

export class TelegramConnector extends SocialConnector {
  readonly platform = "telegram";
  readonly displayName = "Telegram";

  private botToken: string = "";
  private selfId: string = "";
  private exportPath: string = "";
  private connected: boolean = false;
  private realtimeHandler: MessageHandler | null = null;
  private messageCount: number = 0;

  async connect(config: TelegramConfig): Promise<void> {
    this.botToken = config.botToken;
    this.selfId = config.selfId ?? "";
    this.exportPath = config.exportPath ?? "";
    this.config = config;
    this.connected = true;
    console.log(`[Telegram] Connected with bot token: ${this.botToken.slice(0, 8)}...`);
  }

  async disconnect(): Promise<void> {
    this.stopListening();
    this.connected = false;
    console.log("[Telegram] Disconnected");
  }

  async isAuthenticated(): Promise<boolean> {
    return this.connected && this.botToken.length > 0;
  }

  async refreshAuth(): Promise<void> {
    // Telegram bot tokens don't expire — no-op
  }

  async *collectHistorical(
    options: HistoricalOptions
  ): AsyncGenerator<UniversalMessage[], void, unknown> {
    if (!this.exportPath) {
      console.warn(
        "[Telegram] No export_path configured. " +
          "Export chat from Telegram Desktop → Settings → Advanced → Export Telegram Data (JSON)"
      );
      return;
    }

    console.log(`[Telegram] Parsing export: ${this.exportPath}`);

    const messages = await parseTelegramExport(this.exportPath, {
      selfName: options.selfId,
      selfId: options.selfId,
      maxDays: options.maxDays,
      onProgress: options.onProgress,
    });

    this.messageCount = messages.length;

    // Yield in batches of 500
    const BATCH_SIZE = 500;
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      yield messages.slice(i, i + BATCH_SIZE);
    }
  }

  listenRealtime(handler: MessageHandler): void {
    this.realtimeHandler = handler;
    console.log("[Telegram] Real-time capture enabled");

    const _middleware = createRealtimeCapture(
      { botToken: this.botToken, selfId: this.selfId },
      handler
    );

    console.log("[Telegram] Middleware ready for grammY integration");
  }

  stopListening(): void {
    this.realtimeHandler = null;
    console.log("[Telegram] Real-time capture stopped");
  }

  /** Send a message via Telegram Bot API */
  async sendMessage(threadId: string, text: string): Promise<string> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: threadId,
        text,
        parse_mode: "Markdown",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Telegram] sendMessage failed: ${res.status} ${err}`);
      throw new Error(`Telegram API error: ${res.status}`);
    }

    const data = (await res.json()) as { result: { message_id: number } };
    const msgId = String(data.result.message_id);
    console.log(`[Telegram] Sent message ${msgId} to ${threadId}`);
    return msgId;
  }

  /** Send typing indicator via Telegram Bot API */
  async sendTypingIndicator(threadId: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendChatAction`;

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: threadId,
        action: "typing",
      }),
    }).catch((err) => {
      console.warn(`[Telegram] sendChatAction failed: ${err.message}`);
    });
  }

  async getSelfId(): Promise<string> {
    return this.selfId;
  }

  async getThreadList(): Promise<Thread[]> {
    // Telegram Bot API doesn't provide a chat list endpoint
    // Chats are discovered when users message the bot
    return [];
  }

  async getStatus(): Promise<ConnectorStatus> {
    return {
      platform: this.platform,
      connected: this.connected,
      authenticated: this.connected && this.botToken.length > 0,
      messageCount: this.messageCount,
      lastSync: new Date().toISOString(),
    };
  }
}

// Auto-register
ConnectorRegistry.register("telegram", () => new TelegramConnector());
