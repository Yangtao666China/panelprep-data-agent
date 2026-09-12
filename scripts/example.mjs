import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { zipSync } from "fflate";
mkdirSync(".test-build", { recursive: true });
await build({
  entryPoints: ["lib/panelprep.ts", "lib/export.ts"],
  outdir: ".test-build/example",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outExtension: { ".js": ".mjs" },
});
const { demoDatasets, demoPlan, prepare } =
  await import("../.test-build/example/panelprep.mjs");
const { buildBundle } = await import("../.test-build/example/export.mjs");
const datasets = demoDatasets(),
  result = prepare(datasets, demoPlan());
if (!result.ok) throw new Error("Demo failed");
const files = await buildBundle(
  datasets,
  result,
  readFileSync("public/reproduce.py", "utf8"),
);
// Keep the checked-in synthetic demonstration deterministic.
const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
manifest.createdAt = "2026-09-12T00:00:00.000Z";
files["manifest.json"] = new TextEncoder().encode(
  JSON.stringify(manifest, null, 2),
);
for (const [name, bytes] of Object.entries(files)) {
  const path = join("examples/demo", name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}
const zipped = Object.fromEntries(
  Object.entries(files).map(([name, bytes]) => [
    name,
    [bytes, { mtime: new Date("2026-09-12T00:00:00Z") }],
  ]),
);
writeFileSync("examples/panelprep-demo.zip", zipSync(zipped, { level: 6 }));
console.log(
  JSON.stringify(
    {
      output: "examples/demo",
      rows: result.rows.length,
      flow: result.flow,
      panel: result.panel,
    },
    null,
    2,
  ),
);
