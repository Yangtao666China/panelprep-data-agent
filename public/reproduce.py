#!/usr/bin/env python3
"""Reproduce a PanelPrep research bundle with Python 3.10+ standard library.

Inputs are JSON data, never executable code. No network calls are made.
"""
import argparse
import csv
import decimal
import hashlib
import json
import re
from pathlib import Path

LIMIT_CELLS = 2_000_000


def fail(message):
    raise ValueError(message)


def number(value, factor):
    if not re.fullmatch(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", value):
        fail("Non-numeric value in unit conversion")
    with decimal.localcontext() as context:
        context.prec = 5000
        n = decimal.Decimal(value) * decimal.Decimal(str(factor))
        if not n.is_finite():
            fail("Non-finite value")
        if not n:
            return "0"
        text = format(n, "f")
        if "." in text:
            text = text.rstrip("0").rstrip(".")
        if len(text) > 2000:
            fail("Decimal output exceeds limit")
        return text


def key(row, columns):
    values = tuple(row.get(c) for c in columns)
    return None if any(v is None for v in values) else values


def validate(datasets, plan):
    if not isinstance(datasets, list) or not 1 <= len(datasets) <= 5:
        fail("Expected 1-5 datasets")
    ids = [d["id"] for d in datasets]
    if len(set(ids)) != len(ids):
        fail("Duplicate dataset IDs")
    cells = 0
    for d in datasets:
        if not isinstance(d["id"], str) or not isinstance(d["name"], str):
            fail("Invalid dataset metadata")
        cols, rows = d["columns"], d["rows"]
        if not cols or len(cols) > 200 or len(set(cols)) != len(cols) or len(rows) > 100000:
            fail("Dataset size or columns invalid")
        if any(not isinstance(c, str) or not c or len(c) > 256 for c in cols):
            fail("Invalid column name")
        for row in rows:
            if set(row) != set(cols) or any(v is not None and not isinstance(v, str) for v in row.values()):
                fail("Snapshot cells must be strings or null")
        numbers = d.get("recordNumbers")
        if numbers is not None and (len(numbers) != len(rows) or any(type(n) is not int or n < 1 for n in numbers)):
            fail("Invalid source record numbers")
        cells += len(rows) * len(cols)
    if cells > LIMIT_CELLS:
        fail("Input exceeds cell limit")
    if plan.get("version") != 1 or plan.get("base") not in ids:
        fail("Unsupported plan or base")
    by_id = {d["id"]: d for d in datasets}
    seen = set()
    for c in plan["cleaning"]:
        if c["table"] not in ids or c["table"] in seen:
            fail("Invalid cleaning table")
        seen.add(c["table"])
        columns = by_id[c["table"]]["columns"]
        if any(col not in columns for col in c["trim"]):
            fail("Unknown trim column")
        if type(c["dropExactDuplicates"]) is not bool or any(not isinstance(t, str) for t in c["missingTokens"]):
            fail("Invalid cleaning settings")
        scaled = set()
        for s in c["scales"]:
            if s["column"] not in columns or s["column"] in scaled:
                fail("Invalid or duplicate conversion column")
            scaled.add(s["column"])
            if type(s["factor"]) not in (int, float) or not 0 < s["factor"] <= 1e12 or not s["from"].strip() or not s["to"].strip():
                fail("Invalid unit conversion")
    if len(plan["joins"]) > 4:
        fail("Too many joins")


def prepare(datasets, plan):
    validate(datasets, plan)
    by_id = {d["id"]: d for d in datasets}
    prepared, cleaning_log = {}, []
    for d in datasets:
        c = next((c for c in plan["cleaning"] if c["table"] == d["id"]), None)
        rows, exact = [], {}
        trimmed = missing = scaled = duplicates = 0
        source_numbers = d.get("recordNumbers")
        for i, raw in enumerate(d["rows"]):
            values = {}
            origin = source_numbers[i] if source_numbers else i + 2
            for col in d["columns"]:
                value = raw[col]
                if value is not None and c and col in c["trim"]:
                    clean = value.strip("\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
                    trimmed += clean != value
                    value = clean
                if value is not None and (value == "" or (c and value in c["missingTokens"])):
                    value = None
                    missing += 1
                scale = next((s for s in c["scales"] if s["column"] == col), None) if c else None
                if value is not None and scale:
                    value = number(value, scale["factor"])
                    scaled += 1
                values[col] = value
            row = {"values": values, "origins": {d["id"]: [origin]}}
            if c and c["dropExactDuplicates"]:
                k = tuple(values[col] for col in d["columns"])
                if k in exact:
                    exact[k]["origins"][d["id"]].append(origin)
                    duplicates += 1
                    continue
                exact[k] = row
            rows.append(row)
        prepared[d["id"]] = rows
        cleaning_log.append(dict(table=d["id"], before=len(d["rows"]), after=len(rows), trimmed=trimmed, missing=missing, scaled=scaled, duplicates=duplicates))
    left, columns = prepared[plan["base"]], list(by_id[plan["base"]]["columns"])
    used_tables = {plan["base"]}
    flow = []
    for step in plan["joins"]:
        if step["table"] not in by_id or step["table"] in used_tables:
            fail("Unknown or repeated join table")
        used_tables.add(step["table"])
        d, right = by_id[step["table"]], prepared[step["table"]]
        lk, rk = [k["left"] for k in step["keys"]], [k["right"] for k in step["keys"]]
        if not lk or len(set(lk)) != len(lk) or len(set(rk)) != len(rk) or any(c not in columns for c in lk) or any(c not in d["columns"] for c in rk):
            fail("Invalid join keys")
        if step["how"] not in ("left", "inner") or step["relationship"] not in ("many-to-one", "one-to-one", "one-to-many"):
            fail("Invalid join operation")
        def grouped(rows, names):
            groups = {}
            for i, row in enumerate(rows):
                k = key(row["values"], names)
                if k is not None:
                    groups.setdefault(k, []).append(i)
            return groups
        lg, rg = grouped(left, lk), grouped(right, rk)
        if step["relationship"] != "many-to-one" and any(len(g) > 1 for g in lg.values()):
            fail("Left keys violate the expected relationship")
        if step["relationship"] != "one-to-many" and any(len(g) > 1 for g in rg.values()):
            fail("Right keys violate the expected relationship")
        output_size = sum(len(rg.get(key(row["values"], lk), [])) or int(step["how"] == "left") for row in left)
        if output_size > 150000 or output_size * (len(columns) + len(d["columns"])) > LIMIT_CELLS:
            fail("Output exceeds limit")
        used_names, rename = set(columns), {}
        for col in d["columns"]:
            name = col if col not in used_names else d["id"] + "__" + col
            while name in used_names:
                name = "_" + name
            rename[col] = name
            used_names.add(name)
        output, used = [], set()
        matched = unmatched = null_left = 0
        for row in left:
            k = key(row["values"], lk)
            null_left += k is None
            matches = rg.get(k, []) if k is not None else []
            if matches:
                matched += 1
                for ri in matches:
                    used.add(ri)
                    values = {**row["values"], **{rename[c]: right[ri]["values"][c] for c in d["columns"]}}
                    output.append({"values": values, "origins": {**row["origins"], **right[ri]["origins"]}})
            else:
                unmatched += 1
                if step["how"] == "left":
                    output.append({"values": {**row["values"], **{rename[c]: None for c in d["columns"]}}, "origins": row["origins"].copy()})
        flow.append(dict(step=d["name"], leftBefore=len(left), rightRows=len(right), matchedLeft=matched, unmatchedLeft=unmatched, unusedRight=len(right)-len(used), outputRows=len(output), addedRows=max(0, len(output)-(len(left) if step["how"] == "left" else matched)), droppedLeft=unmatched if step["how"] == "inner" else 0, nullLeftKeys=null_left, nullRightKeys=sum(key(row["values"], rk) is None for row in right)))
        left, columns = output, columns + list(rename.values())
    panel = None
    spec = plan["panel"]
    if any(c not in columns for c in spec["entity"]) or (spec["year"] and spec["year"] not in columns) or spec["year"] in spec["entity"]:
        fail("Invalid panel fields")
    if spec["entity"] and spec["year"]:
        entities, pairs = {}, {}
        invalid = 0
        for row in left:
            entity, year = key(row["values"], spec["entity"]), row["values"][spec["year"]]
            if entity is None or year is None or not re.fullmatch(r"[0-9]{4}", year) or not 1800 <= int(year) <= 2200:
                invalid += 1
                continue
            year = int(year)
            entities.setdefault(entity, set()).add(year)
            pairs[entity, year] = pairs.get((entity, year), 0) + 1
        missing, gaps = 0, []
        for entity, years in entities.items():
            for year in range(min(years), max(years) + 1):
                if year not in years:
                    missing += 1
                    if len(gaps) < 100:
                        gaps.append({"entity": " / ".join(entity), "year": year})
        all_years = set().union(*entities.values()) if entities else set()
        panel = dict(entities=len(entities), minYear=min(all_years) if all_years else None, maxYear=max(all_years) if all_years else None, duplicateGroups=sum(n > 1 for n in pairs.values()), missingYears=missing, invalidRows=invalid, gaps=gaps)
    return dict(columns=columns, rows=[r["values"] for r in left], origins=[r["origins"] for r in left], flow=flow, cleaningLog=cleaning_log, panel=panel)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--output", type=Path, default=Path("reproduced"))
    args = parser.parse_args()
    if args.output.exists():
        fail("Output directory already exists; choose a new --output path")
    def read(name):
        p = args.bundle / name
        if p.stat().st_size > 150_000_000:
            fail("Bundle file exceeds limit")
        return p.read_bytes()
    manifest = json.loads(read("manifest.json"))
    if manifest.get("tool") != "PanelPrep" or manifest.get("version") != "0.1.0":
        fail("Unsupported bundle version")
    values = {}
    for name in ("parsed-inputs.json", "plan.json", "expected.json"):
        raw = read(name)
        if hashlib.sha256(raw).hexdigest() != manifest["hashes"].get(name):
            fail("Hash mismatch: " + name)
        values[name] = json.loads(raw)
    result = prepare(values["parsed-inputs.json"], values["plan.json"])
    expected = values["expected.json"]
    for field in ("columns", "rows", "origins", "flow", "cleaningLog", "panel"):
        if result[field] != expected[field]:
            fail("Reproduction differs from browser result: " + field)
    args.output.mkdir(parents=True)
    with (args.output / "data.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=result["columns"])
        writer.writeheader()
        writer.writerows(result["rows"])
    (args.output / "verification.json").write_text(json.dumps({"verified": True, "rows": len(result["rows"]), "checks": ["columns", "rows", "origins", "flow", "cleaningLog", "panel"]}, indent=2), encoding="utf-8")
    print(f"Verified: {len(result['rows'])} rows; data, lineage, flow, cleaning and panel diagnostics match.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, decimal.InvalidOperation) as exc:
        raise SystemExit(f"PanelPrep: {exc}") from None
