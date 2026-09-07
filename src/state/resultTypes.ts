export type ResultState = "VALID" | "ABSTAIN" | "RECALIBRATE" | "INFERENCE_ERROR" | "DEVICE_DISCONNECTED";

export type CalibrationStatus =
  | "UNCALIBRATED"
  | "CALIBRATING"
  | "CALIBRATED"
  | "RECALIBRATION_DUE"
  | "EXPIRED"
  | "SENSOR_REPOSITIONED"
  | "CALIBRATION_FAILED";

export type SqiReasonCode =
  | "NO_PACKETS"
  | "SAMPLE_RATE_CHANGED"
  | "MALFORMED_PACKET"
  | "DUPLICATE_OR_REORDERED_SAMPLE"
  | "PACKET_LOSS"
  | "SATURATION_FLAG"
  | "CLIPPING"
  | "CONTACT_CHANGED"
  | "EXCESSIVE_MOTION"
  | "WINDOW_LENGTH"
  | "NONFINITE"
  | "POOR_CONTACT"
  | "RED_SQI_CORRELATION"
  | "RED_SQI_PULSATILITY"
  | "RESAMPLE_LENGTH"
  | "FLATLINE"
  | "UNKNOWN";

export interface JetsonResult {
  schema_version: "1.0.0";
  message_type: "vitals_result";
  result_state: ResultState;
  reading_id: string;
  session_id: string;
  patient_id: string;
  device_id: string;
  acquisition_start_utc: string;
  acquisition_end_utc: string;
  emitted_at_utc: string;
  connection: {
    status: "CONNECTED" | "RECONNECTING" | "DISCONNECTED";
    data_age_seconds: number | null;
  };
  bp: {
    sbp_mmhg: number | null;
    dbp_mmhg: number | null;
    unit: "mmHg";
    valid: boolean;
  };
  hr: {
    bpm: number | null;
    valid: boolean;
  };
  spo2: {
    pct: number | null;
    status: "UNAVAILABLE" | "VALID" | "INVALID";
    algorithm_name: string | null;
    algorithm_version: string | null;
  };
  calibration: {
    status: CalibrationStatus;
    calibration_id: string | null;
    calibrated_at_utc: string | null;
    warning_threshold_seconds: number;
    expiry_threshold_seconds: number;
    age_seconds: number | null;
    reason: string | null;
  };
  sqi: {
    accepted: boolean;
    reason_codes: SqiReasonCode[];
    metrics: {
      red_ir_correlation: number | null;
      red_pulsatility: number | null;
      packet_loss_fraction: number | null;
      duplicate_or_reordered_count: number | null;
      overflow_count: number | null;
      sample_count: number | null;
    };
  };
  provenance: {
    model_name: string | null;
    model_version: string | null;
    model_sha256: string | null;
    onnx_opset: number | null;
    preprocessing_version: string | null;
    morphology_version: string | null;
    sqi_version: string | null;
    calibration_protocol_version: string | null;
    ble_protocol_version: string | null;
    sensor_config_version: string | null;
  };
}

/** Internal, richer UI states -- always a deterministic derivation of JetsonResult, never a second authority. */
export type UiState =
  | "VALID"
  | "ABSTAIN"
  | "RECALIBRATE"
  | "INFERENCE_ERROR"
  | "DEVICE_DISCONNECTED"
  | "STALE"
  | "UNSUPPORTED_SCHEMA"
  | "UNSUPPORTED_STATE"
  | "AWAITING_FIRST_READING";
