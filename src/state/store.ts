import { MessageGuard, computeDataAgeSeconds } from "./messageGuard";
import { validateResult } from "./validateResult";
import { deriveUiState } from "./deriveUiState";
import type { JetsonResult, UiState } from "./resultTypes";
import type { SocketStatus } from "../api/jetsonSocket";

export interface PreviousValidReading {
  sbpMmHg: number;
  dbpMmHg: number;
  capturedAtUtc: string;
}

export interface DisplayState {
  uiState: UiState;
  current: JetsonResult | null;
  previousValid: PreviousValidReading | null;
  rejectedReason: string | null;
  lastError: { kind: string; details: string } | null;
}

export type StoreListener = (state: DisplayState) => void;

/**
 * Owns the single source of display truth: validates each inbound message,
 * runs it through the ordering/dedup guard, and keeps a previous-valid
 * reading around (explicitly marked historical) when the current state can
 * no longer show a current BP.
 */
export class VitalsStore {
  private guard = new MessageGuard();
  private state: DisplayState = {
    uiState: "AWAITING_FIRST_READING",
    current: null,
    previousValid: null,
    rejectedReason: null,
    lastError: null
  };
  private listeners = new Set<StoreListener>();

  constructor(private readonly staleAfterSeconds: number) {}

  /**
   * Loss of the WebSocket transport itself (RECONNECTING/CLOSED) must fail
   * safe immediately -- a previously VALID BP must stop being shown as
   * current the instant the socket drops, not only once the staleness timer
   * later expires. Clearing `current` (not just the uiState label) is what
   * makes reopening the socket (OPEN) unable to resurrect it: OPEN is a
   * no-op here, and the display stays DEVICE_DISCONNECTED with no current
   * reading until a fresh message is actually ingested. The last valid
   * value survives only as `previousValid`.
   */
  setTransportStatus(status: SocketStatus): void {
    if (status !== "RECONNECTING" && status !== "CLOSED") return;
    this.state = {
      uiState: "DEVICE_DISCONNECTED",
      current: null,
      previousValid: this.state.previousValid,
      rejectedReason: null,
      lastError: null
    };
    this.emit();
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  ingest(raw: unknown, nowMs: number = Date.now()): void {
    const validation = validateResult(raw);
    if (!validation.ok) {
      this.state = {
        ...this.state,
        rejectedReason: validation.reason,
        lastError:
          validation.reason === "UNSUPPORTED_SCHEMA_VERSION"
            ? { kind: validation.reason, details: `received schema_version=${String(validation.receivedVersion)}` }
            : { kind: validation.reason, details: validation.details }
      };
      if (validation.reason === "UNSUPPORTED_SCHEMA_VERSION") {
        this.state = { ...this.state, uiState: "UNSUPPORTED_SCHEMA" };
      }
      this.emit();
      return;
    }

    const guardOutcome = this.guard.evaluate(validation.result);
    if (!guardOutcome.accepted) {
      this.state = { ...this.state, rejectedReason: guardOutcome.reason };
      this.emit();
      return;
    }

    const result = validation.result;
    if (result.result_state === "VALID" && result.bp.sbp_mmhg !== null && result.bp.dbp_mmhg !== null) {
      this.state = {
        ...this.state,
        previousValid: {
          sbpMmHg: result.bp.sbp_mmhg,
          dbpMmHg: result.bp.dbp_mmhg,
          capturedAtUtc: result.acquisition_end_utc
        }
      };
    }

    const dataAgeSeconds = computeDataAgeSeconds(result.emitted_at_utc, nowMs);
    const uiState = deriveUiState(result, dataAgeSeconds, this.staleAfterSeconds);

    this.state = {
      uiState,
      current: result,
      previousValid: this.state.previousValid,
      rejectedReason: null,
      lastError: null
    };
    this.emit();
  }

  /** Re-derives staleness against the wall clock without a new message (e.g. connection silently died). */
  tick(nowMs: number = Date.now()): void {
    if (!this.state.current) return;
    const dataAgeSeconds = computeDataAgeSeconds(this.state.current.emitted_at_utc, nowMs);
    const uiState = deriveUiState(this.state.current, dataAgeSeconds, this.staleAfterSeconds);
    if (uiState !== this.state.uiState) {
      this.state = { ...this.state, uiState };
      this.emit();
    }
  }

  getState(): DisplayState {
    return this.state;
  }
}
