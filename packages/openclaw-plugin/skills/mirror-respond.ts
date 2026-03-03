/**
 * MirrorAI — mirror-respond Skill.
 * Core OpenClaw skill: receives incoming messages, queries RAG engine,
 * and generates persona-matching responses.
 *
 * Trigger: Every incoming message on configured channels.
 * Flow: message → RAG query → confidence check → auto-reply or queue.
 */

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const MIRRORAI_HOME = join(homedir(), ".mirrorai");
const STATE_FILE = join(MIRRORAI_HOME, "state.json");
const LOG_FILE = join(MIRRORAI_HOME, "logs", "mirror.log");
const REVIEW_QUEUE = join(MIRRORAI_HOME, "review_queue.jsonl");

// ─── OpenClaw Skill Metadata ────────────────────────────────────────────────
export const skillMeta = {
  id: "mirror-respond",
  name: "Mirror Respond",
  description: "Respond to messages as the user's AI persona",
  trigger: "message",
  channels: ["telegram", "zalo", "zalouser", "facebook", "instagram", "discord", "whatsapp"],
  requires: ["chromadb", "ollama", "python3"],
  envKeys: [],
};

interface IncomingMessage {
  platform: string;
  threadId: string;
  text: string;
  senderId: string;
  senderName: string;
  isGroup: boolean;
  timestamp: string;
}

interface MirrorResponse {
  response: string;
  confidence: number;
  shouldAutoReply: boolean;
  model: string;
  latencyMs: number;
}

/**
 * Check if mirroring is active.
 */
function isMirroringActive(): boolean {
  if (!existsSync(STATE_FILE)) return false;
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    return state.state === "MIRRORING_ACTIVE";
  } catch {
    return false;
  }
}

/**
 * Log a mirror event to file + console.
 */
function logMirrorEvent(event: Record<string, unknown>): void {
  const logEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...event,
  });

  console.log(`[MirrorAI] ${logEntry}`);

  try {
    appendFileSync(LOG_FILE, logEntry + "\n");
  } catch {
    // Log dir might not exist yet
  }
}

/**
 * Queue a message for manual review.
 */
function queueForReview(message: IncomingMessage, response: MirrorResponse): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    message,
    suggestedResponse: response.response,
    confidence: response.confidence,
  });

  try {
    appendFileSync(REVIEW_QUEUE, entry + "\n");
    logMirrorEvent({
      event: "queued_for_review",
      threadId: message.threadId,
      confidence: response.confidence,
    });
  } catch {
    console.error("[MirrorAI] Failed to queue for review");
  }
}

/**
 * Call the Python RAG engine to generate a response.
 */
function callRAGEngine(message: IncomingMessage): MirrorResponse {
  try {
    const input = JSON.stringify({
      text: message.text,
      sender_name: message.senderName,
      thread_id: message.threadId,
      platform: message.platform,
    });

    // Call Python RAG engine
    const result = execSync(
      `python3 -c "
import json, sys
sys.path.insert(0, '.')
from packages.core.rag_engine.query import RAGQueryEngine
from packages.core.rag_engine.retriever import Retriever
from packages.core.rag_engine.indexer import VectorIndexer

indexer = VectorIndexer()
retriever = Retriever(indexer)
engine = RAGQueryEngine(retriever, soul_md_path='workspace/SOUL.md')

data = json.loads('${input.replace(/'/g, "\\'")}')
result = engine.query(data['text'], sender_name=data['sender_name'])
print(json.dumps({
    'response': result.response,
    'confidence': result.confidence,
    'should_auto_reply': result.should_auto_reply,
    'model': result.model,
    'latency_ms': result.latency_ms,
}))
"`,
      { encoding: "utf-8", timeout: 30000 }
    );

    const parsed = JSON.parse(result.trim());
    return {
      response: parsed.response,
      confidence: parsed.confidence,
      shouldAutoReply: parsed.should_auto_reply,
      model: parsed.model,
      latencyMs: parsed.latency_ms,
    };
  } catch (err) {
    console.error("[MirrorAI] RAG engine error:", err);
    return {
      response: "",
      confidence: 0,
      shouldAutoReply: false,
      model: "error",
      latencyMs: 0,
    };
  }
}

/**
 * Calculate human-like typing delay.
 */
function typingDelay(response: string): number {
  const words = response.split(" ").length;
  const wpm = 35 + Math.random() * 30; // 35-65 WPM
  const delayMs = (words / wpm) * 60 * 1000;
  return Math.max(800, Math.min(8000, delayMs));
}

/**
 * Main skill handler — called by OpenClaw on every incoming message.
 */
export async function handleIncomingMessage(message: IncomingMessage): Promise<void> {
  // Check if mirroring is active
  if (!isMirroringActive()) {
    return;
  }

  logMirrorEvent({
    event: "incoming",
    platform: message.platform,
    threadId: message.threadId,
    sender: message.senderName,
    textPreview: message.text.slice(0, 50),
  });

  // Generate response via RAG
  const response = callRAGEngine(message);

  if (!response.response) {
    logMirrorEvent({ event: "no_response", reason: "RAG engine returned empty" });
    return;
  }

  // Confidence check
  if (response.shouldAutoReply) {
    // Human-like delay
    const delay = typingDelay(response.response);
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Send via OpenClaw messaging
    logMirrorEvent({
      event: "auto_reply",
      platform: message.platform,
      threadId: message.threadId,
      confidence: response.confidence,
      model: response.model,
      latencyMs: response.latencyMs,
      responsePreview: response.response.slice(0, 50),
    });

    console.log(`[MirrorAI] → ${message.platform}/${message.threadId}: ${response.response}`);
  } else {
    // Queue for manual review
    queueForReview(message, response);
  }
}

// Export for OpenClaw skill registration
export default {
  ...skillMeta,
  handler: handleIncomingMessage,
};
