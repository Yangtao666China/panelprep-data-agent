import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDelimited as parse,
  prepare,
  emptyPlan,
  demoDatasets,
  demoPlan,
  multiplyDecimal,
  keyOf,
  toCsv,
  decodeFile,
  validatePlan,
} from "../lib/panelprep";
import type { Plan } from "../lib/panelprep";
const csv = (s: string, id = "base") => parse(s, id, id + ".csv");
function joined(
  a: string,
  b: string,
  relationship: Plan["joins"][0]["relationship"] = "many-to-one",
  how: "left" | "inner" = "left",
) {
  const ds = [csv(a), csv(b, "right")],
    p = emptyPlan(ds);
  p.joins = [
    { table: "right", keys: [{ left: "id", right: "id" }], how, relationship },
  ];
  return { ds, p, r: prepare(ds, p) };
}
test("complete demonstration has exact attrition and internal gaps", () => {
  const r = prepare(demoDatasets(), demoPlan());
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 12);
  assert.equal(r.flow[0].matchedLeft, 10);
  assert.equal(r.flow[0].unmatchedLeft, 2);
  assert.equal(r.flow[0].unusedRight, 1);
  assert.equal(r.panel?.missingYears, 1);
  assert.equal(r.rows[0].values.firm_id, "0001");
});
test("quoted delimiters, quotes and newlines roundtrip", () => {
  const d = csv('id,note\r\n001,"a,b\n""quoted"""\r\n');
  assert.equal(d.rows[0].note, 'a,b\n"quoted"');
  assert.deepEqual(csv(toCsv(d.columns, d.rows)).rows, d.rows);
});
test("delimiter inference supports TSV, semicolon and BOM", () => {
  for (const sep of ["\t", ";"]) {
    const d = csv(`\uFEFFid${sep}year\n001${sep}2020\n`);
    assert.equal(d.rows[0].id, "001");
  }
});
test("all-null data records retained; only truly blank records skipped", () => {
  const d = csv("id,year\n\n,\nA,2020\n");
  assert.equal(d.rows.length, 2);
  assert.deepEqual(d.recordNumbers, [3, 4]);
  assert.equal(prepare([d], emptyPlan([d])).rows[1].origins.base[0], 4);
});
test("empty quoted single-column record retained", () =>
  assert.equal(csv('id\n""\n').rows.length, 1));
test("malformed all-empty width is rejected", () =>
  assert.throws(() => csv("id,year\n,,\nA,2020\n"), /3.*2/));
test("unclosed and misplaced quotes rejected", () => {
  for (const s of ['a,b\n1,"x', 'a,b\n1,x"y', 'a,b\n1,"x"z'])
    assert.throws(() => csv(s));
});
test("duplicate or blank headers rejected", () => {
  for (const s of ["a,a\n1,2", "a, \n1,2"]) assert.throws(() => csv(s));
});
test("column budget enforced before processing all input", () =>
  assert.throws(
    () => csv(Array.from({ length: 201 }, (_, i) => "c" + i).join(",")),
    /200/,
  ));
