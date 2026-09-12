/** Deterministic preparation engine. All identifiers remain strings. */
export type Cell = string | null;
export type RecordRow = Record<string, Cell>;
export interface Dataset {
  id: string;
  name: string;
  columns: string[];
  rows: RecordRow[];
  recordNumbers?: number[];
  sha256?: string;
  encoding?: string;
}
export interface KeyPair {
  left: string;
  right: string;
}
export interface JoinStep {
  table: string;
  keys: KeyPair[];
  how: "left" | "inner";
  relationship: "many-to-one" | "one-to-one" | "one-to-many";
}
export interface Cleaning {
  table: string;
  trim: string[];
  missingTokens: string[];
  dropExactDuplicates: boolean;
  scales: { column: string; factor: number; from: string; to: string }[];
}
export interface Plan {
  version: 1;
  base: string;
  cleaning: Cleaning[];
  joins: JoinStep[];
  panel: { entity: string[]; year: string };
}
export interface Issue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  table?: string;
  rows?: number[];
  count?: number;
}
export interface TracedRow {
  values: RecordRow;
  origins: Record<string, number[]>;
}
export interface Flow {
  step: string;
  leftBefore: number;
  rightRows: number;
  matchedLeft: number;
  unmatchedLeft: number;
  unusedRight: number;
  outputRows: number;
  addedRows: number;
  droppedLeft: number;
  nullLeftKeys: number;
  nullRightKeys: number;
}
export interface Result {
  ok: boolean;
  columns: string[];
  rows: TracedRow[];
  issues: Issue[];
  flow: Flow[];
  unmatched: {
    step: string;
    side: string;
    origins: Record<string, number[]>;
    values: RecordRow;
  }[];
  cleaningLog: {
    table: string;
    before: number;
    after: number;
    trimmed: number;
    missing: number;
    scaled: number;
    duplicates: number;
  }[];
  panel: {
    entities: number;
    minYear: number | null;
    maxYear: number | null;
    duplicateGroups: number;
    missingYears: number;
    invalidRows: number;
    gaps: { entity: string; year: number }[];
  } | null;
  plan: Plan;
}
export const LIMITS = {
  rows: 100000,
  columns: 200,
  cells: 2000000,
  output: 150000,
  files: 5,
  bytes: 10000000,
};
const own = (obj: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(obj, key);
const dict = <T>(): Record<string, T> => Object.create(null);

export function parseDelimited(
  text: string,
  id: string,
  name: string,
  delimiter?: string,
): Dataset {
  text = text.replace(/^\uFEFF/, "");
  if (text.includes("\u0000"))
    throw new Error("文件含空字符，请使用 UTF-8 或 GB18030 编码的 CSV / TSV。");
  if (!delimiter) {
    const counts: Record<string, number> = { ",": 0, "\t": 0, ";": 0 };
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (!quoted) {
        if (c === "\n" || c === "\r") break;
        if (own(counts, c)) counts[c]++;
      }
    }
    delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  if (![",", "\t", ";"].includes(delimiter))
    throw new Error("不支持的分隔符。");
  const records: string[][] = [],
    recordNumbers: number[] = [];
  let record: string[] = [],
    value = "",
    quoted = false,
    closed = false,
    logicalRecord = 0;
  function field() {
    record.push(value);
    value = "";
    closed = false;
    if (record.length > LIMITS.columns) throw new Error("每张表最多 200 列。");
  }
  function row() {
    logicalRecord++;
    const meaningful = record.length > 0 || value.length > 0 || closed;
    field();
    if (meaningful) {
      records.push(record);
      recordNumbers.push(logicalRecord);
    }
    record = [];
    if (records.length > LIMITS.rows + 1)
      throw new Error(`每张表最多 ${LIMITS.rows.toLocaleString()} 行。`);
    if (records.length > 1 && records.length * records[0].length > LIMITS.cells)
      throw new Error("表格超过 200 万单元格。");
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
      continue;
    }
    if (c === delimiter) {
      field();
      continue;
    }
    if (c === "\n" || c === "\r") {
      row();
      if (c === "\r" && text[i + 1] === "\n") i++;
      continue;
    }
    if (closed) throw new Error("引号结束后出现多余字符，请检查 CSV 格式。");
    if (c === '"') {
      if (value.length)
        throw new Error("字段中的引号必须使用 CSV 双引号转义。");
      quoted = true;
    } else value += c;
  }
  if (quoted) throw new Error("CSV 引号未闭合。");
  if (value.length || record.length || closed) row();
  if (!records.length) throw new Error("文件为空。");
  const columns = records.shift()!.map((c) => c.trim());
  recordNumbers.shift();
  if (columns.some((c) => !c)) throw new Error("列名不能为空。");
  if (columns.some((c) => c.length > 256))
    throw new Error("列名最长 256 个字符。");
  if (new Set(columns).size !== columns.length)
    throw new Error("列名重复，请先为每列设置不同名称。");
  if (
    columns.length > LIMITS.columns ||
    columns.length * records.length > LIMITS.cells
  )
    throw new Error("表格过大：最多 200 列、200 万个单元格。");
  const rows = records.map((cells, i) => {
    if (cells.length !== columns.length)
      throw new Error(
        `第 ${recordNumbers[i]} 条记录有 ${cells.length} 列，表头有 ${columns.length} 列。`,
      );
    const item = dict<Cell>();
    columns.forEach((c, j) => (item[c] = cells[j] === "" ? null : cells[j]));
    return item;
  });
  return { id, name, columns, rows, recordNumbers };
}

