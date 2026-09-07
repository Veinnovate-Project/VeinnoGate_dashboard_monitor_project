import { generateDemoResult } from "./demo/demoDataSource";
import { VitalsStore } from "./state/store";
import { renderDashboard } from "./components/DashboardView";

// Demo entry point (demo.html only). Never wired into index.html/main.ts.
// The visible "DEMO — SYNTHETIC DATA" banner lives as static markup in
// demo.html itself, not as a component here, so it can't be omitted by a
// rendering bug.

const appEl = document.getElementById("app")!;
const DEMO_STALE_AFTER_SECONDS = 60;
const store = new VitalsStore(DEMO_STALE_AFTER_SECONDS);

store.subscribe((state) => {
  appEl.innerHTML = renderDashboard(state, "en", "OPEN");
});

store.ingest(generateDemoResult());
setInterval(() => store.ingest(generateDemoResult()), 4000);
