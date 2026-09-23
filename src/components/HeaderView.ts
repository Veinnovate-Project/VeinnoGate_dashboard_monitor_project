import { t, type Locale } from "../i18n/strings";

/**
 * Header bar: logo/title, a real manual-sync trigger (re-runs the same
 * snapshot fetch the app already does on load), and a real EN/HE locale
 * toggle. Plain DOM + event delegation, matching AdapterPairingView.ts's
 * style so production has one rendering convention, not two.
 */
export class HeaderController {
  private locale: Locale;
  private syncing = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly onSync: () => Promise<void>,
    private readonly onLocaleChange: (locale: Locale) => void,
    initialLocale: Locale = "en"
  ) {
    this.locale = initialLocale;
    this.container.addEventListener("click", (e) => this.onClick(e));
    this.render();
  }

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === "sync") void this.sync();
    else if (action === "set-locale-en") this.setLocale("en");
    else if (action === "set-locale-he") this.setLocale("he");
  }

  private setLocale(locale: Locale): void {
    if (locale === this.locale) return;
    this.locale = locale;
    this.onLocaleChange(locale);
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
    this.container.innerHTML = renderHeader(this.locale, this.syncing);
  }
}

function renderHeader(locale: Locale, syncing: boolean): string {
  const dir = locale === "he" ? "rtl" : "ltr";
  return `<header class="vn-header" dir="${dir}">
    <img class="vn-header-logo" src="/veinnovate-logo.jpeg" alt="Veinnovate" />
    <div class="vn-header-divider"></div>
    <div class="vn-header-title">${t(locale, "appTitle")}</div>
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
