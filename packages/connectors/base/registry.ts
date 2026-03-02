/**
 * MirrorAI — ConnectorRegistry.
 * Central registry for all platform connectors.
 * Extensible: register new platforms with a single line.
 */

import { SocialConnector } from "./connector.js";

type ConnectorFactory = () => SocialConnector;

class ConnectorRegistryClass {
  private factories = new Map<string, ConnectorFactory>();
  private instances = new Map<string, SocialConnector>();

  register(platform: string, factory: ConnectorFactory): void {
    this.factories.set(platform, factory);
    console.log(`[ConnectorRegistry] Registered: ${platform}`);
  }

  get(platform: string): SocialConnector {
    // Return cached instance if exists
    const cached = this.instances.get(platform);
    if (cached) return cached;

    // Create new instance
    const factory = this.factories.get(platform);
    if (!factory) {
      throw new Error(
        `[ConnectorRegistry] No connector for platform: "${platform}". ` +
          `Available: ${this.list().join(", ")}`
      );
    }

    const instance = factory();
    this.instances.set(platform, instance);
    return instance;
  }

  has(platform: string): boolean {
    return this.factories.has(platform);
  }

  list(): string[] {
    return Array.from(this.factories.keys());
  }

  listConnected(): string[] {
    return Array.from(this.instances.keys());
  }

  async disconnectAll(): Promise<void> {
    for (const [platform, connector] of this.instances) {
      try {
        await connector.disconnect();
        console.log(`[ConnectorRegistry] Disconnected: ${platform}`);
      } catch (err) {
        console.error(`[ConnectorRegistry] Error disconnecting ${platform}:`, err);
      }
    }
    this.instances.clear();
  }
}

export const ConnectorRegistry = new ConnectorRegistryClass();
