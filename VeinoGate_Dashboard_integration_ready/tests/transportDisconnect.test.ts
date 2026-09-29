import { describe, it, expect } from "vitest";
import { VitalsStore } from "../src/state/store";
import { validReading } from "./mockServer/fixtures.mjs";

describe("transport (WebSocket) loss fails safe immediately", () => {
  it("OPEN -> RECONNECTING -> OPEN: a current VALID BP stops being shown the instant the socket drops, and does not resurrect on reconnect without a fresh message", () => {
    const store = new VitalsStore(600); // long staleness budget so only the transport signal matters here
    store.ingest(validReading("rd_1"));
    expect(store.getState().uiState).toBe("VALID");
    expect(store.getState().previousValid).not.toBeNull();

    store.setTransportStatus("RECONNECTING");
    let state = store.getState();
    expect(state.uiState).toBe("DEVICE_DISCONNECTED");
    expect(state.current).toBeNull();
    expect(state.previousValid).not.toBeNull(); // preserved as historical

    store.setTransportStatus("OPEN");
    state = store.getState();
    expect(state.uiState).toBe("DEVICE_DISCONNECTED");
    expect(state.current).toBeNull(); // reopening alone must not restore the stale reading as current

    store.ingest(validReading("rd_2"));
    state = store.getState();
    expect(state.uiState).toBe("VALID");
    expect(state.current).not.toBeNull();
  });

  it("OPEN -> CLOSED: same fail-safe behavior, and previousValid survives", () => {
    const store = new VitalsStore(600);
    store.ingest(validReading("rd_1"));
    expect(store.getState().uiState).toBe("VALID");

    store.setTransportStatus("CLOSED");
    const state = store.getState();
    expect(state.uiState).toBe("DEVICE_DISCONNECTED");
    expect(state.current).toBeNull();
    expect(state.previousValid).not.toBeNull();
  });

  it("the initial CONNECTING attempt (never yet open) does not itself read as a transport loss", () => {
    const store = new VitalsStore(600);
    expect(store.getState().uiState).toBe("AWAITING_FIRST_READING");
    store.setTransportStatus("CONNECTING");
    expect(store.getState().uiState).toBe("AWAITING_FIRST_READING");
  });

  it("backend-reported DEVICE_DISCONNECTED remains authoritative even while transport is OPEN", () => {
    const store = new VitalsStore(600);
    const reading = validReading("rd_1");
    reading.connection.status = "DISCONNECTED";
    reading.result_state = "DEVICE_DISCONNECTED";
    reading.bp = { sbp_mmhg: null, dbp_mmhg: null, unit: "mmHg", valid: false };
    store.setTransportStatus("OPEN");
    store.ingest(reading);
    expect(store.getState().uiState).toBe("DEVICE_DISCONNECTED");
  });
});
