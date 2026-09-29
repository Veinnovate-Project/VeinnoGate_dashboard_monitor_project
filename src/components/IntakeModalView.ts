import { IdentityAssignmentRejected, type IdentityApiClient, type AssignResult } from "../api/identityClient";
import { t, type Locale } from "../i18n/strings";

/**
 * Adapter-first intake (mockup "new adapter detected" modal): every adapter
 * that appears READY on `/v1/identity/live` (i.e. switched OFF->ON and not
 * yet assigned) gets its own independent intake card, keyed by its VN-NNN
 * short code -- two adapters powered on together get two cards, and nothing
 * one card does can touch the other's form or request.
 *
 * Submitting opens a backend pairing window for the entered patient_id and
 * immediately assigns this card's code through the same fail-closed
 * `/v1/identity/assign` gate as AdapterPairingView.ts (manual-code path).
 * Because this skips the "exactly one new radio" auto-detect, the nurse must
 * tick an explicit "printed code matches" confirmation first.
 *
 * Fields follow identity contract 1.1.0 (owner decision 2026-09-29,
 * AGENTS.md): patient_id, first/last name, national ID, age and sex are
 * required; department/bed optional. The backend validates everything
 * (incl. the national-ID check digit) and answers with a Hebrew reason code;
 * this form only checks presence. Pairing-time age/sex are the ones
 * calibration uses. Typed values live in this object only -- never storage.
 *
 * Opening, closing, undo and cancel are local state only (no network); only
 * submit waits on the backend.
 */

export const UNDO_WINDOW_MS = 10_000;
const POLL_INTERVAL_MS = 1000;

type IntakeClient = Pick<IdentityApiClient, "listLive" | "startPairing" | "assign" | "cancelPairing">;

type TextField = "patientId" | "firstName" | "lastName" | "nationalId" | "age" | "department" | "bed";

interface IntakeItem {
  shortCode: string;
  phase: "form" | "submitting" | "dismissed";
  patientId: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  age: string;
  sex: "" | "F" | "M";
  department: string;
  bed: string;
  codeConfirmed: boolean;
  error: string | null;
  undoTimer: ReturnType<typeof setTimeout> | null;
  dismissedAtMs: number;
}

export class IntakeModalController {
  private items = new Map<string, IntakeItem>();
  // Codes the nurse cancelled/abandoned/assigned. Released only once the
  // adapter drops off the live list (switched OFF), so the next OFF->ON
  // opens a fresh intake instead of re-popping the one just closed.
  private suppressed = new Set<string>();
  private polling = false;
  private locale: Locale;

  constructor(
    private readonly container: HTMLElement,
    private readonly client: IntakeClient,
    private readonly onAssigned: (result: AssignResult) => void,
    initialLocale: Locale = "en"
  ) {
    this.locale = initialLocale;
    this.container.addEventListener("click", (e) => this.onClick(e));
    this.container.addEventListener("input", (e) => this.onInput(e));
    this.container.addEventListener("change", (e) => this.onInput(e));
    this.render();
  }

  start(): void {
    void this.poll();
    setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  setLocale(locale: Locale): void {
    this.locale = locale;
    this.render();
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const { live } = await this.client.listLive();
      const liveCodes = new Set(live.map((e) => e.short_code).filter((c): c is string => c !== null));
      for (const code of this.suppressed) if (!liveCodes.has(code)) this.suppressed.delete(code);
      let changed = false;
      for (const entry of live) {
        const code = entry.short_code;
        if (entry.status !== "READY" || !code || this.items.has(code) || this.suppressed.has(code)) continue;
        this.items.set(code, {
          shortCode: code, phase: "form", patientId: "", firstName: "", lastName: "", nationalId: "",
          age: "", sex: "", department: "", bed: "",
          codeConfirmed: false, error: null, undoTimer: null, dismissedAtMs: 0
        });
        changed = true;
      }
      if (changed) this.render();
    } catch {
      // Discovery is retried next tick; the side-panel manual flow stays available.
    } finally {
      this.polling = false;
    }
  }

