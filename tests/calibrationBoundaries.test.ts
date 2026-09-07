import { describe, it, expect } from "vitest";
import { deriveCalibrationDisplay } from "../src/state/calibrationDisplay";

const WARN = 14400; // 4 hours
const EXPIRE = 21600; // 6 hours

function calibration(ageSeconds: number, status: "CALIBRATED" | "RECALIBRATION_DUE" | "EXPIRED" = "CALIBRATED") {
  return {
    status,
    calibration_id: "cal_1",
    calibrated_at_utc: new Date().toISOString(),
    warning_threshold_seconds: WARN,
    expiry_threshold_seconds: EXPIRE,
    age_seconds: ageSeconds,
    reason: null
  } as const;
}

describe("calibration boundary rendering", () => {
  it("shows OK just before the 4-hour warning boundary", () => {
    expect(deriveCalibrationDisplay(calibration(WARN - 1)).badge).toBe("OK");
  });

  it("shows DUE_SOON exactly at the 4-hour boundary", () => {
    expect(deriveCalibrationDisplay(calibration(WARN)).badge).toBe("DUE_SOON");
  });

  it("shows DUE_SOON just after the 4-hour boundary", () => {
    expect(deriveCalibrationDisplay(calibration(WARN + 1)).badge).toBe("DUE_SOON");
  });

  it("shows DUE_SOON just before the 6-hour expiry boundary", () => {
    expect(deriveCalibrationDisplay(calibration(EXPIRE - 1)).badge).toBe("DUE_SOON");
  });

  it("shows EXPIRED exactly at the 6-hour boundary", () => {
    expect(deriveCalibrationDisplay(calibration(EXPIRE)).badge).toBe("EXPIRED");
  });

  it("shows EXPIRED just after the 6-hour boundary", () => {
    expect(deriveCalibrationDisplay(calibration(EXPIRE + 1)).badge).toBe("EXPIRED");
  });

  it("never uses a locally hardcoded threshold -- honors whatever the Jetson sends", () => {
    const custom = calibration(100, "CALIBRATED");
    const withTightThresholds = { ...custom, warning_threshold_seconds: 50, expiry_threshold_seconds: 90 };
    expect(deriveCalibrationDisplay(withTightThresholds).badge).toBe("EXPIRED");
  });
});
