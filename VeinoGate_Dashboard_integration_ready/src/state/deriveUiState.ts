import type { JetsonResult, UiState } from "./resultTypes";

/**
 * Single deterministic mapping from the backend's authoritative result_state
 * (plus connection/staleness) to the richer internal UI state. This is the
 * only place that interprets result_state -- nothing else in the UI layer may
 * introduce a competing clinical judgment.
 */
export function deriveUiState(result: JetsonResult, dataAgeSeconds: number | null, staleAfterSeconds: number): UiState {
  if (result.connection.status === "DISCONNECTED") return "DEVICE_DISCONNECTED";

  if (dataAgeSeconds !== null && dataAgeSeconds > staleAfterSeconds) return "STALE";

  switch (result.result_state) {
    case "VALID":
    case "ABSTAIN":
    case "RECALIBRATE":
    case "INFERENCE_ERROR":
    case "DEVICE_DISCONNECTED":
      return result.result_state;
    default:
      // Any future/unknown result_state renders a safe unsupported state rather
      // than crashing or displaying values that were never validated for it.
      return "UNSUPPORTED_STATE";
  }
}