export function decodeFile(
  buffer: ArrayBuffer,
  encoding: "utf-8" | "gb18030" = "utf-8",
): string {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    throw new Error(
      encoding === "utf-8"
        ? "无法按 UTF-8 读取。请将导入编码切换为 GB18030 后重试。"
        : "文件编码无法识别，请另存为 UTF-8 CSV。",
    );
  }
}
export function profile(dataset: Dataset) {
  return {
    id: dataset.id,
    name: dataset.name,
    rows: dataset.rows.length,
    columns: dataset.columns.map((name) => {
      let missing = 0,
        numeric = 0,
        whitespace = 0;
      const distinct = new Set<string>();
      for (const row of dataset.rows) {
        const v = row[name];
        if (v === null) missing++;
        else {
          distinct.add(v);
          if (v.trim() !== v) whitespace++;
          if (
            /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(v) &&
            Number.isFinite(Number(v))
          )
            numeric++;
        }
      }
      return { name, missing, distinct: distinct.size, numeric, whitespace };
    }),
  };
}
export function emptyPlan(datasets: Dataset[]): Plan {
  const base = datasets[0];
  const entity = base?.columns.find((c) =>
    /^(firm_id|company_id|entity_id|id|企业代码|公司代码|股票代码)$/i.test(c),
  );
  const year = base?.columns.find((c) => /^(year|年份|年度)$/i.test(c));
  return {
    version: 1,
    base: base?.id ?? "",
    cleaning: datasets.map((d) => ({
      table: d.id,
      trim: [],
      missingTokens: [],
      dropExactDuplicates: false,
      scales: [],
    })),
    joins: [],
    panel: { entity: entity ? [entity] : [], year: year ?? "" },
  };
}
export function suggestJoin(leftColumns: string[], right: Dataset): JoinStep {
  const common = right.columns.filter((c) => leftColumns.includes(c));
  const likely = common.filter((c) =>
    /(?:^id$|_id$|code$|year$|年份|年度|代码|地区|城市)/i.test(c),
  );
  const names = likely.length ? likely : common.slice(0, 1);
  return {
    table: right.id,
    keys: names.slice(0, 4).map((c) => ({ left: c, right: c })),
    how: "left",
    relationship: "many-to-one",
  };
}
export function keyOf(row: RecordRow, columns: string[]): string | null {
  const values = columns.map((c) => row[c]);
  if (values.some((v) => v === null || v === undefined)) return null;
  return JSON.stringify(values);
}
function groups(rows: TracedRow[], columns: string[]) {
  const map = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const k = keyOf(r.values, columns);
    if (k !== null) {
      const a = map.get(k);
      if (a) a.push(i);
      else map.set(k, [i]);
    }
  });
  return map;
}
export function rightColumnNames(left: string[], right: Dataset) {
  const used = new Set(left),
    map = dict<string>();
  for (const c of right.columns) {
    let name = c;
    if (used.has(name)) name = `${right.id}__${c}`;
    while (used.has(name)) name = `_${name}`;
    map[c] = name;
    used.add(name);
  }
  return map;
}
export function plannedColumns(
  datasets: Dataset[],
  plan: Plan,
  until = plan.joins.length,
) {
  let columns = [...(datasets.find((d) => d.id === plan.base)?.columns ?? [])];
  for (const step of plan.joins.slice(0, until)) {
    const d = datasets.find((d) => d.id === step.table);
    if (d)
      columns = [
        ...columns,
        ...d.columns.map((c) => rightColumnNames(columns, d)[c]),
      ];
  }
  return columns;
}
export function validatePlan(datasets: Dataset[], plan: Plan): string[] {
  const errors: string[] = [];
  if (!validPlanShape(plan)) return ["处理方案结构无效。"];
  if (!datasets.length || datasets.length > LIMITS.files)
    errors.push("请导入 1–5 张数据表。");
  if (new Set(datasets.map((d) => d.id)).size !== datasets.length)
    errors.push("数据表标识重复。");
  if (
    datasets.some(
      (d) => d.rows.length > LIMITS.rows || d.columns.length > LIMITS.columns,
    ) ||
    datasets.reduce((n, d) => n + d.rows.length * d.columns.length, 0) >
      LIMITS.cells
  )
    errors.push("输入数据超过行数、列数或单元格限制。");
  if (
    !plan ||
    plan.version !== 1 ||
    !Array.isArray(plan.joins) ||
    !Array.isArray(plan.cleaning) ||
    !plan.panel ||
    !Array.isArray(plan.panel.entity)
  )
    return ["处理方案结构无效。"];
  const base = datasets.find((d) => d.id === plan.base);
  if (!base) errors.push("请选择主表。");
  const seen = new Set([plan.base]);
  let columns = [...(base?.columns ?? [])];
  for (const step of plan.joins) {
    const right = datasets.find((d) => d.id === step.table);
    if (!right || seen.has(step.table)) {
      errors.push("每个辅助表只能合并一次，且不能与主表相同。");
      continue;
    }
    seen.add(step.table);
    if (
      !["left", "inner"].includes(step.how) ||
      !["many-to-one", "one-to-one", "one-to-many"].includes(step.relationship)
    )
      errors.push("合并类型或关系无效。");
    if (
      !Array.isArray(step.keys) ||
      !step.keys.length ||
      step.keys.some(
        (k) => !columns.includes(k.left) || !right.columns.includes(k.right),
      )
    )
      errors.push(`${right.name}：请选择有效的左右合并键。`);
    else if (
      new Set(step.keys.map((k) => k.left)).size !== step.keys.length ||
      new Set(step.keys.map((k) => k.right)).size !== step.keys.length
    )
      errors.push(`${right.name}：合并键不能重复。`);
    columns = [
      ...columns,
      ...right.columns.map((c) => rightColumnNames(columns, right)[c]),
    ];
  }
  const cleaned = new Set<string>();
  for (const c of plan.cleaning) {
    const d = datasets.find((d) => d.id === c.table);
    if (
      !d ||
      cleaned.has(c.table) ||
      !Array.isArray(c.trim) ||
      !Array.isArray(c.missingTokens) ||
      !Array.isArray(c.scales)
    ) {
      errors.push("清洗规则引用了无效或重复的数据表。");
      continue;
    }
    cleaned.add(c.table);
    if (
      c.trim.some((x) => !d.columns.includes(x)) ||
      c.missingTokens.some((x) => typeof x !== "string") ||
      typeof c.dropExactDuplicates !== "boolean"
    )
      errors.push(`${d.name}：清洗规则无效。`);
    if (
      new Set(c.scales.map((x) => x.column)).size !== c.scales.length ||
      c.scales.some(
        (x) =>
          !d.columns.includes(x.column) ||
          !Number.isFinite(x.factor) ||
          x.factor <= 0 ||
          x.factor > 1e12 ||
          !x.from.trim() ||
          !x.to.trim(),
      )
    )
      errors.push(
        `${d.name}：单位换算须选择有效列、0–10¹² 之间的正数倍数和起止单位。`,
      );
  }
  if (
    plan.panel.entity.some((c) => !columns.includes(c)) ||
    (plan.panel.year && !columns.includes(plan.panel.year))
  )
    errors.push("面板检查字段无效。");
  if (plan.panel.entity.includes(plan.panel.year))
    errors.push("实体字段和年份字段不能相同。");
  return errors;
}

