import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, type Dirent } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "src");

function listFilesRecursive(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(full) : [full];
  });
}

describe("production/demo isolation (static source checks)", () => {
  it("src/main.ts never imports from src/demo", () => {
    const source = readFileSync(join(SRC, "main.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'].*demo/);
  });

  it("Math.random exists only inside src/demo", () => {
    const demoDir = join(SRC, "demo");
    const offenders = listFilesRecursive(SRC)
      .filter((file) => !file.startsWith(demoDir))
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => readFileSync(file, "utf8").includes("Math.random"));
    expect(offenders).toEqual([]);
  });

  it("index.html only wires main.ts, never main.demo.ts", () => {
    const html = readFileSync(join(SRC, "..", "index.html"), "utf8");
    expect(html).toContain("/src/main.ts");
    expect(html).not.toContain("main.demo.ts");
  });

  it("demo.html carries a static, non-conditional DEMO banner", () => {
    const html = readFileSync(join(SRC, "..", "demo.html"), "utf8");
    expect(html).toMatch(/id="demo-banner"[^>]*>DEMO — SYNTHETIC DATA/);
  });
});
