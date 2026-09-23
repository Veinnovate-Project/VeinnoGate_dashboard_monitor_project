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
  const hrKnown = result.hr.valid && result.hr.bpm !== null;
  const spo2Known = result.spo2.status === "VALID" && result.spo2.pct !== null;
  return `
    <div class="vn-metric-grid">
      <div class="vn-metric-cell">
        <div class="vn-metric-icon-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5S3.8 15.6 3.8 10.2A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 8.2 2.2c0 5.4-8.2 10.3-8.2 10.3z"></path></svg>
          <span class="vn-metric-name">HR</span>
        </div>
        <div class="vn-metric-value${hrKnown ? "" : " vn-metric-value--muted"}">${hrKnown ? result.hr.bpm : "—"}</div>
        <div class="vn-metric-unit">BPM</div>
      </div>
      <div class="vn-metric-cell">
        <div class="vn-metric-icon-row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"></path></svg>
          <span class="vn-metric-name">SpO₂</span>
        </div>
        <div class="vn-metric-value${spo2Known ? "" : " vn-metric-value--muted"}">${spo2Known ? result.spo2.pct : "—"}</div>
        <div class="vn-metric-unit">${spo2Known ? "%" : escapeHtml(t(locale, "spo2Unavailable"))}</div>
      </div>
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
