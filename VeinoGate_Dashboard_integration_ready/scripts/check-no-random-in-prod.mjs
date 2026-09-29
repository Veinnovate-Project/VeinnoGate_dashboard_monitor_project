import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Fails if the built PRODUCTION bundle (dist/, from `npm run build`) contains
// Math.random anywhere -- proving the demo data source was never pulled into
// the production dependency graph. Run this after `npm run build`.

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "dist");

if (!existsSync(distDir)) {
  console.error(`[no-random-in-prod] dist/ not found -- run "npm run build" first.`);
  process.exit(1);
}

function listFilesRecursive(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(full) : [full];
  });
}

const offenders = listFilesRecursive(distDir)
  .filter((file) => /\.(js|mjs)$/.test(file))
  .filter((file) => readFileSync(file, "utf8").includes("Math.random"));

if (offenders.length > 0) {
  console.error("[no-random-in-prod] FAILED: Math.random found in production bundle:");
  for (const file of offenders) console.error(`  - ${file}`);
  process.exit(1);
}

console.log("[no-random-in-prod] OK: no Math.random in the production bundle.");
