import { describe, it, expect } from "vitest";
import { MessageGuard } from "../src/state/messageGuard";
import { validateResult } from "../src/state/validateResult";
import { validReading } from "./mockServer/fixtures.mjs";

function ok(raw: unknown) {
  const outcome = validateResult(raw);
  if (!outcome.ok) throw new Error("fixture should validate");
  return outcome.result;
}

describe("duplicate and out-of-order handling", () => {
  it("accepts the first reading", () => {
    const guard = new MessageGuard();
    expect(guard.evaluate(ok(validReading("rd_1"))).accepted).toBe(true);
  });

  it("rejects an exact duplicate reading_id", () => {
    const guard = new MessageGuard();
    const reading = ok(validReading("rd_dup"));
    expect(guard.evaluate(reading).accepted).toBe(true);
    const outcome = guard.evaluate(reading);
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) expect(outcome.reason).toBe("DUPLICATE");
  });

  it("rejects a delayed/older reading that arrives after a newer one", () => {
    const guard = new MessageGuard();
    const first = ok(validReading("rd_a"));
    const second = ok(validReading("rd_b"));
    second.acquisition_end_utc = new Date(Date.parse(first.acquisition_end_utc) + 5000).toISOString();
    const stale = ok(validReading("rd_c"));
    stale.acquisition_end_utc = new Date(Date.parse(first.acquisition_end_utc) - 5000).toISOString();

    expect(guard.evaluate(first).accepted).toBe(true);
    expect(guard.evaluate(second).accepted).toBe(true);
    const outcome = guard.evaluate(stale);
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) expect(outcome.reason).toBe("OUT_OF_ORDER");
  });

  it("accepts a new reading after an identity change even if timestamps look older", () => {
    const guard = new MessageGuard();
    const first = ok(validReading("rd_x"));
    expect(guard.evaluate(first).accepted).toBe(true);

    const reassigned = ok(validReading("rd_y"));
    reassigned.session_id = "new_session";
    reassigned.acquisition_end_utc = new Date(Date.parse(first.acquisition_end_utc) - 60000).toISOString();
    expect(guard.evaluate(reassigned).accepted).toBe(true);
  });
});
