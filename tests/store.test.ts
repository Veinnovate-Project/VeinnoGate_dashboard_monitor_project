import { describe, it, expect } from "vitest";
import { VitalsStore } from "../src/state/store";
import { validReading, abstainReading, recalibrateReading } from "./mockServer/fixtures.mjs";

describe("VitalsStore", () => {
  it("shows VALID BP for a valid reading", () => {
    const store = new VitalsStore(60);
    store.ingest(validReading("rd_1"));
    expect(store.getState().uiState).toBe("VALID");
    expect(store.getState().current?.bp.sbp_mmhg).toBe(122);
  });

  it("retains the previous valid reading through a later ABSTAIN, never fabricating a new BP", () => {
    const store = new VitalsStore(60);
    store.ingest(validReading("rd_1"));
    store.ingest(abstainReading("rd_2"));
    const state = store.getState();
    expect(state.uiState).toBe("ABSTAIN");
    expect(state.current?.bp.sbp_mmhg).toBeNull();
    expect(state.previousValid).not.toBeNull();
    expect(state.previousValid?.sbpMmHg).toBe(122);
  });

  it("never shows a RECALIBRATE result as VALID BP", () => {
    const store = new VitalsStore(60);
    store.ingest(validReading("rd_1"));
    store.ingest(recalibrateReading("rd_2"));
    const state = store.getState();
    expect(state.uiState).toBe("RECALIBRATE");
    expect(state.current?.bp.valid).toBe(false);
  });

  it("marks the display STALE once data age exceeds the configured staleness budget", () => {
    const store = new VitalsStore(5);
    const reading = validReading("rd_1");
    store.ingest(reading);
    expect(store.getState().uiState).toBe("VALID");

    const future = Date.parse(reading.emitted_at_utc) + 10_000;
    store.tick(future);
    expect(store.getState().uiState).toBe("STALE");
  });

  it("moves to DEVICE_DISCONNECTED when connection status says so, regardless of result_state", () => {
    const store = new VitalsStore(60);
    const reading = validReading("rd_1");
    reading.connection.status = "DISCONNECTED";
    store.ingest(reading);
    expect(store.getState().uiState).toBe("DEVICE_DISCONNECTED");
  });

  it("drops a duplicate reading without changing state", () => {
    const store = new VitalsStore(60);
    const reading = validReading("rd_1");
    store.ingest(reading);
    const before = store.getState().current;
    store.ingest(reading);
    expect(store.getState().current).toBe(before);
  });

  it("renders an unsupported schema version as a visible failure, not a guess", () => {
    const store = new VitalsStore(60);
    store.ingest({ ...validReading("rd_1"), schema_version: "2.0.0" });
    expect(store.getState().uiState).toBe("UNSUPPORTED_SCHEMA");
    expect(store.getState().current).toBeNull();
  });
});
