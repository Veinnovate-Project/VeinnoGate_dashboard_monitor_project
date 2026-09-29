export type ShiftKey = "morning" | "evening" | "night";

export interface ShiftState {
  chargeNurse: string | null;
  shiftKey: ShiftKey | null;
  startedAtUtc: string | null;
}

export type ShiftListener = (state: ShiftState) => void;

/**
 * Shift/charge-nurse identity (mockup §6.1b: "ward context, not an
 * account"). No auth/roster backend exists yet in this bundle (README §9:
 * "no authentication/authorization layer is implemented here"), so this is
 * a local, session-only, browser-tab-scoped store -- it never fabricates a
 * default nurse name; every field starts unset ("not signed in") and is
 * only ever populated by a real nurse completing the handover dialog.
 *
 * ponytail: this is a UI-only placeholder, not an auth system. Integration
 * point: replace `setShift` with a call to a real server-side roster
 * endpoint that resolves `chargeNurse` at write time (mockup's own caution:
 * "should be resolved server-side from the roster ... never trusted from
 * the client"), and persist handover events to an audit log there instead
 * of only in this in-memory store.
 */
export class ShiftStore {
  private state: ShiftState = { chargeNurse: null, shiftKey: null, startedAtUtc: null };
  private listeners = new Set<ShiftListener>();

  subscribe(listener: ShiftListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): ShiftState {
    return this.state;
  }

  /** Real nurse input via the handover dialog -- never called with a default/placeholder name. */
  setShift(chargeNurse: string, shiftKey: ShiftKey, nowUtc: string = new Date().toISOString()): void {
    this.state = { chargeNurse, shiftKey, startedAtUtc: nowUtc };
    for (const listener of this.listeners) listener(this.state);
  }
}