test("decoding rejects invalid UTF8 and supports GB18030", () => {
  const bytes = new Uint8Array([0xb5, 0xd8, 0xc7, 0xf8]);
  assert.throws(() => decodeFile(bytes.buffer));
  assert.equal(decodeFile(bytes.buffer, "gb18030"), "地区");
});
test("leading zero and unsafe integer keys remain distinct", () => {
  const { r } = joined(
    "id\n0012\n12\n9007199254740993\n",
    "id,x\n0012,yes\n9007199254740992,no\n",
  );
  assert.equal(r.flow[0].matchedLeft, 1);
  assert.equal(r.rows[2].values.x, null);
});
test("null and empty keys never join each other", () => {
  const { r } = joined("id,x\n,1\nA,2\n", "id,y\n,9\nA,3\n", "one-to-one");
  assert.equal(r.rows[0].values.y, null);
  assert.equal(r.flow[0].matchedLeft, 1);
  assert.equal(r.flow[0].nullLeftKeys, 1);
});
test("composite key uses unambiguous tuple encoding", () => {
  assert.notEqual(
    keyOf({ a: "A|B", b: "C" }, ["a", "b"]),
    keyOf({ a: "A", b: "B|C" }, ["a", "b"]),
  );
  assert.equal(keyOf({ a: "A", b: null }, ["a", "b"]), null);
});
test("m:1 allows many entities per region key", () => {
  const { r } = joined("id,firm\nA,F1\nA,F2\n", "id,x\nA,1\n");
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 2);
});
test("m:m blocked before expansion", () => {
  const { r } = joined("id\nA\nA\n", "id,x\nA,1\nA,2\n");
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].code, "relationship_violation");
});
test("one-to-one checks both sides", () => {
  const { r } = joined("id\nA\nA\n", "id,x\nA,1\n", "one-to-one");
  assert.equal(r.ok, false);
});
test("one-to-many records expansion and original sources", () => {
  const { r } = joined("id\nA\nB\n", "id,x\nA,1\nA,2\nB,3\n", "one-to-many");
  assert.equal(r.rows.length, 3);
  assert.equal(r.flow[0].matchedLeft, 2);
  assert.equal(r.flow[0].addedRows, 1);
  assert.deepEqual(r.rows[1].origins, { base: [2], right: [3] });
});
test("inner join records dropped samples", () => {
  const { r } = joined("id\nA\nB\n", "id,x\nA,1\nC,3\n", "one-to-one", "inner");
  assert.equal(r.rows.length, 1);
  assert.equal(r.flow[0].droppedLeft, 1);
  assert.equal(r.flow[0].unusedRight, 1);
  assert.deepEqual(r.unmatched[0].origins, { base: [3] });
});
test("deduplicated records keep every source and unmatched source numbers", () => {
  const { ds, p } = joined("id,x\nA,1\nA,1\nB,2\n", "id,y\nA,9\n");
  p.cleaning[0].dropExactDuplicates = true;
  const r = prepare(ds, p);
  assert.deepEqual(r.rows[0].origins.base, [2, 3]);
  assert.deepEqual(r.unmatched[0].origins, { base: [4] });
  assert.equal(ds[0].rows.length, 3);
});
test("duplicate issue references pre-cleaning record numbers", () => {
  const { ds, p } = joined("id\nA\nB\n", "id,x\nA,1\nA,1\nB,2\nB,3\n");
  p.cleaning[1].dropExactDuplicates = true;
  assert.deepEqual(prepare(ds, p).issues[0].rows, [4, 5]);
});
test("later join preserves lineage after expansion", () => {
  const { ds, p } = joined(
    "id\nA\nB\n",
    "id,x\nA,1\nA,2\nB,3\n",
    "one-to-many",
  );
  ds.push(csv("id,z\nA,9\n", "third"));
  p.joins.push({
    table: "third",
    keys: [{ left: "id", right: "id" }],
    how: "left",
    relationship: "many-to-one",
  });
  const r = prepare(ds, p);
  assert.deepEqual(r.unmatched.find((x) => x.side === "left")?.origins, {
    base: [3],
    right: [4],
  });
});
test("trim is opt-in and can reveal blocked duplicate keys", () => {
  const { ds, p } = joined("id\nA\n", "id,x\nA,1\n A ,2\n");
  assert.equal(prepare(ds, p).ok, true);
  p.cleaning[1].trim = ["id"];
  assert.equal(prepare(ds, p).ok, false);
});
test("missing tokens and zero are separate", () => {
  const d = csv("id,x\nA,NA\nB,0\nC,N/A\n"),
    p = emptyPlan([d]);
  p.cleaning[0].missingTokens = ["NA"];
  const r = prepare([d], p);
  assert.deepEqual(
    r.rows.map((x) => x.values.x),
    [null, "0", "N/A"],
  );
});
test("decimal scaling is exact and cannot merge distinct large integers", () => {
  assert.equal(multiplyDecimal("0.1", 3), "0.3");
  assert.equal(multiplyDecimal("1.2345", 10000), "12345");
  assert.equal(multiplyDecimal("-0.25", 10000), "-2500");
  const d = csv("id,x\nA,9007199254740992\nA,9007199254740993\n"),
    p = emptyPlan([d]);
  p.cleaning[0].dropExactDuplicates = true;
  p.cleaning[0].scales = [{ column: "x", factor: 1, from: "a", to: "b" }];
  assert.equal(prepare([d], p).rows.length, 2);
});
test("conversion failures aggregate bounded row examples", () => {
  const d = csv(
      "id,x\n" + Array.from({ length: 5000 }, (_, i) => `${i},bad`).join("\n"),
    ),
    p = emptyPlan([d]);
  p.cleaning[0].scales = [{ column: "x", factor: 10000, from: "a", to: "b" }];
  const r = prepare([d], p);
  assert.equal(r.ok, false);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].count, 5000);
  assert.equal(r.issues[0].rows?.length, 20);
});
test("prototype-like headers and repeated suffixes do not overwrite columns", () => {
  const { r } = joined(
    "id,__proto__,right__id\nA,safe,keep\n",
    "id,__proto__\nA,right\n",
  );
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].values.__proto__, "safe");
  assert.equal(r.rows[0].values.right__id, "keep");
  assert.equal(r.rows[0].values._right__id, "A");
  assert.equal(r.rows[0].values.right____proto__, "right");
});
test("panel duplicates and strict annual coverage are warnings, not silently repaired", () => {
  const d = csv("firm_id,year,x\nA,2018,1\nA,2020,2\nA,2020,3\nB,2021x,4\n"),
    r = prepare([d], emptyPlan([d]));
  assert.equal(r.rows.length, 4);
  assert.equal(r.panel?.duplicateGroups, 1);
  assert.equal(r.panel?.missingYears, 1);
  assert.equal(r.panel?.invalidRows, 1);
});
test("all malformed nested plans return structured errors", () => {
  const ds = [csv("id\nA\n"), csv("id\nA\n", "right")];
  for (const edit of [
    (p: any) => (p.joins = [null]),
    (p: any) => (p.joins = [{ table: "right", keys: [null] }]),
    (p: any) => (p.cleaning = [null]),
    (p: any) => (p.cleaning[0].scales = [null]),
    (p: any) =>
      (p.cleaning[0].scales = [{ column: "id", factor: 1, from: 7, to: "b" }]),
  ]) {
    const p = emptyPlan(ds);
    edit(p);
    assert.equal(prepare(ds, p).ok, false);
  }
});
test("unknown fields, repeated tables and duplicate keys are rejected", () => {
  const { ds, p } = joined("id\nA\n", "id\nA\n");
  p.joins[0].keys = [{ left: "missing", right: "id" }];
  assert.ok(validatePlan(ds, p).length);
  p.joins[0].keys = [{ left: "id", right: "id" }];
  p.joins.push(p.joins[0]);
  assert.ok(validatePlan(ds, p).length);
});
test("spreadsheet-safe export neutralizes headers and suspicious cells separately", () => {
  const raw = toCsv(
      ["=header", "value"],
      [{ "=header": "=SUM(1,2)", value: "-12.5" }],
    ),
    safe = toCsv(
      ["=header", "value"],
      [{ "=header": "=SUM(1,2)", value: "-12.5" }],
      true,
    );
  assert.ok(raw.includes('"=SUM'));
  assert.ok(safe.includes("'=header"));
  assert.ok(safe.includes("'=SUM"));
  assert.ok(safe.includes("-12.5"));
});
test("empty inner output is complete with explicit warning", () => {
  const { r } = joined("id\nA\n", "id\nB\n", "one-to-one", "inner");
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 0);
  assert.ok(r.issues.some((x) => x.code === "empty_result"));
});

test("left duplicate examples after expansion name only base source records", () => {
  const { ds, p } = joined(
    "id\nA\nB\n",
    "id,x\nA,1\nA,2\nB,3\n",
    "one-to-many",
  );
  ds.push(csv("id,z\nA,9\nB,8\n", "third"));
  p.joins.push({
    table: "third",
    keys: [{ left: "id", right: "id" }],
    how: "left",
    relationship: "one-to-one",
  });
  const r = prepare(ds, p);
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].table, "base");
  assert.deepEqual(r.issues[0].rows, [2]);
});
