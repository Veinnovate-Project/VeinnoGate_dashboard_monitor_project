/**
 * Battery% and BLE RSSI, as shown in the historical mockup's tile.
 *
 * Neither field exists in the frozen dashboard contract today:
 *  - battery is served only by Hardware's `/v1/health` (an ops-only
 *    endpoint the README explicitly excludes from the dashboard's
 *    consumer contract -- "the dashboard never calls them") and is itself
 *    `HARDWARE_VALIDATION_REQUIRED` pending Stage 15b physical closure
 *    (AGENTS.md).
 *  - RSSI is used only internally by Hardware's live-BLE-discovery/pairing
 *    gate; AGENTS.md forbids using it as a nurse-facing identity signal and
 *    no producer field surfaces it as display telemetry.
 *
 * This module is the single place that says "unavailable" for both, so
 * nothing else in the UI has to invent that judgment. Integration point:
 * once Hardware adds versioned `battery`/`rssi` fields to the
 * dashboard-consumed schema (jetson-result.schema.json), replace the
 * bodies below with real field reads -- the tile rendering already treats
 * `available: false` as the normal "no value yet" case, so no UI rework is
 * needed at that point.
 */
export interface DeviceTelemetry {
  batteryAvailable: false;
  batteryPct: null;
  rssiAvailable: false;
  rssiDbm: null;
}

export function computeDeviceTelemetry(): DeviceTelemetry {
  return { batteryAvailable: false, batteryPct: null, rssiAvailable: false, rssiDbm: null };
}
