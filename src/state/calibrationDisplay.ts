import type { JetsonResult } from "./resultTypes";

export type CalibrationBadge = "OK" | "DUE_SOON" | "EXPIRED" | "UNKNOWN";

export interface CalibrationDisplay {
  badge: CalibrationBadge;
  label: string;
  ageSeconds: number | null;
}

/**
 * Renders a calibration age badge purely from the thresholds and age the Jetson
 * supplied on this message -- there is no locally hardcoded 4h/6h constant here.
 * If the Jetson omits age/thresholds the message fails schema validation before
 * it ever reaches this function, so "UNKNOWN" only occurs for calibration
 * statuses that have no meaningful age (e.g. UNCALIBRATED).
 */
export function deriveCalibrationDisplay(calibration: JetsonResult["calibration"]): CalibrationDisplay {
  const { age_seconds, warning_threshold_seconds, expiry_threshold_seconds, status } = calibration;

  if (status === "EXPIRED") {
    return { badge: "EXPIRED", label: "Calibration expired", ageSeconds: age_seconds };
  }
  if (status === "SENSOR_REPOSITIONED" || status === "CALIBRATION_FAILED" || status === "UNCALIBRATED") {
    return { badge: "UNKNOWN", label: "No valid calibration", ageSeconds: age_seconds };
  }
  if (status === "CALIBRATING") {
    return { badge: "UNKNOWN", label: "Calibrating…", ageSeconds: null };
  }

  if (age_seconds === null) {
    return { badge: "UNKNOWN", label: "Calibration age unknown", ageSeconds: null };
  }

  if (age_seconds >= expiry_threshold_seconds || status === "RECALIBRATION_DUE" && age_seconds >= expiry_threshold_seconds) {
    return { badge: "EXPIRED", label: "Calibration expired", ageSeconds: age_seconds };
  }
  if (age_seconds >= warning_threshold_seconds) {
    return { badge: "DUE_SOON", label: "Calibration due soon", ageSeconds: age_seconds };
  }
  return { badge: "OK", label: "Calibration current", ageSeconds: age_seconds };
}
