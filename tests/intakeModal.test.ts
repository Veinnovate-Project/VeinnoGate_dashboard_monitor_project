import { describe, it, expect, vi, afterEach } from "vitest";
import { IntakeModalController, UNDO_WINDOW_MS } from "../src/components/IntakeModalView";
import { IdentityAssignmentRejected } from "../src/api/identityClient";

// DOM-less, like adapterPairingView.test.ts: the controller only needs
// addEventListener + innerHTML from its container.
class FakeElement {
  innerHTML = "";
  private listeners: Record<string, (e: any) => void> = {};
  addEventListener(type: string, handler: (e: any) => void): void {
    this.listeners[type] = handler;
  }
  click(action: string, code: string): void {
    this.listeners.click?.({ target: { closest: () => ({ dataset: { action, code } }) } });
  }
  field(code: string, field: string, value: string | boolean): void {
    const target = typeof value === "boolean" ? { dataset: { code, field }, checked: value } : { dataset: { code, field }, value };
    this.listeners.input?.({ target });
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeClient(live: Array<{ short_code: string; status: string }>) {
  return {
    listLive: vi.fn(async () => ({ live: live.map((e) => ({ hardware_uid: null, ...e })) as any })),
    startPairing: vi.fn(async (patientId: string) => ({ window_id: `w_${patientId}` }) as any),
    assign: vi.fn(async (windowId: string, shortCode: string) => ({
      assignment: { patient_id: windowId.slice(2), short_code: shortCode },
      session: { session_id: `s_${shortCode}` }
    }) as any),
    cancelPairing: vi.fn(async () => ({}) as any)
  };
}

afterEach(() => vi.useRealTimers());

describe("IntakeModalController", () => {
  it("opens one independent card per READY adapter and ignores non-READY ones", async () => {
    const el = new FakeElement();
    const client = fakeClient([
      { short_code: "VN-001", status: "READY" },
      { short_code: "VN-002", status: "READY" },
      { short_code: "VN-003", status: "ALREADY_ASSIGNED" }
    ]);
    new IntakeModalController(el as any, client, vi.fn()).poll();
    await flush();
    expect(el.innerHTML.match(/role="dialog"/g)).toHaveLength(2);
    expect(el.innerHTML).toContain("VN-001");
    expect(el.innerHTML).toContain("VN-002");
    expect(el.innerHTML).not.toContain("VN-003");
  });

  it("assigns each adapter to its own patient without cross-talk and reports tile meta", async () => {
    const el = new FakeElement();
    const client = fakeClient([
      { short_code: "VN-001", status: "READY" },
      { short_code: "VN-002", status: "READY" }
    ]);
    const onAssigned = vi.fn();
    const c = new IntakeModalController(el as any, client, onAssigned);
    await c.poll();
    el.field("VN-001", "patientId", "P1");
    el.field("VN-001", "bed", "7");
    el.field("VN-002", "patientId", "P2");
    el.field("VN-001", "codeConfirmed", true);
    el.field("VN-002", "codeConfirmed", true);
    el.click("intake-submit", "VN-002");
    el.click("intake-submit", "VN-001");
    await flush();
    expect(client.assign).toHaveBeenCalledWith("w_P2", "VN-002");
    expect(client.assign).toHaveBeenCalledWith("w_P1", "VN-001");
    expect(onAssigned).toHaveBeenCalledWith(expect.anything(), { patientId: "P1", shortCode: "VN-001", bed: "7", department: null });
    expect(onAssigned).toHaveBeenCalledWith(expect.anything(), { patientId: "P2", shortCode: "VN-002", bed: null, department: null });
    expect(el.innerHTML).not.toContain('role="dialog"');
  });

  it("refuses to submit without patient id and code confirmation (no network call)", async () => {
    const el = new FakeElement();
    const client = fakeClient([{ short_code: "VN-001", status: "READY" }]);
    const c = new IntakeModalController(el as any, client, vi.fn());
    await c.poll();
    el.field("VN-001", "patientId", "P1");
    el.click("intake-submit", "VN-001");
    await flush();
    expect(client.startPairing).not.toHaveBeenCalled();
    expect(el.innerHTML).toContain("vn-error");
  });

  it("shows the backend's Hebrew rejection and cancels the opened window", async () => {
    const el = new FakeElement();
    const client = fakeClient([{ short_code: "VN-001", status: "READY" }]);
    client.assign.mockRejectedValueOnce(new IdentityAssignmentRejected("UID_CODE_MISMATCH", "השיוך נחסם."));
    const onAssigned = vi.fn();
    const c = new IntakeModalController(el as any, client, onAssigned);
    await c.poll();
    el.field("VN-001", "patientId", "P1");
    el.field("VN-001", "codeConfirmed", true);
    el.click("intake-submit", "VN-001");
    await flush();
    expect(el.innerHTML).toContain("השיוך נחסם.");
    expect(client.cancelPairing).toHaveBeenCalledWith("w_P1");
    expect(onAssigned).not.toHaveBeenCalled();
  });

  it("gives a 10 s undo after an accidental close, keeping the typed values", async () => {
    vi.useFakeTimers();
    const el = new FakeElement();
    const client = fakeClient([{ short_code: "VN-001", status: "READY" }]);
    const c = new IntakeModalController(el as any, client, vi.fn());
    await c.poll();
    el.field("VN-001", "patientId", "P1");
    el.click("intake-dismiss", "VN-001");
    expect(el.innerHTML).not.toContain('role="dialog"');
    expect(el.innerHTML).toContain('data-action="intake-undo"');
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    el.click("intake-undo", "VN-001");
    expect(el.innerHTML).toContain('role="dialog"');
    expect(el.innerHTML).toContain('value="P1"');
  });

  it("abandons after the undo window and does not reopen until the adapter goes OFF and ON", async () => {
    vi.useFakeTimers();
    const el = new FakeElement();
    const live = [{ short_code: "VN-001", status: "READY" }];
    const client = fakeClient(live);
    const c = new IntakeModalController(el as any, client, vi.fn());
    await c.poll();
    el.click("intake-dismiss", "VN-001");
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(el.innerHTML).toBe("");
    await c.poll();
    expect(el.innerHTML).toBe("");
    live.length = 0; // switched OFF
    await c.poll();
    live.push({ short_code: "VN-001", status: "READY" }); // switched ON again
    await c.poll();
    expect(el.innerHTML).toContain('role="dialog"');
  });
});