  private onInput(e: Event): void {
    const target = e.target as HTMLInputElement;
    const item = this.items.get(target.dataset?.code ?? "");
    if (!item) return;
    const field = target.dataset.field;
    if (field === "codeConfirmed") item.codeConfirmed = target.checked;
    else if (field === "sex") item.sex = target.value as IntakeItem["sex"];
    else if (field) item[field as TextField] = target.value;
  }

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!target) return;
    const code = target.dataset.code ?? "";
    switch (target.dataset.action) {
      case "intake-submit": void this.submit(code); break;
      case "intake-cancel": this.drop(code); break;
      case "intake-dismiss": this.dismiss(code); break;
      case "intake-undo": this.undo(code); break;
    }
  }

  private drop(code: string): void {
    const item = this.items.get(code);
    if (!item || item.phase === "submitting") return;
    if (item.undoTimer) clearTimeout(item.undoTimer);
    this.items.delete(code);
    this.suppressed.add(code);
    this.render();
  }

  private dismiss(code: string): void {
    const item = this.items.get(code);
    if (!item || item.phase !== "form") return;
    item.phase = "dismissed";
    item.dismissedAtMs = Date.now();
    // No backend window exists before submit, so abandoning is purely local.
    item.undoTimer = setTimeout(() => this.drop(code), UNDO_WINDOW_MS);
    this.render();
  }

  private undo(code: string): void {
    const item = this.items.get(code);
    if (!item || item.phase !== "dismissed") return;
    if (item.undoTimer) clearTimeout(item.undoTimer);
    item.undoTimer = null;
    item.phase = "form";
    this.render();
  }

  private async submit(code: string): Promise<void> {
    const item = this.items.get(code);
    if (!item || item.phase !== "form") return;
    const patientId = item.patientId.trim();
    const age = Number(item.age);
    const complete = patientId && item.firstName.trim() && item.lastName.trim() && item.nationalId.trim()
      && item.age.trim() && Number.isFinite(age) && item.sex;
    if (!complete || !item.codeConfirmed) {
      item.error = t(this.locale, !complete ? "intakeRequiredFields" : "intakeConfirmCode");
      this.render();
      return;
    }
    item.phase = "submitting";
    item.error = null;
    this.render();

    let windowId: string | null = null;
    try {
      windowId = (await this.client.startPairing(patientId, {
        first_name: item.firstName.trim(),
        last_name: item.lastName.trim(),
        national_id: item.nationalId.trim(),
        age_years: age,
        sex: item.sex as "F" | "M",
        department: item.department.trim() || null,
        bed: item.bed.trim() || null
      })).window_id;
      const result = await this.client.assign(windowId, code);
      this.items.delete(code);
      this.suppressed.add(code);
      this.render();
      this.onAssigned(result);
    } catch (err) {
      if (windowId) void this.client.cancelPairing(windowId).catch(() => {});
      item.phase = "form";
      item.error = err instanceof IdentityAssignmentRejected ? err.messageHe : t(this.locale, "pairingGenericError");
      this.render();
    }
  }

  private render(): void {
    // Re-rendering replaces the inputs; keep the nurse's caret where it was
    // (values themselves are already mirrored into state on every keystroke).
    const active = typeof document !== "undefined" ? (document.activeElement as HTMLInputElement | null) : null;
    const activeId = active && this.container.contains?.(active) ? active.id : null;
    const caret = activeId && active?.type === "text" ? active.selectionStart : null;

    this.container.innerHTML = renderIntake([...this.items.values()], this.locale, Date.now());

    if (activeId) {
      const el = document.getElementById(activeId) as HTMLInputElement | null;
      el?.focus();
      if (el && caret !== null) el.setSelectionRange(caret, caret);
    }
  }
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

function textField(item: IntakeItem, field: TextField, label: string, locale: Locale, disabled: boolean, type = "text"): string {
  const id = `vn-intake-${esc(item.shortCode)}-${field}`;
  // autocomplete=off: the browser must not remember personal identifiers.
  return `<label class="vn-metric-label" for="${id}">${esc(label)}</label>
    <input id="${id}" type="${type}" autocomplete="off" data-code="${esc(item.shortCode)}" data-field="${field}" value="${esc(item[field])}"${disabled ? " disabled" : ""} dir="${locale === "he" ? "rtl" : "ltr"}" />`;
}

