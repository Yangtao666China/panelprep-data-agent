import { zipSync, strToU8 } from "fflate";
import { Dataset, Result, toCsv } from "./panelprep";
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function reportHtml(datasets: Dataset[], r: Result): string {
  const e = escape;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>PanelPrep 研究数据审计</title><style>body{font:16px/1.7 system-ui,sans-serif;color:#26334a;max-width:1100px;margin:40px auto;padding:0 24px}h1{color:#4056b5}table{border-collapse:collapse;width:100%;margin:20px 0;display:block;overflow:auto}th,td{border:1px solid #dfe4ef;text-align:left;padding:9px}th{background:#f0f3fc}small{color:#7688a2}li{margin:10px 0}code{overflow-wrap:anywhere}</style><h1>PanelPrep · 研究数据审计</h1><p>${datasets.length} 张输入表 → ${r.rows.length} 条结果记录 · ${r.columns.length} 个字段</p><p>此报告记录处理步骤和检查结果，不代表研究设计已经有效。</p><h2>输入数据</h2><ul>${datasets.map((d) => `<li>${e(d.name)} · ${d.rows.length} 行 · ${d.columns.length} 列${d.sha256 ? `<br><small>原文件 SHA-256：<code>${e(d.sha256)}</code></small>` : ""}</li>`).join("")}</ul><h2>样本变化</h2><table><tr><th>合并步骤</th><th>主表输入</th><th>匹配</th><th>未匹配</th><th>移出</th><th>连接新增行</th><th>结果</th><th>辅助表未用</th></tr>${r.flow.map((f) => `<tr><td>${e(f.step)}</td><td>${f.leftBefore}</td><td>${f.matchedLeft}</td><td>${f.unmatchedLeft}</td><td>${f.droppedLeft}</td><td>${f.addedRows}</td><td>${f.outputRows}</td><td>${f.unusedRight}</td></tr>`).join("")}</table><h2>检查事项</h2><ul>${r.issues.length ? r.issues.map((i) => `<li>${e(i.message)} <small>${e(i.code)}</small></li>`).join("") : "<li>在当前方案的检查范围内未发现异常。</li>"}</ul><h2>清洗记录</h2><ul>${r.cleaningLog.map((c) => `<li>${e(datasets.find((d) => d.id === c.table)?.name ?? c.table)}：${c.before} → ${c.after} 行；去空格 ${c.trimmed} 格，缺失转换 ${c.missing} 格，换算 ${c.scaled} 格，完全重复 ${c.duplicates} 行。</li>`).join("")}</ul>${r.panel ? `<h2>年度面板</h2><p>${r.panel.entities} 个实体 · ${r.panel.minYear ?? "—"}–${r.panel.maxYear ?? "—"} 年 · ${r.panel.duplicateGroups} 组重复实体年份 · ${r.panel.missingYears} 个年度缺口 · ${r.panel.invalidRows} 条无法检查的记录。</p><p>缺口仅检查每个实体自身首尾年份之间；不能据此断言面板满足研究需要的全样本覆盖。</p>` : ""}<h2>复现说明</h2><p>解压后使用 Python 3.10+ 运行 <code>python reproduce.py --output reproduced</code>。脚本只使用 Python 标准库；处理方案为数据，不执行任何模型生成代码。详见 README.txt。</p></html>`;
}
export async function buildBundle(
  datasets: Dataset[],
  r: Result,
  python: string,
) {
  if (!r.ok) throw new Error("只有完整处理成功的结果才能导出。");
  const files: Record<string, Uint8Array> = {};
  const put = (name: string, value: string) => (files[name] = strToU8(value));
  put("parsed-inputs.json", JSON.stringify(datasets));
  put("plan.json", JSON.stringify(r.plan, null, 2));
  put(
    "data.csv",
    toCsv(
      r.columns,
      r.rows.map((x) => x.values),
    ),
  );
  put(
    "data-excel-safe.csv",
    toCsv(
      r.columns,
      r.rows.map((x) => x.values),
      true,
    ),
  );
  put(
    "expected.json",
    JSON.stringify({
      columns: r.columns,
      rows: r.rows.map((x) => x.values),
      origins: r.rows.map((x) => x.origins),
      flow: r.flow,
      cleaningLog: r.cleaningLog,
      panel: r.panel,
    }),
  );
  const { rows, ...audit } = r;
  put("audit.json", JSON.stringify(audit, null, 2));
  put(
    "lineage.json",
    JSON.stringify(
      rows.map((row, i) => ({ outputRecord: i + 2, origins: row.origins })),
    ),
  );
  put("unmatched.json", JSON.stringify(r.unmatched));
  put("report.html", reportHtml(datasets, r));
  put("reproduce.py", python);
  datasets.forEach((d, i) =>
    put(
      `inputs/${String(i + 1).padStart(2, "0")}.csv`,
      toCsv(d.columns, d.rows),
    ),
  );
  put(
    "README.txt",
    `PanelPrep — 研究数据包\n\n1. data.csv 是保真的文本 CSV（UTF-8 BOM）。ID 保留前导零，空值为空字段。建议用程序读取并显式保留字符串。\n2. data-excel-safe.csv 对可能被 Excel 当作公式的文本加单引号前缀，仅供表格查看；不是保真的分析输入。\n3. parsed-inputs.json 是导入后的文本快照，包含稳定的表 ID、列、记录和原始记录号。inputs/ 是便于查看的规范化 CSV 快照；不是原文件字节副本。原文件的 SHA-256 如有则记录在快照和报告中。表头会去除首尾空格，完全空白物理记录会跳过；全空字段的数据记录保留。\n4. plan.json 保存每个明确的清洗和合并操作。右侧同名列使用 表ID__列名，继续冲突则加前导下划线。\n5. lineage.json 记录每个结果样本来自哪些表、哪些原始记录。unmatched.json 包含每次合并未匹配的两侧记录及来源。\n6. report.html 是可离线打开的审计报告，audit.json 保存机器可读记录。年度缺口仅按各实体首尾年之间计算。\n\n复现（Python 3.10+，无需安装第三方包）：\n  python reproduce.py --output reproduced\n\n脚本会检查 manifest.json 的输入摘要，然后重新运行 plan.json，并核对结果、谱系、样本流失、清洗统计和面板检查。所有计划字段均为数据，脚本不执行 AI 生成代码。输出目录已存在时会停止，避免覆盖。\n\n限制：当前仅支持年度面板、精确键匹配、左/内连接和明确的十进制倍数换算。不自动推断企业/地区更名、币种、财年、名义实际值；不填补缺失、不自动聚合重复键、不做多对多合并。结果不是对经济识别假设的检验。\n\nAI：AI 仅用于提出经用户复核的方案。本包不包含 API 密钥。代码由 AI 辅助开发，源码和测试公开于 https://github.com/Yangtao666China/panelprep-data-agent 。\n`,
  );
  const hashes: Record<string, string> = {};
  for (const name of ["parsed-inputs.json", "plan.json", "expected.json"]) {
    const bytes = files[name];
    hashes[name] = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes as BufferSource),
      ),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  }
  put(
    "manifest.json",
    JSON.stringify(
      {
        tool: "PanelPrep",
        version: "0.1.0",
        createdAt: new Date().toISOString(),
        hashes,
        inputs: datasets.map((d, i) => ({
          id: d.id,
          name: d.name,
          snapshot: `inputs/${String(i + 1).padStart(2, "0")}.csv`,
          sourceSha256: d.sha256 ?? null,
        })),
      },
      null,
      2,
    ),
  );
  return files;
}
export async function downloadBundle(datasets: Dataset[], r: Result) {
  const response = await fetch("/reproduce.py");
  if (!response.ok) throw new Error("无法加载复现脚本，请稍后重试。");
  const files = await buildBundle(datasets, r, await response.text());
  const bytes = zipSync(files, { level: 6 });
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: "application/zip" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "panelprep-research.zip";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
