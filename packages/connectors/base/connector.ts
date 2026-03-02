/**
 * MirrorAI — Abstract SocialConnector.
 * All platform connectors extend this class.
 * To add a new platform: extend this class + register in ConnectorRegistry.
 */

import type {
  ConnectorConfig,
  ConnectorStatus,
  HistoricalOptions,
  MessageHandler,
  Thread,
  UniversalMessage,
} from "./types.js";

export abstract class SocialConnector {
  abstract readonly platform: string;
  abstract readonly displayName: string;

  protected config: ConnectorConfig | null = null;

  // ── Authentication ──────────────────────────────────────
  abstract connect(config: ConnectorConfig): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract isAuthenticated(): Promise<boolean>;
  abstract refreshAuth(): Promise<void>;

  // ── Data Collection ─────────────────────────────────────
  abstract collectHistorical(
    options: HistoricalOptions
  ): AsyncGenerator<UniversalMessage[], void, unknown>;

  // ── Real-time ───────────────────────────────────────────
  abstract listenRealtime(handler: MessageHandler): void;
  abstract stopListening(): void;

  // ── Sending ─────────────────────────────────────────────
  abstract sendMessage(threadId: string, text: string): Promise<string>;
  abstract sendTypingIndicator(threadId: string): Promise<void>;

  // ── Metadata ────────────────────────────────────────────
  abstract getSelfId(): Promise<string>;
  abstract getThreadList(): Promise<Thread[]>;
  abstract getStatus(): Promise<ConnectorStatus>;
}