function sexField(item: IntakeItem, locale: Locale, disabled: boolean): string {
  const id = `vn-intake-${esc(item.shortCode)}-sex`;
  const opt = (v: IntakeItem["sex"], label: string) =>
    `<option value="${v}"${item.sex === v ? " selected" : ""}>${esc(label)}</option>`;
  return `<label class="vn-metric-label" for="${id}">${esc(t(locale, "sexLabel"))}</label>
    <select id="${id}" data-code="${esc(item.shortCode)}" data-field="sex"${disabled ? " disabled" : ""}>
      ${opt("", "—")}${opt("F", t(locale, "sexFemale"))}${opt("M", t(locale, "sexMale"))}
    </select>`;
}

function renderCard(item: IntakeItem, locale: Locale): string {
  const busy = item.phase === "submitting";
  const code = esc(item.shortCode);
  return `<div class="vn-intake-card" role="dialog" aria-modal="true" aria-labelledby="vn-intake-${code}-title">
    <div class="vn-intake-head">
      <div class="vn-side-panel-title" id="vn-intake-${code}-title">${esc(t(locale, "intakeTitle"))} · ${code}</div>
      <button class="vn-intake-close" data-action="intake-dismiss" data-code="${code}" aria-label="${esc(t(locale, "intakeDismiss"))}"${busy ? " disabled" : ""}>×</button>
    </div>
    ${textField(item, "patientId", t(locale, "pairingPatientIdLabel"), locale, busy)}
    <div class="vn-intake-row">
      <div>${textField(item, "firstName", t(locale, "firstNameLabel"), locale, busy)}</div>
      <div>${textField(item, "lastName", t(locale, "lastNameLabel"), locale, busy)}</div>
    </div>
    ${textField(item, "nationalId", t(locale, "nationalIdLabel"), locale, busy)}
    <div class="vn-intake-row">
      <div>${textField(item, "age", t(locale, "ageLabel"), locale, busy, "number")}</div>
      <div>${sexField(item, locale, busy)}</div>
    </div>
    <div class="vn-intake-note">${esc(t(locale, "intakeDemographicsNote"))}</div>
    <div class="vn-intake-row">
      <div>${textField(item, "department", t(locale, "departmentLabel"), locale, busy)}</div>
      <div>${textField(item, "bed", t(locale, "bedLabel"), locale, busy)}</div>
    </div>
    <label class="vn-intake-confirm">
      <input type="checkbox" data-code="${code}" data-field="codeConfirmed"${item.codeConfirmed ? " checked" : ""}${busy ? " disabled" : ""} />
      ${esc(t(locale, "intakeConfirmCode"))}: <strong>${code}</strong>
    </label>
    ${item.error ? `<div class="vn-error" role="alert">${esc(item.error)}</div>` : ""}
    <div class="vn-handover-actions">
      <button data-action="intake-submit" data-code="${code}"${busy ? " disabled" : ""}>${esc(t(locale, busy ? "intakeSubmitting" : "intakeSubmit"))}</button>
      <button data-action="intake-cancel" data-code="${code}"${busy ? " disabled" : ""}>${esc(t(locale, "intakeCancel"))}</button>
    </div>
  </div>`;
}

export function renderIntake(items: IntakeItem[], locale: Locale, nowMs: number): string {
  const dir = locale === "he" ? "rtl" : "ltr";
  const open = items.filter((i) => i.phase !== "dismissed");
  const dismissed = items.filter((i) => i.phase === "dismissed");
  const overlay = open.length
    ? `<div class="vn-intake-overlay" dir="${dir}">${open.map((i) => renderCard(i, locale)).join("")}</div>`
    : "";
  const toasts = dismissed.length
    ? `<div class="vn-intake-toasts" dir="${dir}">${dismissed
        .map(
          (i) => `<div class="vn-intake-toast" role="status">
            <span>${esc(t(locale, "intakeUndoPrompt"))} ${esc(i.shortCode)}</span>
            <button data-action="intake-undo" data-code="${esc(i.shortCode)}">${esc(t(locale, "intakeUndo"))}</button>
            <div class="vn-intake-toast-bar" style="animation-duration:${UNDO_WINDOW_MS}ms;animation-delay:-${Math.max(0, nowMs - i.dismissedAtMs)}ms"></div>
          </div>`
        )
        .join("")}</div>`
    : "";
  return overlay + toasts;
}
