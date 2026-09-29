import type { JetsonResult } from "./resultTypes";

export type GuardOutcome =
  | { accepted: true }
  | { accepted: false; reason: "DUPLICATE" | "OUT_OF_ORDER" | "IDENTITY_MISMATCH" };

interface AcceptedMarker {
  readingId: string;
  sessionId: string;
  patientId: string;
  deviceId: string;
  acquisitionEndUtc: number;
}

/**
 * Tracks the last accepted reading per (session, patient, device) triple and
 * rejects duplicates or messages that are older than what's already displayed.
 * A delayed response for an older acquisition window must never overwrite a
 * newer one, per the reading-identity invariant.
 */
export class MessageGuard {
  private seenReadingIds = new Set<string>();
  private lastAccepted: AcceptedMarker | null = null;

  evaluate(result: JetsonResult): GuardOutcome {
    if (this.seenReadingIds.has(result.reading_id)) {
      return { accepted: false, reason: "DUPLICATE" };
    }

    const acquisitionEndMs = Date.parse(result.acquisition_end_utc);
    if (Number.isNaN(acquisitionEndMs)) {
      return { accepted: false, reason: "OUT_OF_ORDER" };
    }

    if (this.lastAccepted) {
      const identityChanged =
        this.lastAccepted.sessionId !== result.session_id ||
        this.lastAccepted.patientId !== result.patient_id ||
        this.lastAccepted.deviceId !== result.device_id;

      if (!identityChanged && acquisitionEndMs <= this.lastAccepted.acquisitionEndUtc) {
        return { accepted: false, reason: "OUT_OF_ORDER" };
      }
    }

    this.seenReadingIds.add(result.reading_id);
    if (this.seenReadingIds.size > 2000) {
      // Bound memory for long-running sessions; oldest entries are least likely to recur.
      const oldest = this.seenReadingIds.values().next().value;
      if (oldest !== undefined) this.seenReadingIds.delete(oldest);
    }

    this.lastAccepted = {
      readingId: result.reading_id,
      sessionId: result.session_id,
      patientId: result.patient_id,
      deviceId: result.device_id,
      acquisitionEndUtc: acquisitionEndMs
    };

    return { accepted: true };
  }

  reset(): void {
    this.seenReadingIds.clear();
    this.lastAccepted = null;
  }
}

export function computeDataAgeSeconds(emittedAtUtc: string, nowMs: number = Date.now()): number | null {
  const emittedMs = Date.parse(emittedAtUtc);
  if (Number.isNaN(emittedMs)) return null;
  const ageSeconds = (nowMs - emittedMs) / 1000;
  // Negative age implies clock skew between client and server; treat as unknown
  // rather than reporting a nonsensical negative freshness.
  return ageSeconds < 0 ? null : ageSeconds;
}
