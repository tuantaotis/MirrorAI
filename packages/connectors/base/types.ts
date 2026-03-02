/**
 * MirrorAI — Universal message types shared across all platform connectors.
 * Every connector normalizes platform-specific messages into these types.
 */

export interface UniversalMessage {
  id: string;
  platform: string;
  timestamp: string; // ISO8601
  authorId: string;
  text: string;
  context: MessageContext;
  metadata: Record<string, unknown>;
}

export interface MessageContext {
  replyTo?: string;
  threadId: string;
  isGroup: boolean;
  threadName?: string;
}

export interface ConnectorConfig {
  platform: string;
  selfId?: string;
  [key: string]: unknown;
}

export interface TelegramConfig extends ConnectorConfig {
  platform: "telegram";
  botToken: string;
  exportPath?: string;
}

export interface ZaloConfig extends ConnectorConfig {
  platform: "zalo";
  mode: "bot" | "personal";
  botToken?: string;
}

export interface HistoricalOptions {
  maxDays?: number;
  selfId: string;
  onProgress?: (processed: number, total: number) => void;
}

export interface Thread {
  id: string;
  name: string;
  isGroup: boolean;
  platform: string;
}

export type MessageHandler = (message: UniversalMessage) => Promise<void>;

export interface ConnectorStatus {
  platform: string;
  connected: boolean;
  authenticated: boolean;
  messageCount: number;
  lastSync?: string;
  error?: string;
}
