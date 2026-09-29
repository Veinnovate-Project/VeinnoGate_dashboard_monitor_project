import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Installed dependencies, generated build output, and deployment-injected
// runtime config are never part of the transferable source bundle -- they
// are excluded here and recorded as such in the manifest below, not just
// silently skipped.
const EXCLUDE_DIRS = new Set(["node_modules", "dist", "dist-demo", ".git", "coverage", ".vite"]);
const EXCLUDE_FILES = new Set(["bundle_manifest.json", ".DS_Store", "assets/runtime-config.json"]);

function listFilesRecursive(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (EXCLUDE_DIRS.has(entry.name)) return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(full) : [full];
  });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const files = listFilesRecursive(root)
  .filter((file) => !EXCLUDE_FILES.has(relative(root, file)))
  .sort();

const entries = files.map((file) => {
  const rel = relative(root, file).split("\\").join("/");
  const stat = statSync(file);
  return { path: rel, size_bytes: stat.size, sha256: sha256(file) };
});

const manifest = {
  bundle_name: "VeinoGate_Dashboard_integration_ready",
  bundle_version: "0.1.0",
  component_type: "dashboard",
  generated_at_utc: new Date().toISOString(),
  entry_point: "index.html",
  demo_entry_point: "demo.html",
  dependency_lock_file: "package-lock.json",
  schemas: {
    "jetson-result": { file: "schemas/jetson-result.schema.json", version: "1.0.0" },
    "jetson-ws-envelope": { file: "schemas/jetson-ws-envelope.schema.json", version: "1.0.0" },
    "runtime-config": { file: "schemas/runtime-config.schema.json", version: "1.0.0" }
  },
  expected_backend_interface_version: "1.0.0",
  runtime_config_example: {
    file: "config/runtime-config.example.json",
    note: "Copy to a deployed runtime-config.json and replace only deployment-specific non-secret values; never commit real deployment values into this bundle."
  },
  excluded_from_bundle: {
    note: "This manifest describes every transferable source, config, schema, script, and test file. The paths below are intentionally absent from the transferable bundle and are not listed in `files`.",
    directories: [
      { path: "node_modules/", reason: "Installed dependencies -- regenerate with `npm ci` against the committed package-lock.json." },
      { path: "dist/", reason: "Generated production build output -- regenerate with `npm run build`." },
      { path: "dist-demo/", reason: "Generated demo build output -- regenerate with `npm run build:demo`." },
      { path: "coverage/", reason: "Generated test-coverage output, if produced locally." },
      { path: ".vite/", reason: "Vite's local dependency-optimization cache." },
      { path: "assets/runtime-config.json", reason: "Deployment-injected runtime config (Vite publicDir is assets/), created by the integration engineer (see README §2) -- it is never part of the transferable source bundle." }
    ]
  },
  asset_provenance: [
    {
      path: "assets/veinnovate-logo.jpeg",
      source: "Copied unmodified from the historical VeinnoGate dashboard project (same file, verified identical SHA-1 across all prior copies in the source repository).",
      license: "Internal Veinnovate project asset; usage limited to Veinnovate-owned products."
    }
  ],
  files: entries
};

writeFileSync(join(root, "bundle_manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`[generate-manifest] wrote bundle_manifest.json with ${entries.length} files.`);
