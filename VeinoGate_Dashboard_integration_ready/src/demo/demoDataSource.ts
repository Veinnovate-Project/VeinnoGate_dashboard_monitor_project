import type { JetsonResult, ResultState } from "../state/resultTypes";

// Math.random() must exist ONLY in this file. scripts/check-no-random-in-prod.mjs
// fails the build if it ever appears in a production (index.html-rooted) bundle.
// This module must never be imported from src/main.ts.

const CYCLE: ResultState[] = ["VALID", "VALID", "ABSTAIN", "VALID", "RECALIBRATE", "VALID", "INFERENCE_ERROR", "VALID"];
let cycleIndex = 0;
let readingCounter = 0;

function isoNow(offsetSeconds = 0): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

export function generateDemoResult(): JetsonResult {
  const resultState = CYCLE[cycleIndex % CYCLE.length] as ResultState;
  cycleIndex += 1;
  readingCounter += 1;

  const isValid = resultState === "VALID";
  const sbp = isValid ? Math.round(110 + Math.random() * 20) : null;
  const dbp = isValid ? Math.round(70 + Math.random() * 12) : null;

  return {
    schema_version: "1.0.0",
    message_type: "vitals_result",
    result_state: resultState,
    reading_id: `demo_rd_${readingCounter}`,
    session_id: "demo_session_1",
    patient_id: "demo_patient_1",
    device_id: "demo_device_1",
    acquisition_start_utc: isoNow(-30),
    acquisition_end_utc: isoNow(0),
    emitted_at_utc: isoNow(0),
    connection: { status: "CONNECTED", data_age_seconds: 0 },
    bp: { sbp_mmhg: sbp, dbp_mmhg: dbp, unit: "mmHg", valid: isValid },
    hr: { bpm: isValid ? Math.round(60 + Math.random() * 40) : null, valid: isValid },
    spo2: { pct: null, status: "UNAVAILABLE", algorithm_name: null, algorithm_version: null },
    calibration: {
      status: resultState === "RECALIBRATE" ? "EXPIRED" : "CALIBRATED",
      calibration_id: "demo_cal_1",
      calibrated_at_utc: isoNow(-3600),
      warning_threshold_seconds: 14400,
      expiry_threshold_seconds: 21600,
      age_seconds: resultState === "RECALIBRATE" ? 21700 : 3600,
      reason: resultState === "RECALIBRATE" ? "Calibration expired (demo)" : null
    },
    sqi: {
      accepted: resultState !== "ABSTAIN",
      reason_codes: resultState === "ABSTAIN" ? ["POOR_CONTACT"] : [],
      metrics: {
        red_ir_correlation: 0.7,
        red_pulsatility: 0.002,
        packet_loss_fraction: 0,
        duplicate_or_reordered_count: 0,
        overflow_count: 0,
        sample_count: 3000
      }
    },
    provenance: {
      model_name: "demo_model",
      model_version: "0.0.0-demo",
      model_sha256: null,
      onnx_opset: null,
      preprocessing_version: "demo",
      morphology_version: "demo",
      sqi_version: "demo",
      calibration_protocol_version: "demo",
      ble_protocol_version: "demo",
      sensor_config_version: "demo"
    }
  };
}
