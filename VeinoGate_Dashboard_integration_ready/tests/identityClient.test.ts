import { describe, it, expect, vi, afterEach } from "vitest";
import { IdentityApiClient, IdentityApiError, IdentityAssignmentRejected } from "../src/api/identityClient";
import type { RuntimeConfig } from "../src/config/runtimeConfig";

const config: RuntimeConfig = {
  config_schema_version: "1.0.0",
  mode: "production",
  jetson_rest_base_url: "https://jetson.example.invalid/api/v1",
  jetson_websocket_url: "wss://jetson.example.invalid/ws/v1",
  expected_result_schema_version: "1.0.0",
  connection_timeout_ms: 10000,
  stale_after_seconds: 60
};

function mockFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; status: number; json: () => Promise<unknown> }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => handler(url, init)));
}

afterEach(() => vi.unstubAllGlobals());

describe("IdentityApiClient", () => {
  it("derives the identity base URL from the Jetson origin, not the /api/v1 path", async () => {
    let calledUrl = "";
    mockFetch((url) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => ({ adapters: [] }) };
    });
    const client = new IdentityApiClient(config);
    await client.listInventory();
    expect(calledUrl).toBe("https://jetson.example.invalid/v1/identity/inventory");
  });

  it("listLive returns the parsed live list", async () => {
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ live: [{ hardware_uid: null, short_code: "VN-001", status: "READY" }] }) }));
    const client = new IdentityApiClient(config);
    const result = await client.listLive();
    expect(result.live[0]?.short_code).toBe("VN-001");
  });

  it("startPairing posts patient_id with the profile and returns the window", async () => {
    let body: unknown = null;
    mockFetch((_url, init) => {
      body = init?.body ? JSON.parse(init.body as string) : null;
      return {
        ok: true,
        status: 200,
        json: async () => ({ window_id: "w1", patient_id: "P1", opened_at_utc: 0, expires_at_utc: 30, state: "OPEN" })
      };
    });
    const client = new IdentityApiClient(config);
    const profile = { first_name: "Test", last_name: "Patient", national_id: "000000018", age_years: 54, sex: "F" as const, department: null, bed: "7" };
    const window_ = await client.startPairing("P1", profile);
    expect(body).toEqual({ patient_id: "P1", ...profile });
    expect(window_.window_id).toBe("w1");
  });

  it("assign success returns assignment and session", async () => {
    let body: unknown = null;
    mockFetch((_url, init) => {
      body = init?.body ? JSON.parse(init.body as string) : null;
      return {
      ok: true,
      status: 200,
      json: async () => ({
        assignment: { assignment_id: "a1", hardware_uid: "U1", short_code: "VN-001", patient_id: "P1", assigned_at_utc: 0, ended_at_utc: null, active: true },
        session: { session_id: "s1", assignment_id: "a1", hardware_uid: "U1", patient_id: "P1", started_at_utc: 0, ended_at_utc: null, active: true }
      })
    }; });
    const client = new IdentityApiClient(config);
    const result = await client.assign("w1", "VN-001");
    expect(body).toEqual({ window_id: "w1", short_code: "VN-001" });
    expect(result.assignment.short_code).toBe("VN-001");
    expect(result.session.session_id).toBe("s1");
  });

  it("assign rejection (409) throws IdentityAssignmentRejected with the Hebrew message", async () => {
    mockFetch(() => ({
      ok: false,
      status: 409,
      json: async () => ({ detail: { reason_code: "CODE_NOT_FOUND", message_he: "הקוד שהוזן אינו רשום במלאי המתאמים.", message: "no registered adapter" } })
    }));
    const client = new IdentityApiClient(config);
    await expect(client.assign("w1", "VN-404")).rejects.toBeInstanceOf(IdentityAssignmentRejected);
    try {
      await client.assign("w1", "VN-404");
    } catch (err) {
      expect((err as IdentityAssignmentRejected).reasonCode).toBe("CODE_NOT_FOUND");
      expect((err as IdentityAssignmentRejected).messageHe).toContain("רשום");
    }
  });

  it("a non-409 HTTP failure throws IdentityApiError", async () => {
    mockFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const client = new IdentityApiClient(config);
    await expect(client.listInventory()).rejects.toBeInstanceOf(IdentityApiError);
  });

  it("endSession posts to the session-scoped route", async () => {
    let calledUrl = "";
    mockFetch((url) => {
      calledUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: { session_id: "s1", assignment_id: "a1", hardware_uid: "U1", patient_id: "P1", started_at_utc: 0, ended_at_utc: 5, active: false },
          assignment: null,
          adapter: null
        })
      };
    });
    const client = new IdentityApiClient(config);
    await client.endSession("s1");
    expect(calledUrl).toBe("https://jetson.example.invalid/v1/identity/sessions/s1/end");
  });
});
