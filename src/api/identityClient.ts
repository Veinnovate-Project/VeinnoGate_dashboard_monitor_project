import type { RuntimeConfig } from "../config/runtimeConfig";

/**
 * Client for the software-only POC adapter identity/assignment API
 * (Hardware_integration_ready/receiver/identity_api.py). Deliberately a
 * separate client/module from jetsonClient.ts: it talks to the same
 * Jetson host but to the ops-style `/v1/identity/*` routes (no `/api`
 * version segment — matching http_service.py's existing `/v1/health`,
 * `/v1/config`, `/v1/calibration` convention, not the versioned
 * `/api/v1/sessions/{id}/snapshot` dashboard-result boundary), so a
 * change to one contract can never silently affect the other.
 *
 * This client is never imported by src/demo/** — the pairing flow is
 * production-only, real-Jetson-only, exactly like the rest of src/main.ts.
 */

export interface AdapterInventoryEntry {
  hardware_uid: string;
  short_code: string;
  inventory_status: string;
  consumed: boolean;
  provisioned_at_utc: number;
  identity_verified_at_utc: number | null;
  consumed_at_utc: number | null;
  updated_at_utc: number;
}

export interface LiveWaitingEntry {
  hardware_uid: string | null;
  short_code: string | null;
  status: "READY" | "UNPROVISIONED" | "CONSUMED" | "ALREADY_ASSIGNED" | "PENDING_PROVISIONING" | "RETIRED";
}

export interface PairingWindow {
  window_id: string;
  patient_id: string;
  opened_at_utc: number;
  expires_at_utc: number;
  state: "OPEN" | "CANCELLED" | "EXPIRED" | "COMPLETED";
}

export interface PairingCandidate {
  short_code: string | null;
  status: LiveWaitingEntry["status"];
}

export interface PairingStatus {
  window_id: string;
  patient_id: string;
  state: "OPEN" | "CANCELLED" | "EXPIRED" | "COMPLETED";
  expires_at_utc: number;
  new_candidates: PairingCandidate[];
  auto_bindable_short_code: string | null;
}

export interface AssignmentRecord {
  assignment_id: string;
  hardware_uid: string;
  short_code: string;
  patient_id: string;
  assigned_at_utc: number;
  ended_at_utc: number | null;
  active: boolean;
}

export interface MeasurementSessionRecord {
  session_id: string;
  assignment_id: string;
  hardware_uid: string;
  patient_id: string;
  started_at_utc: number;
  ended_at_utc: number | null;
  active: boolean;
}

export interface AssignResult {
  assignment: AssignmentRecord;
  session: MeasurementSessionRecord;
}

export interface EndSessionResult {
  session: MeasurementSessionRecord;
  assignment: AssignmentRecord | null;
  adapter: AdapterInventoryEntry | null;
}

/**
 * A fail-closed rejection surfaced by the gate (AGENTS.md reason codes),
 * carrying the pre-translated Hebrew operator message from identity_api.py
 * so the UI never has to invent or guess wording for a safety rejection.
 */
export class IdentityAssignmentRejected extends Error {
  constructor(
    public readonly reasonCode: string,
    public readonly messageHe: string
  ) {
    super(`${reasonCode}: ${messageHe}`);
  }
}

export class IdentityApiError extends Error {}

export class IdentityApiClient {
  private readonly baseUrl: string;

  constructor(config: RuntimeConfig) {
    // Same host/scheme as jetson_rest_base_url, but rooted (no /api/vN
    // path segment) — see module docstring.
    this.baseUrl = `${new URL(config.jetson_rest_base_url).origin}/v1/identity`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...init
      });
    } catch (err) {
      throw new IdentityApiError(`request to ${path} failed: ${(err as Error).message}`);
    }

    if (response.status === 409) {
      const body = await response.json().catch(() => null);
      const detail = body?.detail;
      if (detail?.reason_code && detail?.message_he) {
        throw new IdentityAssignmentRejected(detail.reason_code, detail.message_he);
      }
      throw new IdentityApiError(`${path} rejected: HTTP 409`);
    }
    if (!response.ok) {
      throw new IdentityApiError(`${path} failed: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  listInventory(): Promise<{ adapters: AdapterInventoryEntry[] }> {
    return this.request("/inventory");
  }

  listLive(): Promise<{ live: LiveWaitingEntry[] }> {
    return this.request("/live");
  }

  startPairing(patientId: string): Promise<PairingWindow> {
    return this.request("/pairing/start", {
      method: "POST",
      body: JSON.stringify({ patient_id: patientId })
    });
  }

  pairingStatus(windowId: string): Promise<PairingStatus> {
    return this.request(`/pairing/${encodeURIComponent(windowId)}`);
  }

  cancelPairing(windowId: string): Promise<{ window_id: string; state: string }> {
    return this.request(`/pairing/${encodeURIComponent(windowId)}/cancel`, { method: "POST" });
  }

  assign(windowId: string, shortCode: string): Promise<AssignResult> {
    return this.request("/assign", {
      method: "POST",
      body: JSON.stringify({ window_id: windowId, short_code: shortCode })
    });
  }

  endSession(sessionId: string): Promise<EndSessionResult> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/end`, { method: "POST" });
  }
}