function validPlanShape(p: unknown): p is Plan {
  const obj = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  const strings = (v: unknown) =>
    Array.isArray(v) && v.every((x) => typeof x === "string");
  return (
    obj(p) &&
    p.version === 1 &&
    typeof p.base === "string" &&
    Array.isArray(p.joins) &&
    p.joins.length <= 4 &&
    p.joins.every(
      (j) =>
        obj(j) &&
        typeof j.table === "string" &&
        typeof j.how === "string" &&
        typeof j.relationship === "string" &&
        Array.isArray(j.keys) &&
        j.keys.every(
          (k) =>
            obj(k) && typeof k.left === "string" && typeof k.right === "string",
        ),
    ) &&
    Array.isArray(p.cleaning) &&
    p.cleaning.length <= 5 &&
    p.cleaning.every(
      (c) =>
        obj(c) &&
        typeof c.table === "string" &&
        strings(c.trim) &&
        strings(c.missingTokens) &&
        typeof c.dropExactDuplicates === "boolean" &&
        Array.isArray(c.scales) &&
        c.scales.every(
          (s) =>
            obj(s) &&
            typeof s.column === "string" &&
            typeof s.factor === "number" &&
            typeof s.from === "string" &&
            typeof s.to === "string",
        ),
    ) &&
    obj(p.panel) &&
    strings(p.panel.entity) &&
    typeof p.panel.year === "string"
  );
}
/** Decimal multiplication without binary floating-point loss in source values. */
export function multiplyDecimal(value: string, factor: number): string {
  function parse(s: string) {
    const m = /^([+-]?)(\d+\.?\d*|\.\d+)(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m) throw new Error("not_numeric");
    const fraction = (m[2].split(".")[1] ?? "").length;
    const exponent = Number(m[3] ?? 0) - fraction;
    if (
      !Number.isSafeInteger(exponent) ||
      Math.abs(exponent) > 1000 ||
      m[2].length > 1000
    )
      throw new Error("decimal_limit");
    return {
      coefficient: BigInt((m[1] === "-" ? "-" : "") + m[2].replace(".", "")),
      exponent,
    };
  }
  const a = parse(value),
    b = parse(String(factor));
  const c = a.coefficient * b.coefficient;
  if (c === BigInt(0)) return "0";
  const negative = c < BigInt(0),
    digits = (negative ? -c : c).toString(),
    exponent = a.exponent + b.exponent;
  let out: string;
  if (exponent >= 0) out = digits + "0".repeat(exponent);
  else {
    const point = digits.length + exponent;
    out =
      point > 0
        ? digits.slice(0, point) + "." + digits.slice(point)
        : "0." + "0".repeat(-point) + digits;
    out = out.replace(/0+$/, "").replace(/\.$/, "");
  }
  if (out.length > 2000) throw new Error("decimal_limit");
  return (negative ? "-" : "") + out;
}

