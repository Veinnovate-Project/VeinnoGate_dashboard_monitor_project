import type { TileState } from "../state/multiSessionStore";
import { renderDashboard } from "./DashboardView";
import { computeNews2 } from "../state/news2";
import { computeAlertTier, type AlertTier } from "../state/alerts";
import { computeDeviceTelemetry } from "../state/deviceTelemetry";
import { t, type Locale } from "../i18n/strings";
import type { SocketStatus } from "../api/jetsonSocket";

/**
 * One tile per active session, wrapping the existing single-session
 * `renderDashboard` panel (unchanged, still independently used by
 * src/main.demo.ts and its own tests) with the mockup's remaining tile
 * chrome: patient/session header, partial-NEWS2 chip, alert banner,
 * battery/RSSI row, and a discharge control. Kept as a separate module
 * (rather than editing DashboardView.ts) so the existing single-panel
 * rendering path -- and every test/consumer of it -- stays byte-identical.
 */

const acknowledged = new Set<string>();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

function tierLabel(tier: AlertTier, locale: Locale): string {
  switch (tier) {
    case "critical": return t(locale, "tierCritical");
    case "urgent": return t(locale, "tierUrgent");
    case "watch": return t(locale, "tierWatch");
    default: return t(locale, "tierRoutine");
  }
}

function renderNews2Chip(tile: TileState, locale: Locale): string {
  const result = tile.display.current;
  const news2 = result ? computeNews2(result) : { available: false, score: null };
  if (!news2.available || news2.score === null) {
    return `<span class="vn-badge vn-badge--muted" title="${escapeHtml(t(locale, "news2PartialTooltip"))}">${escapeHtml(t(locale, "news2Unavailable"))}</span>`;
  }
  return `<span class="vn-badge vn-badge--accent" title="${escapeHtml(t(locale, "news2PartialTooltip"))}">${escapeHtml(t(locale, "news2Label"))} ${news2.score}</span>`;
}

function renderAlertBanner(tile: TileState, locale: Locale): string {
  const result = tile.display.current;
  if (!result) return "";
  const { tier, reasons } = computeAlertTier(result);
  if (tier === null || tier === "routine") return "";
  if (tier === "watch") {
    // Mockup §5.3: watch is chip-only, no banner, no sound.
    return "";
  }
  if (acknowledged.has(tile.sessionId)) return "";
  const cls = tier === "critical" ? "vn-alert-banner vn-alert-banner--critical" : "vn-alert-banner vn-alert-banner--urgent";
  return `
    <div class="${cls}" role="alert">
      <span>${escapeHtml(tierLabel(tier, locale))} · ${escapeHtml(reasons.join(", "))}</span>
      <button data-action="acknowledge" data-session-id="${escapeHtml(tile.sessionId)}">${escapeHtml(t(locale, "acknowledge"))}</button>
    </div>`;
}

function renderTelemetryRow(locale: Locale): string {
  const telemetry = computeDeviceTelemetry();
  return `
    <div class="vn-telemetry-row">
      <span class="vn-metric-label">${escapeHtml(t(locale, "batteryLabel"))}: ${telemetry.batteryAvailable ? telemetry.batteryPct : escapeHtml(t(locale, "unavailable"))}</span>
      <span class="vn-metric-label">${escapeHtml(t(locale, "rssiLabel"))}: ${telemetry.rssiAvailable ? telemetry.rssiDbm : escapeHtml(t(locale, "unavailable"))}</span>
    </div>`;
}

export function renderTileGrid(tiles: TileState[], locale: Locale, socketStatus: SocketStatus): string {
  if (tiles.length === 0) {
    return `<div class="vn-panel" dir="${locale === "he" ? "rtl" : "ltr"}"><div class="vn-tile-title">${escapeHtml(t(locale, "noActiveSessions"))}</div></div>`;
  }
  const dir = locale === "he" ? "rtl" : "ltr";
  const sorted = sortTiles(tiles);
  const cards = sorted
    .map((tile) => {
      const patientId = tile.display.current?.patient_id ?? tile.sessionId;
      return `
      <article class="vn-tile" dir="${dir}" data-session-id="${escapeHtml(tile.sessionId)}">
        <div class="vn-tile-header">
          <span class="vn-tile-patient">${escapeHtml(t(locale, "patientLabel"))}: ${escapeHtml(patientId)}</span>
          ${renderNews2Chip(tile, locale)}
          <button class="vn-tile-discharge" data-action="discharge-tile" data-session-id="${escapeHtml(tile.sessionId)}">${escapeHtml(t(locale, "dischargeButton"))}</button>
        </div>
        ${renderAlertBanner(tile, locale)}
        ${renderDashboard(tile.display, locale, socketStatus)}
        ${renderTelemetryRow(locale)}
      </article>`;
    })
    .join("");
  return `<div class="vn-tile-grid">${cards}</div>`;
}

function tileSortRank(tile: TileState): number {
  const result = tile.display.current;
  const tier = result ? computeAlertTier(result).tier : null;
  if (tier === "critical" || tier === "urgent") return 0;
  if (tile.display.uiState === "DEVICE_DISCONNECTED") return 2;
  return 1;
}

/** Mockup §6.3: "Tiles sort: alerting -> normal -> disconnected -> closing." */
function sortTiles(tiles: TileState[]): TileState[] {
  return [...tiles].sort((a, b) => tileSortRank(a) - tileSortRank(b));
}

export function acknowledgeAlert(sessionId: string): void {
  acknowledged.add(sessionId);
}

/** Clears acknowledgement once the alert condition itself changes (mockup §5.4: non-latching). */
export function clearAcknowledgement(sessionId: string): void {
  acknowledged.delete(sessionId);
}

/** Test-only reset of the module-level acknowledgement set. */
export function resetAcknowledgementsForTest(): void {
  acknowledged.clear();
}
