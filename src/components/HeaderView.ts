import { t, type Locale } from "../i18n/strings";
import type { ShiftState, ShiftKey } from "../state/shiftStore";

/**
 * Header bar: logo/title, a real manual-sync trigger (re-runs the same
 * snapshot fetch the app already does on load), a real EN/HE locale
 * toggle, and a shift/charge-nurse chip that opens the handover dialog.
 * Plain DOM + event delegation, matching AdapterPairingView.ts's style so
 * production has one rendering convention, not two.
 *
 * The handover dialog writes only to the local ShiftStore (see
 * state/shiftStore.ts's own doc comment on the missing auth/roster
 * backend) -- this component never invents a default charge-nurse name.
 */
export class HeaderController {
  private locale: Locale;
  private syncing = false;
  private shift: ShiftState = { chargeNurse: null, shiftKey: null, startedAtUtc: null };
  private handoverOpen = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly onSync: () => Promise<void>,
    private readonly onLocaleChange: (locale: Locale) => void,
    initialLocale: Locale = "en",
    private readonly onStartShift?: (chargeNurse: string, shiftKey: ShiftKey) => void
  ) {
    this.locale = initialLocale;
    this.container.addEventListener("click", (e) => this.onClick(e));
    this.render();
  }

  setShift(shift: ShiftState): void {
    this.shift = shift;
    this.render();
  }

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === "sync") void this.sync();
    else if (action === "set-locale-en") this.setLocale("en");
    else if (action === "set-locale-he") this.setLocale("he");
    else if (action === "open-handover") this.setHandoverOpen(true);
    else if (action === "cancel-handover") this.setHandoverOpen(false);
    else if (action === "start-shift") this.startShift();
  }

  private setLocale(locale: Locale): void {
    if (locale === this.locale) return;
    this.locale = locale;
    this.onLocaleChange(locale);
    this.render();
  }

  private setHandoverOpen(open: boolean): void {
    this.handoverOpen = open;
    this.render();
  }

  private startShift(): void {
    const nameInput = this.container.querySelector<HTMLInputElement>("#vn-handover-name");
    const shiftSelect = this.container.querySelector<HTMLSelectElement>("#vn-handover-shift");
    const name = nameInput?.value.trim();
    const shiftKey = (shiftSelect?.value ?? "morning") as ShiftKey;
    if (!name) return;
    this.onStartShift?.(name, shiftKey);
    this.handoverOpen = false;
    this.render();
  }

  private async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    this.render();
    try {
      await this.onSync();
    } finally {
      this.syncing = false;
      this.render();
    }
  }

  private render(): void {
    this.container.innerHTML = renderHeader(this.locale, this.syncing, this.shift, this.handoverOpen);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

function shiftKeyLabel(locale: Locale, shiftKey: ShiftKey): string {
  switch (shiftKey) {
    case "morning": return t(locale, "handoverMorning");
    case "evening": return t(locale, "handoverEvening");
    case "night": return t(locale, "handoverNight");
  }
}

function renderShiftChip(locale: Locale, shift: ShiftState): string {
  const label =
    shift.chargeNurse && shift.shiftKey
      ? `${escapeHtml(shift.chargeNurse)} · ${escapeHtml(shiftKeyLabel(locale, shift.shiftKey))}`
      : escapeHtml(t(locale, "shiftNotSet"));
  return `<button class="vn-header-btn" data-action="open-handover" title="${escapeHtml(t(locale, "shiftChipLabel"))}">
    <span>${label}</span>
  </button>`;
}

function renderHandoverDialog(locale: Locale): string {
  return `<div class="vn-handover-dialog" dir="${locale === "he" ? "rtl" : "ltr"}">
    <div class="vn-side-panel-title">${escapeHtml(t(locale, "handoverTitle"))}</div>
    <label class="vn-metric-label" for="vn-handover-name">${escapeHtml(t(locale, "handoverChargeNurseLabel"))}</label>
    <input id="vn-handover-name" type="text" />
    <label class="vn-metric-label" for="vn-handover-shift">${escapeHtml(t(locale, "handoverShiftLabel"))}</label>
    <select id="vn-handover-shift">
      <option value="morning">${escapeHtml(t(locale, "handoverMorning"))}</option>
      <option value="evening">${escapeHtml(t(locale, "handoverEvening"))}</option>
      <option value="night">${escapeHtml(t(locale, "handoverNight"))}</option>
    </select>
    <div class="vn-handover-actions">
      <button data-action="start-shift">${escapeHtml(t(locale, "handoverStartButton"))}</button>
      <button data-action="cancel-handover">${escapeHtml(t(locale, "handoverCancelButton"))}</button>
    </div>
  </div>`;
}

function renderHeader(locale: Locale, syncing: boolean, shift: ShiftState, handoverOpen: boolean): string {
  const dir = locale === "he" ? "rtl" : "ltr";
  return `<header class="vn-header" dir="${dir}">
    <img class="vn-header-logo" src="/veinnovate-logo.jpeg" alt="Veinnovate" />
    <div class="vn-header-divider"></div>
    <div class="vn-header-title">${t(locale, "appTitle")}</div>
    ${renderShiftChip(locale, shift)}
    ${handoverOpen ? renderHandoverDialog(locale) : ""}
    <div class="vn-header-spacer"></div>
    <button
      class="vn-header-btn${syncing ? " vn-spinning" : ""}"
      data-action="sync"
      title="${t(locale, "syncTip")}"
      ${syncing ? "disabled" : ""}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"></path><path d="M20 3v5h-5"></path></svg>
      <span>${t(locale, "sync")}</span>
    </button>
    <div class="vn-locale-toggle">
      <button data-action="set-locale-en" class="${locale === "en" ? "active" : ""}">EN</button>
      <button data-action="set-locale-he" class="${locale === "he" ? "active" : ""}">עב</button>
    </div>
  </header>`;
}
