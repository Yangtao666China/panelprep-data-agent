import { build } from "esbuild";
import { readdirSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
mkdirSync(".test-build", { recursive: true });
const files = readdirSync("tests").filter((f) => f.endsWith(".test.ts"));
await build({
  entryPoints: files.map((f) => "tests/" + f),
  outdir: ".test-build",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  outExtension: { ".js": ".mjs" },
});
const r = spawnSync(
  process.execPath,
  ["--test", ...files.map((f) => ".test-build/" + f.replace(/\.ts$/, ".mjs"))],
  { stdio: "inherit" },
);
process.exitCode = r.status ?? 1;
