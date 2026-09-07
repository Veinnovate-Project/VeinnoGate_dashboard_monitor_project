import { describe, it, expect, vi, afterEach } from "vitest";
import { AdapterPairingController } from "../src/components/AdapterPairingView";
import { IdentityApiClient } from "../src/api/identityClient";
import type { RuntimeConfig } from "../src/config/runtimeConfig";

/**
 * No jsdom in this bundle's toolchain (see package.json) — DashboardView.ts
 * is likewise only ever tested as a pure string-returning function
 * elsewhere. AdapterPairingController only needs three things from its
 * container (addEventListener x2, innerHTML setter), so a minimal fake
 * exercises the real state machine/DOM-wiring logic without adding a new
 * dependency just for this test file.
 */
class FakeElement {
  innerHTML = "";
  private listeners: Record<string, (e: any) => void> = {};
  addEventListener(type: string, handler: (e: any) => void): void {
    this.listeners[type] = handler;
  }
  dispatch(type: string, event: any): void {
    this.listeners[type]?.(event);
  }
  click(action: string, extra: Record<string, string> = {}): void {
    this.dispatch("click", {
      target: { closest: () => ({ dataset: { action, ...extra } }) }
    });
  }
  input(id: string, value: string): void {
    this.dispatch("input", { target: { id, value } });
  }
}

const config: RuntimeConfig = {
  config_schema_version: "1.0.0",
  mode: "production",
  jetson_rest_base_url: "https://jetson.example.invalid/api/v1",
  jetson_websocket_url: "wss://jetson.example.invalid/ws/v1",
  expected_result_schema_version: "1.0.0",
  connection_timeout_ms: 10000,
  stale_after_seconds: 60
};

function mockFetchSequence(responses: Array<{ ok: boolean; status: number; json: () => Promise<unknown> }>) {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => responses[Math.min(i++, responses.length - 1)])
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AdapterPairingController", () => {
  it("renders the idle form on construction", () => {
    mockFetchSequence([{ ok: true, status: 200, json: async () => ({}) }]);
    const el = new FakeElement();
    new AdapterPairingController(el as any, new IdentityApiClient(config));
    expect(el.innerHTML).toContain("vn-pairing");
    expect(el.innerHTML).toContain("data-action=\"start-pairing\"");
    expect(el.innerHTML).not.toContain("data-action=\"manual-assign\"");
  });

  it("requires a patient id before starting a pairing window", async () => {
    mockFetchSequence([{ ok: true, status: 200, json: async () => ({}) }]);
    const el = new FakeElement();
    new AdapterPairingController(el as any, new IdentityApiClient(config));
    el.click("start-pairing");
    await flush();
    // Still on the idle form (never transitioned to window_open) and shows an error.
    expect(el.innerHTML).toContain("data-action=\"start-pairing\"");
    expect(el.innerHTML).toContain("vn-error");
    expect((global.fetch as any)).not.toHaveBeenCalled();
  });

  it("full success flow: start -> auto-detect -> confirm -> assigned -> end session", async () => {
    mockFetchSequence([
      { ok: true, status: 200, json: async () => ({ window_id: "w1", patient_id: "P1", opened_at_utc: 0, expires_at_utc: 30, state: "OPEN" }) },
      {
        ok: true,
        status: 200,
        json: async () => ({
          window_id: "w1",
          patient_id: "P1",
          state: "OPEN",
          expires_at_utc: 30,
          new_candidates: [{ short_code: "VN-001", status: "READY" }],
          auto_bindable_short_code: "VN-001"
        })
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          assignment: { assignment_id: "a1", hardware_uid: "U1", short_code: "VN-001", patient_id: "P1", assigned_at_utc: 0, ended_at_utc: null, active: true },
          session: { session_id: "s1", assignment_id: "a1", hardware_uid: "U1", patient_id: "P1", started_at_utc: 0, ended_at_utc: null, active: true }
        })
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          session: { session_id: "s1", assignment_id: "a1", hardware_uid: "U1", patient_id: "P1", started_at_utc: 0, ended_at_utc: 5, active: false },
          assignment: { assignment_id: "a1", hardware_uid: "U1", short_code: "VN-001", patient_id: "P1", assigned_at_utc: 0, ended_at_utc: 5, active: false },
          adapter: { hardware_uid: "U1", short_code: "VN-001", inventory_status: "PROVISIONED", consumed: true, provisioned_at_utc: 0, identity_verified_at_utc: 0, consumed_at_utc: 5, updated_at_utc: 5 }
        })
      }
    ]);

    const el = new FakeElement();
    const controller = new AdapterPairingController(el as any, new IdentityApiClient(config));
    el.input("vn-pairing-patient-id", "P1");
    el.click("start-pairing");
    await flush();
    expect(el.innerHTML).toContain("VN-001");
    expect(el.innerHTML).toContain("data-action=\"confirm-assign\"");

    el.click("confirm-assign", { code: "VN-001" });
    await flush();
    expect(el.innerHTML).toContain("VN-001");
    expect(el.innerHTML).toContain("data-action=\"end-session\"");

    el.click("end-session");
    await flush();
    expect(el.innerHTML).not.toContain("data-action=\"end-session\"");
    void controller;
  });

  it("shows the Hebrew rejection message on a blocked assignment", async () => {
    mockFetchSequence([
      { ok: true, status: 200, json: async () => ({ window_id: "w1", patient_id: "P1", opened_at_utc: 0, expires_at_utc: 30, state: "OPEN" }) },
      { ok: true, status: 200, json: async () => ({ window_id: "w1", patient_id: "P1", state: "OPEN", expires_at_utc: 30, new_candidates: [], auto_bindable_short_code: null }) },
      {
        ok: false,
        status: 409,
        json: async () => ({ detail: { reason_code: "CODE_NOT_FOUND", message_he: "הקוד שהוזן אינו רשום במלאי המתאמים.", message: "not found" } })
      }
    ]);
    const el = new FakeElement();
    new AdapterPairingController(el as any, new IdentityApiClient(config));
    el.input("vn-pairing-patient-id", "P1");
    el.click("start-pairing");
    await flush();
    el.input("vn-pairing-manual-code", "VN-404");
    el.click("manual-assign");
    await flush();
    expect(el.innerHTML).toContain("הקוד שהוזן אינו רשום");
  });

  it("does not allow assignment after the pairing window expires", async () => {
    mockFetchSequence([
      { ok: true, status: 200, json: async () => ({ window_id: "w1", patient_id: "P1", opened_at_utc: 0, expires_at_utc: 30, state: "OPEN" }) },
      { ok: true, status: 200, json: async () => ({ window_id: "w1", patient_id: "P1", state: "EXPIRED", expires_at_utc: 30, new_candidates: [], auto_bindable_short_code: null }) }
    ]);
    const el = new FakeElement();
    new AdapterPairingController(el as any, new IdentityApiClient(config));
    el.input("vn-pairing-patient-id", "P1");
    el.click("start-pairing");
    await flush();
    expect(el.innerHTML).not.toContain("data-action=\"manual-assign\"");
    expect(el.innerHTML).toContain("חלון השיוך אינו פעיל");
    expect((global.fetch as any)).toHaveBeenCalledTimes(2);
  });
});

async function flush(): Promise<void> {
  // Several nested awaits separate a click from its render (controller ->
  // client.method -> request -> fetch -> json) — a couple of real
  // macrotask boundaries reliably drains all of them, where a fixed
  // number of microtask ticks alone was not always enough.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
