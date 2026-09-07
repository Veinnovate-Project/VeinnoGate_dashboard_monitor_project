import { describe, it, expect } from "vitest";
import { validateResult } from "../src/state/validateResult";
import { validReading } from "./mockServer/fixtures.mjs";

describe("SpO2 handling", () => {
  it("accepts UNAVAILABLE spo2 with a null percentage (the current real state)", () => {
    const reading = validReading("rd_1");
    expect(reading.spo2).toEqual({ pct: null, status: "UNAVAILABLE", algorithm_name: null, algorithm_version: null });
    expect(validateResult(reading).ok).toBe(true);
  });

  it("rejects a non-null spo2 percentage while status is UNAVAILABLE", () => {
    const reading = validReading("rd_2");
    reading.spo2 = { pct: 97, status: "UNAVAILABLE", algorithm_name: null, algorithm_version: null };
    expect(validateResult(reading).ok).toBe(false);
  });

  it("requires algorithm name/version whenever spo2 status is VALID", () => {
    const reading = validReading("rd_3");
    reading.spo2 = { pct: 97, status: "VALID", algorithm_name: null, algorithm_version: null };
    expect(validateResult(reading).ok).toBe(false);
  });

  it("accepts a VALID spo2 only when percentage and algorithm provenance are all present", () => {
    const reading = validReading("rd_4");
    reading.spo2 = { pct: 97, status: "VALID", algorithm_name: "max30102-spo2-v1", algorithm_version: "1.0.0" };
    expect(validateResult(reading).ok).toBe(true);
  });
});
