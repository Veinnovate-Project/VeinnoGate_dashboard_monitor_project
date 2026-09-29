import { describe, it, expect, vi, afterEach } from "vitest";
import { loadRuntimeConfig, RuntimeConfigError } from "../src/config/runtimeConfig";

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("runtime configuration", () => {
  it("loads a valid production config with https/wss URLs", async () => {
    mockFetchOnce({
      config_schema_version: "1.0.0",
      mode: "production",
      jetson_rest_base_url: "https://jetson.example.invalid/api/v1",
      jetson_websocket_url: "wss://jetson.example.invalid/ws/v1",
      expected_result_schema_version: "1.0.0",
      connection_timeout_ms: 10000,
      stale_after_seconds: 60
    });
    const config = await loadRuntimeConfig();
    expect(config.jetson_rest_base_url).toContain("https://");
  });

  it("fails visibly when runtime-config.json is missing (HTTP error)", async () => {
    mockFetchOnce({}, false);
    await expect(loadRuntimeConfig()).rejects.toBeInstanceOf(RuntimeConfigError);
  });

  it("fails visibly when the config fails schema validation", async () => {
    mockFetchOnce({ mode: "production" });
    await expect(loadRuntimeConfig()).rejects.toBeInstanceOf(RuntimeConfigError);
  });

  it("rejects an insecure http:// URL in production mode", async () => {
    mockFetchOnce({
      config_schema_version: "1.0.0",
      mode: "production",
      jetson_rest_base_url: "http://jetson.example.invalid/api/v1",
      jetson_websocket_url: "wss://jetson.example.invalid/ws/v1",
      expected_result_schema_version: "1.0.0",
      connection_timeout_ms: 10000,
      stale_after_seconds: 60
    });
    await expect(loadRuntimeConfig()).rejects.toBeInstanceOf(RuntimeConfigError);
  });

  it("allows insecure ws:// only for mode:test on localhost", async () => {
    mockFetchOnce({
      config_schema_version: "1.0.0",
      mode: "test",
      jetson_rest_base_url: "http://localhost:8787/api/v1",
      jetson_websocket_url: "ws://localhost:8787/ws/v1",
      expected_result_schema_version: "1.0.0",
      connection_timeout_ms: 5000,
      stale_after_seconds: 15
    });
    const config = await loadRuntimeConfig();
    expect(config.mode).toBe("test");
  });

  it("rejects an unsupported config_schema_version", async () => {
    mockFetchOnce({
      config_schema_version: "9.9.9",
      mode: "production",
      jetson_rest_base_url: "https://jetson.example.invalid/api/v1",
      jetson_websocket_url: "wss://jetson.example.invalid/ws/v1",
      expected_result_schema_version: "1.0.0",
      connection_timeout_ms: 10000,
      stale_after_seconds: 60
    });
    await expect(loadRuntimeConfig()).rejects.toBeInstanceOf(RuntimeConfigError);
  });
});