export function prepare(datasets: Dataset[], plan: Plan): Result {
  const result: Result = {
    ok: false,
    columns: [],
    rows: [],
    issues: [],
    flow: [],
    unmatched: [],
    cleaningLog: [],
    panel: null,
    plan: structuredClone(plan),
  };
  const validation = validatePlan(datasets, plan);
  if (validation.length) {
    result.issues = validation.map((message) => ({
      severity: "error",
      code: "plan_invalid",
      message,
    }));
    return result;
  }
  const prepared = new Map<string, TracedRow[]>();
  for (const d of datasets) {
    const rule = plan.cleaning.find((c) => c.table === d.id);
    let trimmed = 0,
      missing = 0,
      scaled = 0,
      duplicates = 0;
    const scaleErrors = new Map<string, { count: number; rows: number[] }>();
    const rows: TracedRow[] = [],
      exact = new Map<string, TracedRow>();
    for (let i = 0; i < d.rows.length; i++) {
      const values = dict<Cell>();
      for (const col of d.columns) {
        let v = d.rows[i][col];
        if (v !== null && rule?.trim.includes(col)) {
          const t = v.trim();
          if (t !== v) trimmed++;
          v = t;
        }
        if (v !== null && (v === "" || rule?.missingTokens.includes(v))) {
          v = null;
          missing++;
        }
        const scale = rule?.scales.find((s) => s.column === col);
        if (v !== null && scale) {
          try {
            v = multiplyDecimal(v, scale.factor);
            scaled++;
          } catch {
            const error = scaleErrors.get(col) ?? { count: 0, rows: [] };
            error.count++;
            if (error.rows.length < 20)
              error.rows.push(d.recordNumbers?.[i] ?? i + 2);
            scaleErrors.set(col, error);
          }
        }
        values[col] = v;
      }
      const row = {
        values,
        origins: { [d.id]: [d.recordNumbers?.[i] ?? i + 2] },
      };
      if (rule?.dropExactDuplicates) {
        const key = JSON.stringify(d.columns.map((c) => values[c]));
        const previous = exact.get(key);
        if (previous) {
          previous.origins[d.id].push(d.recordNumbers?.[i] ?? i + 2);
          duplicates++;
          continue;
        }
        exact.set(key, row);
      }
      rows.push(row);
    }
    for (const [col, e] of scaleErrors)
      result.issues.push({
        severity: "error",
        code: "scale_non_numeric",
        message: `${d.name} 的 ${col} 有 ${e.count} 条记录无法进行十进制数值换算。`,
        table: d.id,
        count: e.count,
        rows: e.rows,
      });
    prepared.set(d.id, rows);
    result.cleaningLog.push({
      table: d.id,
      before: d.rows.length,
      after: rows.length,
      trimmed,
      missing,
      scaled,
      duplicates,
    });
  }
  if (result.issues.some((i) => i.severity === "error")) return result;
  let left = prepared.get(plan.base)!;
  let columns = [...datasets.find((d) => d.id === plan.base)!.columns];
  for (let index = 0; index < plan.joins.length; index++) {
    const step = plan.joins[index],
      rightData = datasets.find((d) => d.id === step.table)!,
      right = prepared.get(step.table)!;
    const leftKeys = step.keys.map((k) => k.left),
      rightKeys = step.keys.map((k) => k.right),
      lg = groups(left, leftKeys),
      rg = groups(right, rightKeys);
    const leftDup = [...lg.values()].filter((g) => g.length > 1),
      rightDup = [...rg.values()].filter((g) => g.length > 1);
    const checkLeft = step.relationship !== "many-to-one",
      checkRight = step.relationship !== "one-to-many";
    if ((checkLeft && leftDup.length) || (checkRight && rightDup.length)) {
      const side = checkRight && rightDup.length ? "辅助表" : "主表";
      const dup = side === "辅助表" ? rightDup : leftDup;
      const sample = dup.flat().slice(0, 20);
      const sourceTable = side === "辅助表" ? step.table : plan.base;
      result.issues.push({
        severity: "error",
        code: "relationship_violation",
        message: `${rightData.name}：${side}存在 ${dup.length} 组重复合并键，不符合所选关系。请增加合并键或先处理重复记录。`,
        table: sourceTable,
        rows: [
          ...new Set(
            sample.flatMap(
              (i) =>
                (side === "辅助表" ? right : left)[i].origins[sourceTable] ??
                [],
            ),
          ),
        ].slice(0, 20),
        count: dup.length,
      });
      result.rows = left;
      result.columns = columns;
      return result;
    }
    let size = 0;
    for (const r of left) {
      const key = keyOf(r.values, leftKeys),
        n = key === null ? 0 : (rg.get(key)?.length ?? 0);
      size += n || (step.how === "left" ? 1 : 0);
    }
    if (
      size > LIMITS.output ||
      size * (columns.length + rightData.columns.length) > LIMITS.cells
    ) {
      result.issues.push({
        severity: "error",
        code: "output_limit",
        message: `合并预计产生 ${size.toLocaleString()} 行或超过 200 万单元格，已停止。请缩小数据或检查合并键。`,
      });
      return result;
    }
    const rename = rightColumnNames(columns, rightData),
      output: TracedRow[] = [],
      used = new Set<number>();
    let matched = 0,
      unmatched = 0,
      nullLeft = 0;
    left.forEach((row) => {
      const key = keyOf(row.values, leftKeys);
      if (key === null) nullLeft++;
      const ids = key === null ? [] : (rg.get(key) ?? []);
      if (ids.length) {
        matched++;
        for (const ri of ids) {
          used.add(ri);
          const values = Object.assign(dict<Cell>(), row.values);
          for (const c of rightData.columns)
            values[rename[c]] = right[ri].values[c];
          output.push({
            values,
            origins: { ...row.origins, ...right[ri].origins },
          });
        }
      } else {
        unmatched++;
        result.unmatched.push({
          step: `${index + 1}: ${rightData.name}`,
          side: "left",
          origins: row.origins,
          values: row.values,
        });
        if (step.how === "left") {
          const values = Object.assign(dict<Cell>(), row.values);
          for (const c of rightData.columns) values[rename[c]] = null;
          output.push({ values, origins: { ...row.origins } });
        }
      }
    });
    right.forEach((row, i) => {
      if (!used.has(i))
        result.unmatched.push({
          step: `${index + 1}: ${rightData.name}`,
          side: "right",
          origins: row.origins,
          values: row.values,
        });
    });
    const nullRight = right.filter(
      (r) => keyOf(r.values, rightKeys) === null,
    ).length;
    result.flow.push({
      step: rightData.name,
      leftBefore: left.length,
      rightRows: right.length,
      matchedLeft: matched,
      unmatchedLeft: unmatched,
      unusedRight: right.length - used.size,
      outputRows: output.length,
      addedRows: Math.max(
        0,
        output.length - (step.how === "left" ? left.length : matched),
      ),
      droppedLeft: step.how === "inner" ? unmatched : 0,
      nullLeftKeys: nullLeft,
      nullRightKeys: nullRight,
    });
    if (unmatched)
      result.issues.push({
        severity: "warning",
        code: "unmatched_left",
        message: `${rightData.name}：${unmatched} 条主表记录未匹配，${step.how === "left" ? "已保留并填空" : "已按内连接方案移出结果"}。`,
        count: unmatched,
      });
    if (nullLeft || nullRight)
      result.issues.push({
        severity: "warning",
        code: "null_key",
        message: `${rightData.name}：主表 ${nullLeft} 条、辅助表 ${nullRight} 条记录缺少合并键。缺失键之间不会匹配。`,
        count: nullLeft + nullRight,
      });
    left = output;
    columns = [...columns, ...rightData.columns.map((c) => rename[c])];
  }
  result.rows = left;
  result.columns = columns;
  if (plan.panel.entity.length && plan.panel.year) {
    const entityYears = new Map<string, Set<number>>(),
      pairs = new Map<string, number>();
    let invalid = 0,
      min: number | null = null,
      max: number | null = null;
    for (const row of left) {
      const entity = keyOf(row.values, plan.panel.entity),
        raw = row.values[plan.panel.year];
      if (
        entity === null ||
        raw === null ||
        !/^\d{4}$/.test(raw ?? "") ||
        Number(raw) < 1800 ||
        Number(raw) > 2200
      ) {
        invalid++;
        continue;
      }
      const year = Number(raw);
      min = min === null ? year : Math.min(min, year);
      max = max === null ? year : Math.max(max, year);
      if (!entityYears.has(entity)) entityYears.set(entity, new Set());
      entityYears.get(entity)!.add(year);
      const k = JSON.stringify([entity, year]);
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
    let missingYears = 0;
    const gaps: { entity: string; year: number }[] = [];
    for (const [entity, years] of entityYears) {
      const ordered = [...years].sort((a, b) => a - b);
      for (let y = ordered[0]; y <= ordered[ordered.length - 1]; y++)
        if (!years.has(y)) {
          missingYears++;
          if (gaps.length < 100)
            gaps.push({ entity: JSON.parse(entity).join(" / "), year: y });
        }
    }
    const duplicateGroups = [...pairs.values()].filter((n) => n > 1).length;
    result.panel = {
      entities: entityYears.size,
      minYear: min,
      maxYear: max,
      duplicateGroups,
      missingYears,
      invalidRows: invalid,
      gaps,
    };
    if (duplicateGroups)
      result.issues.push({
        severity: "warning",
        code: "panel_duplicates",
        message: `最终数据中有 ${duplicateGroups} 组重复的实体 × 年份，尚不满足唯一面板键。`,
        count: duplicateGroups,
      });
    if (missingYears)
      result.issues.push({
        severity: "warning",
        code: "panel_gaps",
        message: `实体各自首尾年份之间共缺少 ${missingYears} 个年度观测；未自动补齐。`,
        count: missingYears,
      });
    if (invalid)
      result.issues.push({
        severity: "warning",
        code: "panel_invalid",
        message: `${invalid} 条记录缺少实体标识或有效的四位年份（1800–2200），未纳入年度覆盖检查。`,
        count: invalid,
      });
  }
  if (!left.length)
    result.issues.push({
      severity: "warning",
      code: "empty_result",
      message: "结果为空。请检查内连接、键字段与筛选口径。",
    });
  result.ok = true;
  return result;
}

export function toCsv(
  columns: string[],
  rows: RecordRow[],
  spreadsheetSafe = false,
): string {
  function quote(v: Cell) {
    let s = v ?? "";
    if (
      spreadsheetSafe &&
      /^[\s]*[=+@-]/.test(s) &&
      !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(s)
    )
      s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  }
  return (
    "\uFEFF" +
    [
      columns.map(quote).join(","),
      ...rows.map((row) => columns.map((c) => quote(row[c])).join(",")),
    ].join("\r\n") +
    "\r\n"
  );
}
export function demoDatasets(): Dataset[] {
  return [
    parseDelimited(
      "firm_id,year,region,revenue_wan,employees\n0001,2020,华东,1200,85\n0001,2021,华东,1380,91\n0001,2023,华东,1590,98\n0002,2020,华南,860,51\n0002,2021,华南,920,56\n0002,2022,华南,NA,60\n0003,2021,西南,530,32\n0003,2022,西南,610,35\n0004,2021,东北,780,44\n0004,2022,东北,810,46\n0005,2021,,420,28\n0005,2022,华北,470,30\n",
      "firms",
      "企业财务.csv",
    ),
    parseDelimited(
      "region,year,gdp_yi\n华东,2020,21800\n华东,2021,23400\n华东,2023,26200\n华南,2020,19600\n华南,2021,20800\n华南,2022,21900\n西南,2021,12300\n西南,2022,13400\n东北,2021,9800\n华北,2022,17400\n华中,2022,15900\n",
      "regions",
      "地区指标.csv",
    ),
  ];
}
export function demoPlan(): Plan {
  const ds = demoDatasets(),
    p = emptyPlan(ds);
  p.cleaning[0].missingTokens = ["NA"];
  p.joins = [
    {
      table: "regions",
      keys: [
        { left: "region", right: "region" },
        { left: "year", right: "year" },
      ],
      how: "left",
      relationship: "many-to-one",
    },
  ];
  return p;
}
