const BASE = {
  schema_version: "1.0.0",
  message_type: "vitals_result",
  session_id: "mock_session_1",
  patient_id: "mock_patient_1",
  device_id: "mock_device_1",
  connection: { status: "CONNECTED", data_age_seconds: 0 },
  spo2: { pct: null, status: "UNAVAILABLE", algorithm_name: null, algorithm_version: null },
  provenance: {
    model_name: "personaldelta_ensemble_42_43_44",
    model_version: "1.0.0",
    model_sha256: "cb320a28b0abd48c2f6e34828c83b50ecce3c1f0c30f7fc8402b964cd74c8cd0",
    onnx_opset: 17,
    preprocessing_version: "max30102-ppg-v1",
    morphology_version: "morphology-13-v1",
    sqi_version: "max30102-sqi-v1",
    calibration_protocol_version: "personaldelta-cal-v1",
    ble_protocol_version: "ble-v1",
    sensor_config_version: "sensor-v1"
  }
};

// A monotonic counter (not wall-clock alone) guarantees each fixture call gets
// a strictly later acquisition/emission time than the previous one, even when
// two fixtures are built within the same millisecond in a fast test run.
let monotonicMs = 0;

function iso(offsetSeconds = 0) {
  monotonicMs += 1;
  return new Date(Date.now() + offsetSeconds * 1000 + monotonicMs).toISOString();
}

export function validReading(readingId) {
  return {
    ...BASE,
    result_state: "VALID",
    reading_id: readingId,
    acquisition_start_utc: iso(-30),
    acquisition_end_utc: iso(0),
    emitted_at_utc: iso(0),
    bp: { sbp_mmhg: 122, dbp_mmhg: 78, unit: "mmHg", valid: true },
    hr: { bpm: 74, valid: true },
    calibration: {
      status: "CALIBRATED",
      calibration_id: "mock_cal_1",
      calibrated_at_utc: iso(-3600),
      warning_threshold_seconds: 14400,
      expiry_threshold_seconds: 21600,
      age_seconds: 3600,
      reason: null
    },
    sqi: {
      accepted: true,
      reason_codes: [],
      metrics: {
        red_ir_correlation: 0.74,
        red_pulsatility: 0.0022,
        packet_loss_fraction: 0,
        duplicate_or_reordered_count: 0,
        overflow_count: 0,
        sample_count: 3000
      }
    }
  };
}

export function abstainReading(readingId) {
  const base = validReading(readingId);
  return {
    ...base,
    result_state: "ABSTAIN",
    bp: { sbp_mmhg: null, dbp_mmhg: null, unit: "mmHg", valid: false },
    sqi: { ...base.sqi, accepted: false, reason_codes: ["POOR_CONTACT"] }
  };
}

export function recalibrateReading(readingId) {
  const base = validReading(readingId);
  return {
    ...base,
    result_state: "RECALIBRATE",
    bp: { sbp_mmhg: null, dbp_mmhg: null, unit: "mmHg", valid: false },
    calibration: { ...base.calibration, status: "EXPIRED", age_seconds: 21700, reason: "Calibration window exceeded" }
  };
}
