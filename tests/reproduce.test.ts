import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildBundle, reportHtml } from "../lib/export";
import {
  demoDatasets,
  demoPlan,
  parseDelimited as parse,
  emptyPlan,
  prepare,
} from "../lib/panelprep";
import type { Dataset, Plan } from "../lib/panelprep";
const python = readFileSync("public/reproduce.py", "utf8");
const cases: { name: string; ds: Dataset[]; plan: Plan }[] = [];
cases.push({
  name: "documented demonstration",
  ds: demoDatasets(),
  plan: demoPlan(),
});
const d = parse(
    "firm_id,year,x\n\nA,2020,0.1\nA,2020,0.1\nA,2022,9007199254740993\n,2020,\n",
    "base",
    "base.csv",
  ),
  p = emptyPlan([d]);
p.cleaning[0].scales = [{ column: "x", factor: 3, from: "a", to: "b" }];
p.cleaning[0].dropExactDuplicates = true;
cases.push({
  name: "decimal precision and provenance after blank records and deduplication",
  ds: [d],
  plan: p,
});
for (const how of ["left", "inner"] as const) {
  const ds = [
      parse(
        "firm_id,year,region\n001,2020,A\n002,2020,A\n003,2022,\n",
        "base",
        "base.csv",
      ),
      parse("region,year,x\nA,2020,1\nB,2020,2\n", "right", "right.csv"),
    ],
    plan = emptyPlan(ds);
  plan.joins = [
    {
      table: "right",
      keys: [
        { left: "region", right: "region" },
        { left: "year", right: "year" },
      ],
      how,
      relationship: "many-to-one",
    },
  ];
  cases.push({ name: how + " join", ds, plan });
}
const ds = [
    parse("firm_id,year\nA,2020\nB,2021\n", "base", "base.csv"),
    parse("firm_id,x\nA,1\nA,2\nB,3\n", "right", "right.csv"),
    parse("firm_id,z\nA,9\n", "third", "third.csv"),
  ],
  plan = emptyPlan(ds);
plan.joins = [
  {
    table: "right",
    keys: [{ left: "firm_id", right: "firm_id" }],
    how: "left",
    relationship: "one-to-many",
  },
  {
    table: "third",
    keys: [{ left: "firm_id", right: "firm_id" }],
    how: "left",
    relationship: "many-to-one",
  },
];
cases.push({ name: "two-step expansion then missing match", ds, plan });
const special = parse(
    'id,__proto__,amount\n" A ","<script>alert(1)</script>",1.2e-3\nB,"=SUM(1)",NA\n',
    "special",
    "<img src=x>.csv",
  ),
  sp = emptyPlan([special]);
sp.cleaning[0].trim = ["id"];
sp.cleaning[0].missingTokens = ["NA"];
sp.cleaning[0].scales = [{ column: "amount", factor: 0.1, from: "a", to: "b" }];
cases.push({
  name: "untrusted text and scientific notation",
  ds: [special],
  plan: sp,
});
const numbered = [
    parse("id\nA\n", "base", "base.csv"),
    parse("id,10,2\nA,1.,3\n", "right", "right.csv"),
  ],
  np = emptyPlan(numbered);
np.joins = [
  {
    table: "right",
    keys: [{ left: "id", right: "id" }],
    how: "left",
    relationship: "one-to-one",
  },
];
np.cleaning[1].scales = [{ column: "10", factor: 3, from: "a", to: "b" }];
cases.push({
  name: "numeric column order and trailing decimal point",
  ds: numbered,
  plan: np,
});
for (const c of cases)
  test("Python reproduces " + c.name, async () => {
    const r = prepare(c.ds, c.plan);
    assert.equal(r.ok, true);
    const files = await buildBundle(c.ds, r, python),
      root = mkdtempSync(join(tmpdir(), "panelprep-test-"));
    try {
      for (const [name, bytes] of Object.entries(files)) {
        const path = join(root, name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, bytes);
      }
      const cmd =
        process.env.TEST_PYTHON ??
        (process.platform === "win32" ? "py" : "python3");
      const args =
        process.platform === "win32" && !process.env.TEST_PYTHON
          ? ["-3.12"]
          : [];
      const run = spawnSync(
        cmd,
        [
          ...args,
          join(root, "reproduce.py"),
          "--bundle",
          root,
          "--output",
          join(root, "reproduced"),
        ],
        { encoding: "utf8" },
      );
      assert.equal(run.status, 0, run.stdout + run.stderr);
      const verified = JSON.parse(
        readFileSync(join(root, "reproduced", "verification.json"), "utf8"),
      );
      assert.equal(verified.verified, true);
      assert.equal(verified.rows, r.rows.length);
    } finally {
      const resolved = resolve(root);
      assert.ok(
        resolved.startsWith(resolve(tmpdir())) &&
          resolved.includes("panelprep-test-"),
      );
      rmSync(resolved, { recursive: true, force: true });
    }
  });
test("offline HTML escapes imported labels and never embeds active source text", () => {
  const r = prepare([special], sp),
    html = reportHtml([special], r);
  assert.ok(html.includes("&lt;img src=x&gt;"));
  assert.ok(!html.includes("<img src=x>"));
  assert.ok(html.includes("default-src 'none'"));
});
