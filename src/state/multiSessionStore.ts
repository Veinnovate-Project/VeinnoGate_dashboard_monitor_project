import { VitalsStore, type DisplayState } from "./store";
import type { SocketStatus } from "../api/jetsonSocket";

export interface TileState {
  sessionId: string;
  display: DisplayState;
}

export type MultiSessionListener = (tiles: TileState[]) => void;

const UNROUTED_SESSION_ID = "__unrouted__";

/**
 * Fans a single WebSocket stream out into one VitalsStore per session_id.
 * Backend support for this already exists: `http_service.py`'s multi_runtime
 * tags every result with its own session_id and broadcasts all active
 * sessions' results over the one `/ws/v1` socket (see
 * `listener_owner.result_listeners` in http_service.py) -- so this is real
 * multi-patient wiring, not a stub. Each tile gets its own VitalsStore
 * (guard, staleness, previousValid) because MessageGuard assumes a single
 * identity's ordering; sharing one guard across interleaved sessions would
 * misfire "OUT_OF_ORDER" rejections for the second patient's own readings.
 *
 * A message that fails schema validation before session_id can even be read
 * is routed to a fixed `UNROUTED_SESSION_ID` bucket rather than dropped --
 * it must still surface as a visible error tile, never disappear silently.
 *
 * Sessions are discovered purely from inbound messages; nothing here needs
 * to know in advance how many patients are being monitored.
 */
export class MultiSessionStore {
  private stores = new Map<string, VitalsStore>();
  private order: string[] = [];
  private listeners = new Set<MultiSessionListener>();

  constructor(private readonly staleAfterSeconds: number) {}

  subscribe(listener: MultiSessionListener): () => void {
    this.listeners.add(listener);
    listener(this.getTiles());
    return () => this.listeners.delete(listener);
  }

  getTiles(): TileState[] {
    return this.order.map((sessionId) => ({ sessionId, display: this.stores.get(sessionId)!.getState() }));
  }

  private emit(): void {
    const tiles = this.getTiles();
    for (const listener of this.listeners) listener(tiles);
  }

  private storeFor(sessionId: string): VitalsStore {
    let store = this.stores.get(sessionId);
    if (!store) {
      store = new VitalsStore(this.staleAfterSeconds);
      this.stores.set(sessionId, store);
      this.order.push(sessionId);
      store.subscribe(() => this.emit());
    }
    return store;
  }

  ingest(raw: unknown, nowMs: number = Date.now()): void {
    const sessionId =
      raw !== null && typeof raw === "object" && typeof (raw as Record<string, unknown>).session_id === "string"
        ? ((raw as Record<string, unknown>).session_id as string)
        : UNROUTED_SESSION_ID;
    this.storeFor(sessionId).ingest(raw, nowMs);
  }

  setTransportStatus(status: SocketStatus): void {
    for (const store of this.stores.values()) store.setTransportStatus(status);
  }

  tick(nowMs: number = Date.now()): void {
    for (const store of this.stores.values()) store.tick(nowMs);
  }

  /** Discharge/end-session removes the tile entirely rather than leaving a dead DEVICE_DISCONNECTED panel. */
  removeSession(sessionId: string): void {
    if (!this.stores.has(sessionId)) return;
    this.stores.delete(sessionId);
    this.order = this.order.filter((id) => id !== sessionId);
    this.emit();
  }
}
