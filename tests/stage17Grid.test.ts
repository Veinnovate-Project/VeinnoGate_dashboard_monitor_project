import { describe, it, expect, beforeEach } from "vitest";
import { computeNews2 } from "../src/state/news2";
import { computeAlertTier } from "../src/state/alerts";
import { computeDeviceTelemetry } from "../src/state/deviceTelemetry";
import { MultiSessionStore } from "../src/state/multiSessionStore";
import { renderTileGrid, acknowledgeAlert, setDischargeStatus, resetAcknowledgementsForTest } from "../src/components/TileGridView";
import type { JetsonResult } from "../src/state/resultTypes";
import { validReading, abstainReading } from "./mockServer/fixtures.mjs";

// Stage 17 grid: NEWS2 / alert tier / telemetry must stay unavailable unless
// every input is a validated real value -- never a fabricated number.

function withVitals(id: string, hr: number, spo2: number, sbp: number): JetsonResult {
  const r = validReading(id) as JetsonResult;
  return {
    ...r,
    hr: { bpm: hr, valid: true },
    spo2: { ...r.spo2, pct: spo2, status: "VALID", algorithm_name: "validated_alg", algorithm_version: "1.0.0" },
    bp: { ...r.bp, sbp_mmhg: sbp }
  } as JetsonResult;
}

describe("computeNews2 (partial: SpO2/pulse/SBP)", () => {
  it("is unavailable for today's production default (SpO2 UNAVAILABLE)", () => {
    expect(computeNews2(validReading("rd_1") as JetsonResult)).toMatchObject({ available: false, score: null });
  });

  it("is unavailable for non-VALID result states", () => {
    expect(computeNews2(abstainReading("rd_1") as JetsonResult).available).toBe(false);
  });

  it("is unavailable when HR is not valid", () => {
    const r = withVitals("rd_1", 74, 97, 122);
    expect(computeNews2({ ...r, hr: { bpm: 74, valid: false } }).available).toBe(false);
  });

  it("scores 0 for normal vitals", () => {
    expect(computeNews2(withVitals("rd_1", 74, 97, 122))).toMatchObject({ available: true, score: 0 });
  });

  it("scores table boundaries", () => {
    // SpO2 91 -> 3, pulse 131 -> 3, SBP 100 -> 2
    expect(computeNews2(withVitals("rd_1", 131, 91, 100))).toMatchObject({ score: 8, spo2Points: 3, pulsePoints: 3, sbpPoints: 2 });
    // SpO2 95 -> 1, pulse 91 -> 1, SBP 220 -> 3
    expect(computeNews2(withVitals("rd_1", 91, 95, 220))).toMatchObject({ score: 5, spo2Points: 1, pulsePoints: 1, sbpPoints: 3 });
  });
});

describe("computeAlertTier", () => {
  it("has no tier when NEWS2 is unavailable", () => {
    expect(computeAlertTier(validReading("rd_1") as JetsonResult).tier).toBeNull();
  });

  it("selects routine / watch / urgent / critical", () => {
    expect(computeAlertTier(withVitals("rd_1", 74, 97, 122)).tier).toBe("routine");
    expect(computeAlertTier(withVitals("rd_1", 95, 97, 122)).tier).toBe("watch");
    expect(computeAlertTier(withVitals("rd_1", 74, 91, 122)).tier).toBe("urgent");
    expect(computeAlertTier(withVitals("rd_1", 74, 88, 122)).tier).toBe("critical");
    expect(computeAlertTier(withVitals("rd_1", 74, 97, 89)).tier).toBe("critical");
  });
});

describe("computeDeviceTelemetry", () => {
  it("never reports a battery or RSSI value (no contract field yet)", () => {
    expect(computeDeviceTelemetry()).toEqual({ batteryAvailable: false, batteryPct: null, rssiAvailable: false, rssiDbm: null });
  });
});

