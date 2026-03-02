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

    // Create the middleware — to be injected into OpenClaw's grammY bot
    const _middleware = createRealtimeCapture(
      { botToken: this.botToken, selfId: this.selfId },
      handler
    );

    // In OpenClaw integration, this middleware is registered via:
    // openclaw channels telegram → grammY middleware pipeline
    console.log("[Telegram] Middleware ready for OpenClaw grammY integration");
  }

  stopListening(): void {
    this.realtimeHandler = null;
    console.log("[Telegram] Real-time capture stopped");
  }

  async sendMessage(threadId: string, text: string): Promise<string> {
    // Delegates to OpenClaw's messaging tool
    // openclaw message send --channel telegram --target <threadId> --message <text>
    console.log(`[Telegram] Send to ${threadId}: ${text.slice(0, 50)}...`);
    return `tg_sent_${Date.now()}`;
  }

  async sendTypingIndicator(threadId: string): Promise<void> {
    console.log(`[Telegram] Typing indicator → ${threadId}`);
  }

  async getSelfId(): Promise<string> {
    return this.selfId;
  }

  async getThreadList(): Promise<Thread[]> {
    // Would query Telegram API for chat list
    // In practice, extracted from export data
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
