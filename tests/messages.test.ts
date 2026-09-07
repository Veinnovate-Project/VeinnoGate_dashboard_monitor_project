import { describe, it, expect } from "vitest";
import { validateResult } from "../src/state/validateResult";
import { validReading, abstainReading, recalibrateReading } from "./mockServer/fixtures.mjs";

describe("valid messages", () => {
  it("accepts a well-formed VALID reading", () => {
    const outcome = validateResult(validReading("rd_1"));
    expect(outcome.ok).toBe(true);
  });

  it("accepts a well-formed ABSTAIN reading with a reason code", () => {
    const outcome = validateResult(abstainReading("rd_2"));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.sqi.reason_codes.length).toBeGreaterThan(0);
  });

  it("accepts a well-formed RECALIBRATE reading with a calibration reason", () => {
    const outcome = validateResult(recalibrateReading("rd_3"));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.calibration.reason).toBeTruthy();
  });
});

describe("invalid / malformed messages", () => {
  it("rejects a VALID result_state with null BP", () => {
    const bad = { ...validReading("rd_4"), bp: { sbp_mmhg: null, dbp_mmhg: null, unit: "mmHg", valid: true } };
    const outcome = validateResult(bad);
    expect(outcome.ok).toBe(false);
  });

  it("rejects a non-VALID result_state that still presents SBP/DBP", () => {
    const bad = abstainReading("rd_5");
    bad.bp = { sbp_mmhg: 130, dbp_mmhg: 80, unit: "mmHg", valid: true };
    const outcome = validateResult(bad);
    expect(outcome.ok).toBe(false);
  });

  it("rejects ABSTAIN with an empty reason_codes array", () => {
    const bad = abstainReading("rd_6");
    bad.sqi.reason_codes = [];
    const outcome = validateResult(bad);
    expect(outcome.ok).toBe(false);
  });

  it("rejects a payload with an unsupported schema_version", () => {
    const bad = { ...validReading("rd_7"), schema_version: "9.9.9" };
    const outcome = validateResult(bad);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("UNSUPPORTED_SCHEMA_VERSION");
  });

  it("rejects a completely malformed (non-object) payload without crashing", () => {
    expect(() => validateResult("not an object")).not.toThrow();
    expect(validateResult("not an object").ok).toBe(false);
    expect(validateResult(null).ok).toBe(false);
    expect(validateResult(undefined).ok).toBe(false);
  });

  it("rejects a payload missing required fields", () => {
    const bad = validReading("rd_8");
    delete bad.calibration;
    expect(validateResult(bad).ok).toBe(false);
  });
});