describe("MultiSessionStore", () => {
  it("demuxes readings into one tile per session_id", () => {
    const store = new MultiSessionStore(30);
    store.ingest({ ...validReading("rd_a1"), session_id: "s_a" });
    store.ingest({ ...validReading("rd_b1"), session_id: "s_b" });
    store.ingest({ ...validReading("rd_a2"), session_id: "s_a" });
    const tiles = store.getTiles();
    expect(tiles.map((t) => t.sessionId)).toEqual(["s_a", "s_b"]);
    expect(tiles[0]!.display.current?.reading_id).toBe("rd_a2");
    expect(tiles[1]!.display.current?.reading_id).toBe("rd_b1");
  });

  it("routes session_id-less messages to a visible unrouted tile", () => {
    const store = new MultiSessionStore(30);
    store.ingest({ garbage: true });
    expect(store.getTiles().map((t) => t.sessionId)).toEqual(["__unrouted__"]);
  });

  it("removes a discharged session", () => {
    const store = new MultiSessionStore(30);
    store.ingest({ ...validReading("rd_a1"), session_id: "s_a" });
    store.removeSession("s_a");
    expect(store.getTiles()).toEqual([]);
  });
});

describe("renderTileGrid", () => {
  beforeEach(() => resetAcknowledgementsForTest());

  function gridFor(result: object): string {
    const store = new MultiSessionStore(30);
    store.ingest(result);
    return renderTileGrid(store.getTiles(), "en", "OPEN");
  }

  it("renders unavailable NEWS2/battery/RSSI and no banner for production-default data", () => {
    const html = gridFor(validReading("rd_1"));
    expect(html).toContain("vn-badge--muted");
    expect(html).not.toContain("vn-alert-banner");
    expect(html).not.toMatch(/\(partial\) \d/);
  });

  it("renders a critical banner until acknowledged", () => {
    const store = new MultiSessionStore(30);
    store.ingest(withVitals("rd_1", 74, 85, 122));
    const sessionId = store.getTiles()[0]!.sessionId;
    expect(renderTileGrid(store.getTiles(), "en", "OPEN")).toContain("vn-alert-banner--critical");
    acknowledgeAlert(sessionId, "critical");
    expect(renderTileGrid(store.getTiles(), "en", "OPEN")).not.toContain("vn-alert-banner");
  });

  it("re-shows the banner when an acknowledged alert escalates", () => {
    const store = new MultiSessionStore(30);
    store.ingest(withVitals("rd_1", 74, 91, 122));
    const sessionId = store.getTiles()[0]!.sessionId;
    expect(renderTileGrid(store.getTiles(), "en", "OPEN")).toContain("vn-alert-banner--urgent");
    acknowledgeAlert(sessionId, "urgent");
    expect(renderTileGrid(store.getTiles(), "en", "OPEN")).not.toContain("vn-alert-banner");
    store.ingest(withVitals("rd_2", 74, 85, 122));
    expect(renderTileGrid(store.getTiles(), "en", "OPEN")).toContain("vn-alert-banner--critical");
  });

  it("shows pending and failed discharge states on the tile", () => {
    const store = new MultiSessionStore(30);
    store.addSession("s_a", { patientId: "P1", shortCode: "VN-001", bed: "12", department: null });
    setDischargeStatus("s_a", "pending");
    expect(renderTileGrid(store.getTiles(), "en", "OPEN")).toContain("Discharging…");
    setDischargeStatus("s_a", "failed");
    const html = renderTileGrid(store.getTiles(), "en", "OPEN");
    expect(html).toContain("Discharge failed");
    expect(html).toContain('role="alert"');
  });

  it("creates a tile from an assignment event before any reading, with no vitals", () => {
    const store = new MultiSessionStore(30);
    store.addSession("s_a", { patientId: "P1", shortCode: "VN-001", bed: "12", department: "ICU" });
    const tiles = store.getTiles();
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.display.uiState).toBe("AWAITING_FIRST_READING");
    const html = renderTileGrid(tiles, "en", "OPEN");
    expect(html).toContain("VN-001 · Department: ICU · Bed: 12");
    expect(html).toContain("NEWS2 unavailable");
  });
});
