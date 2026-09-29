import { IdentityApiClient, IdentityAssignmentRejected, type AssignResult, type PairingStatus } from "../api/identityClient";
import { t, type Locale } from "../i18n/strings";

/**
 * Minimal, no-scanner, one-adapter pairing flow (AGENTS.md item 6):
 * nurse enters/selects the patient, presses "Add adapter", switches
 * exactly one physical adapter OFF->ON, and either confirms the single
 * auto-detected code or — if zero/multiple new adapters appeared — enters
 * the printed short code manually. Every assignment attempt goes through
 * the same `/v1/identity/assign` fail-closed gate either way; this
 * component never decides an identity match itself, it only ever displays
 * what the backend already resolved or rejected.
 *
 * Plain DOM, no framework, matching DashboardView.ts's style — this class
 * owns one container element, re-renders its innerHTML on every state
 * change, and uses event delegation (one listener attached once) rather
 * than re-attaching listeners per render.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "window_open"; windowId: string; status: PairingStatus | null }
  | { kind: "assigned"; result: AssignResult }
  | { kind: "ended" };

const POLL_INTERVAL_MS = 1000;

export class AdapterPairingController {
  private phase: Phase = { kind: "idle" };
  private patientId = "";
  private manualCode = "";
  private errorText: string | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  private locale: Locale;

  constructor(
    private readonly container: HTMLElement,
    private readonly client: IdentityApiClient,
    initialLocale: Locale = "he",
    private readonly onAssigned?: (result: AssignResult) => void
  ) {
    this.locale = initialLocale;
    this.container.addEventListener("click", (e) => this.onClick(e));
    this.container.addEventListener("input", (e) => this.onInput(e));
    this.render();
  }

  setLocale(locale: Locale): void {
    this.locale = locale;
    this.render();
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private onInput(e: Event): void {
    const target = e.target as HTMLElement;
    if (target.id === "vn-pairing-patient-id") {
      this.patientId = (target as HTMLInputElement).value;
    } else if (target.id === "vn-pairing-manual-code") {
      this.manualCode = (target as HTMLInputElement).value.trim().toUpperCase();
    }
  }

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === "start-pairing") void this.startPairing();
    else if (action === "cancel-pairing") void this.cancelPairing();
    else if (action === "confirm-assign") void this.assign(target.dataset.code ?? "");
    else if (action === "manual-assign") void this.assign(this.manualCode);
    else if (action === "end-session") void this.endSession();
  }

  private async startPairing(): Promise<void> {
    this.errorText = null;
    if (!this.patientId.trim()) {
      this.errorText = t(this.locale, "pairingPatientIdLabel");
      this.render();
      return;
    }
    try {
      const window_ = await this.client.startPairing(this.patientId.trim());
      this.phase = { kind: "window_open", windowId: window_.window_id, status: null };
      this.render();
      this.pollHandle = setInterval(() => void this.pollStatus(), POLL_INTERVAL_MS);
      await this.pollStatus();
    } catch (err) {
      // Since identity contract 1.1.0 this panel (patient_id only) is rejected
      // with PROFILE_FIELD_MISSING -- show the backend's Hebrew reason.
      this.errorText = err instanceof IdentityAssignmentRejected ? err.messageHe : t(this.locale, "pairingGenericError");
      this.render();
    }
  }

  private async pollStatus(): Promise<void> {
    if (this.phase.kind !== "window_open") return;
    try {
      const status = await this.client.pairingStatus(this.phase.windowId);
      if (this.phase.kind !== "window_open") return;
      this.phase = { ...this.phase, status };
      if (status.state !== "OPEN") this.stopPolling();
      this.render();
    } catch (err) {
      this.errorText = t(this.locale, "pairingGenericError");
      this.stopPolling();
      this.render();
    }
  }

  private async cancelPairing(): Promise<void> {
    if (this.phase.kind !== "window_open") return;
    this.stopPolling();
    try {
      await this.client.cancelPairing(this.phase.windowId);
    } catch {
      // Best-effort cancel — falling back to idle either way is safe;
      // an expired/cancelled window can never auto-bind.
    }
    this.phase = { kind: "idle" };
    this.render();
  }

  private async assign(shortCode: string): Promise<void> {
    this.errorText = null;
    if (!shortCode) {
      this.render();
      return;
    }
    if (this.phase.kind !== "window_open" || this.phase.status?.state !== "OPEN") {
      this.errorText = t(this.locale, "pairingWindowClosed");
      this.render();
      return;
    }
    const windowId = this.phase.windowId;
    this.stopPolling();
    try {
      const result = await this.client.assign(windowId, shortCode);
      this.phase = { kind: "assigned", result };
      this.render();
      this.onAssigned?.(result);
    } catch (err) {
      this.errorText =
        err instanceof IdentityAssignmentRejected ? err.messageHe : t(this.locale, "pairingGenericError");
      this.render();
    }
  }

  private async endSession(): Promise<void> {
    if (this.phase.kind !== "assigned") return;
    try {
      await this.client.endSession(this.phase.result.session.session_id);
      this.phase = { kind: "ended" };
      this.patientId = "";
      this.manualCode = "";
      this.render();
    } catch (err) {
      this.errorText = t(this.locale, "pairingGenericError");
      this.render();
    }
  }

  private render(): void {
    this.container.innerHTML = renderPairingPanel(this.phase, this.patientId, this.manualCode, this.errorText, this.locale);
  }
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

function renderPairingPanel(phase: Phase, patientId: string, manualCode: string, errorText: string | null, locale: Locale): string {
  const dir = locale === "he" ? "rtl" : "ltr";
  const errorHtml = errorText
    ? `<div class="vn-error" role="alert">${esc(errorText)}</div>`
    : "";

  let body = "";
  switch (phase.kind) {
    case "idle":
      body = `
        <label class="vn-metric-label" for="vn-pairing-patient-id">${esc(t(locale, "pairingPatientIdLabel"))}</label>
        <input id="vn-pairing-patient-id" type="text" value="${esc(patientId)}" />
        <button data-action="start-pairing">${esc(t(locale, "pairingStartButton"))}</button>
      `;
      break;
    case "window_open": {
      const status = phase.status;
      const candidates = status?.new_candidates ?? [];
      const autoCode = status?.auto_bindable_short_code ?? null;
      if (status && status.state !== "OPEN") {
        body = `
          <div class="vn-reason">${esc(t(locale, "pairingWindowClosed"))}</div>
          <button data-action="cancel-pairing">${esc(t(locale, "pairingBackButton"))}</button>
        `;
        break;
      }
      body = `
        <div class="vn-badge vn-badge--warn">${esc(t(locale, "pairingInstructionOn"))}</div>
        <button data-action="cancel-pairing">${esc(t(locale, "pairingCancelButton"))}</button>
        ${autoCode
          ? `<div class="vn-tile-title">${esc(t(locale, "pairingAutoDetectedCode"))}: ${esc(autoCode)}</div>
             <div class="vn-reason">${esc(t(locale, "pairingConfirmMatchPrompt"))}</div>
             <button data-action="confirm-assign" data-code="${esc(autoCode)}">${esc(t(locale, "pairingConfirmAndAssignButton"))}</button>`
          : candidates.length > 1
          ? `<div class="vn-reason">${esc(t(locale, "pairingZeroOrMultiple"))}</div>`
          : `<div class="vn-reason">${esc(t(locale, "pairingWaitingForAdapter"))}</div>`}
        <label class="vn-metric-label" for="vn-pairing-manual-code">${esc(t(locale, "pairingManualCodeLabel"))}</label>
        <input id="vn-pairing-manual-code" type="text" value="${esc(manualCode)}" />
        <button data-action="manual-assign">${esc(t(locale, "pairingAssignButton"))}</button>
      `;
      break;
    }
    case "assigned":
      body = `
        <span class="vn-badge vn-badge--ok">${esc(t(locale, "pairingAssignedSuccess"))}</span>
        <div class="vn-tile-title">${esc(phase.result.assignment.short_code)} — ${esc(phase.result.assignment.patient_id)}</div>
        <button data-action="end-session">${esc(t(locale, "pairingEndSessionButton"))}</button>
      `;
      break;
    case "ended":
      body = `<span class="vn-badge vn-badge--ok">${esc(t(locale, "pairingSessionEnded"))}</span>`;
      break;
  }

  return `<div class="vn-side-panel vn-pairing" dir="${dir}">
    <div class="vn-side-panel-header">
      <span class="vn-side-panel-dot"></span>
      <div class="vn-side-panel-title">${esc(t(locale, "pairingTitle"))}</div>
    </div>
    <div class="vn-side-panel-body">
      ${body}
      ${errorHtml}
    </div>
  </div>`;
}
