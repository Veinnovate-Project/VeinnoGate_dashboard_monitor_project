import type { RuntimeConfig } from "../config/runtimeConfig";

export class JetsonApiError extends Error {}

/**
 * Versioned REST client for the Jetson snapshot API. The API version is a
 * path segment (baked into runtime config's base URL, e.g. .../api/v1) so a
 * backend breaking change surfaces as a clear 404/version mismatch rather
 * than silent misparsing.
 */
export class JetsonApiClient {
  constructor(private readonly config: RuntimeConfig) {}

  async fetchSnapshot(sessionId: string): Promise<unknown> {
    const url = `${this.config.jetson_rest_base_url}/sessions/${encodeURIComponent(sessionId)}/snapshot`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.connection_timeout_ms);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new JetsonApiError(`Snapshot fetch failed: HTTP ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      if (err instanceof JetsonApiError) throw err;
      throw new JetsonApiError(`Snapshot fetch failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
