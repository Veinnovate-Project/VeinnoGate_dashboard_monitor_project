import type { DisplayState } from "../state/store";
import { deriveCalibrationDisplay } from "../state/calibrationDisplay";
import { t, type Locale } from "../i18n/strings";
import type { SocketStatus } from "../api/jetsonSocket";

function badgeClass(kind: "OK" | "DUE_SOON" | "EXPIRED" | "UNKNOWN"): string {
  switch (kind) {
    case "OK": return "vn-badge vn-badge--ok";
    case "DUE_SOON": return "vn-badge vn-badge--warn";
    case "EXPIRED": return "vn-badge vn-badge--danger";
    default: return "vn-badge vn-badge--muted";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

/**
 * Renders the whole dashboard as one HTML string from a DisplayState. Kept as
 * a single pure function (no framework) so production and demo share exactly
 * the same rendering logic and cannot visually diverge in what a given
 * backend state looks like.
 */
export function renderDashboard(state: DisplayState, locale: Locale, socketStatus: SocketStatus): string {
  const dir = locale === "he" ? "rtl" : "ltr";
  const connectionLine = renderConnection(socketStatus, locale);

  if (state.uiState === "AWAITING_FIRST_READING") {
    return panel(dir, `<div class="vn-tile-title">${t(locale, "awaitingFirstReading")}</div>${connectionLine}`);
  }
  if (state.uiState === "UNSUPPORTED_SCHEMA") {
    return panel(
      dir,
      `<span class="vn-badge vn-badge--danger">${escapeHtml(t(locale, "unsupportedSchema"))}</span>
       ${state.lastError ? `<div class="vn-error">${escapeHtml(state.lastError.details)}</div>` : ""}`
    );
  }

  const result = state.current;
  if (!result) {
    return panel(dir, connectionLine);
  }

  const calibration = deriveCalibrationDisplay(result.calibration);

  let body = "";
  switch (state.uiState) {
    case "VALID":
      body = `
        <div class="vn-bp-value">${result.bp.sbp_mmhg}/${result.bp.dbp_mmhg} <span style="font-size:16px;color:var(--muted)">mmHg</span></div>
        ${renderHrSpo2(result, locale)}
      `;
      break;
    case "ABSTAIN":
      body = `
        <span class="vn-badge vn-badge--warn">${escapeHtml(t(locale, "bpUnavailableSqi"))}</span>
        <div class="vn-reason">${escapeHtml(result.sqi.reason_codes.join(", ") || "UNKNOWN")}</div>
        ${renderPreviousValid(state, locale)}
      `;
      break;
    case "RECALIBRATE":
      body = `
        <span class="vn-badge vn-badge--warn">${escapeHtml(t(locale, "bpUnavailableRecalibrate"))}</span>
        <div class="vn-reason">${escapeHtml(result.calibration.reason ?? "")}</div>
        ${renderPreviousValid(state, locale)}
      `;
      break;
    case "INFERENCE_ERROR":
      body = `<span class="vn-badge vn-badge--danger">${escapeHtml(t(locale, "bpUnavailableInferenceError"))}</span>`;
      break;
    case "DEVICE_DISCONNECTED":
      body = `
        <span class="vn-badge vn-badge--danger">${escapeHtml(t(locale, "deviceDisconnected"))}</span>
        ${renderDataAge(result, locale)}
        ${renderPreviousValid(state, locale)}
      `;
      break;
    case "STALE":
      body = `
        <span class="vn-badge vn-badge--warn">${escapeHtml(t(locale, "dataAge"))}</span>
        ${renderDataAge(result, locale)}
        ${renderPreviousValid(state, locale)}
      `;
      break;
    default:
      body = `<span class="vn-badge vn-badge--muted">${escapeHtml(t(locale, "unsupportedState"))}</span>`;
  }

  return panel(
    dir,
    `${body}
     <div style="margin-top:12px">
       <span class="${badgeClass(calibration.badge)}">${escapeHtml(calibration.label)}</span>
     </div>
     ${connectionLine}`
  );
}

function renderHrSpo2(result: NonNullable<DisplayState["current"]>, locale: Locale): string {
  const spo2Text = result.spo2.status === "VALID" ? `${result.spo2.pct}%` : t(locale, "spo2Unavailable");
  return `
    <div class="vn-hr-spo2-row">
      <div><div class="vn-metric-label">HR</div><div class="vn-metric-value">${result.hr.valid && result.hr.bpm !== null ? `${result.hr.bpm} bpm` : "—"}</div></div>
      <div><div class="vn-metric-label">SpO₂</div><div class="vn-metric-value">${escapeHtml(spo2Text)}</div></div>
    </div>
  `;
}

function renderPreviousValid(state: DisplayState, locale: Locale): string {
  if (!state.previousValid) return "";
  return `<div class="vn-previous">${escapeHtml(t(locale, "previousValidReading"))}: ${state.previousValid.sbpMmHg}/${state.previousValid.dbpMmHg} mmHg · ${escapeHtml(state.previousValid.capturedAtUtc)}</div>`;
}

function renderDataAge(result: NonNullable<DisplayState["current"]>, locale: Locale): string {
  const age = result.connection.data_age_seconds;
  if (age === null) return "";
  return `<div class="vn-previous">${escapeHtml(t(locale, "dataAge"))}: ${Math.round(age)}s</div>`;
}

function renderConnection(status: SocketStatus, locale: Locale): string {
  if (status === "OPEN") return "";
  const text = status === "CLOSED" ? t(locale, "connectionClosed") : t(locale, "connectionReconnecting");
  return `<div class="vn-connection vn-badge vn-badge--warn">${escapeHtml(text)}</div>`;
}

function panel(dir: string, inner: string): string {
  return `<div class="vn-panel" dir="${dir}">${inner}</div>`;
}
