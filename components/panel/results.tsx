"use client";
import {
  Check,
  CircleAlert,
  ArrowDownToLine,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dataset, Result, toCsv } from "@/lib/panelprep";
import { count, Preview, saveFile } from "./widgets";
export function Results({
  datasets,
  result,
  stale,
  busy,
  exportBusy,
  onRun,
  onExport,
  onTrace,
}: {
  datasets: Dataset[];
  result: Result | null;
  stale: boolean;
  busy: boolean;
  exportBusy: boolean;
  onRun: () => void;
  onExport: () => void;
  onTrace: (i: number) => void;
}) {
  const ready = !!result?.ok && !stale;
  return (
    <div className="result-content">
      <div className="panel-heading">
        <div>
          <h2>结果与审计</h2>
          <p>每一步匹配、保留与流失，都有记录。</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRun}
          disabled={busy || !datasets.length}
        >
          <RotateCcw />
          重新运行
        </Button>
      </div>
      {!result ? (
        <div className="empty-state">
          <h3>等待第一次运行</h3>
          <p>在处理方案中确定合并键，再运行整理与检查。</p>
        </div>
      ) : (
        <>
          {stale && (
            <div className="notice">
              方案已修改，下面是上次运行记录。重新运行后才能导出。
            </div>
          )}
          <div className={`result-banner ${result.ok ? "" : "blocked"}`}>
            <span className="result-icon">
              {result.ok ? <Check /> : <CircleAlert />}
            </span>
            <div>
              <strong>
                {result.ok
                  ? result.issues.length
                    ? "处理完成，有事项需要复核"
                    : "处理完成，检查未发现异常"
                  : "已停止：处理条件不满足"}
              </strong>
              <p>
                {result.ok
                  ? `${count(result.rows.length)} 条结果记录 · ${result.columns.length} 个字段`
                  : "请修正处理方案；未完成的中间结果不能导出。"}
              </p>
            </div>
          </div>
          {result.flow.length > 0 && (
            <section className="flow-section">
              <h3>样本变化</h3>
              {result.flow.map((f, i) => (
                <div className="flow-item" key={i}>
                  <div className="flow-caption">
                    <strong>
                      {i + 1}. 合并 {f.step}
                    </strong>
                    <span>
                      {f.leftBefore
                        ? ((f.matchedLeft / f.leftBefore) * 100).toFixed(1)
                        : "0"}
                      % 主表匹配率
                    </span>
                  </div>
                  <div className="flow-track">
                    <span
                      style={{
                        width: `${f.leftBefore ? (f.matchedLeft / f.leftBefore) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="flow-numbers">
                    <span>
                      合并前 <b>{count(f.leftBefore)}</b>
                    </span>
                    <span>
                      匹配 <b>{count(f.matchedLeft)}</b>
                    </span>
                    <span>
                      未匹配 <b>{count(f.unmatchedLeft)}</b>
                    </span>
                    <span>
                      结果 <b>{count(f.outputRows)}</b>
                    </span>
                  </div>
                  <p className="field-hint">
                    移出 {f.droppedLeft} 条主表记录 · 连接新增 {f.addedRows} 行
                    · 辅助表未用 {f.unusedRight} 行
                  </p>
                </div>
              ))}
            </section>
          )}
          {result.panel && (
            <div className="panel-stats">
              <div>
                <span>实体数量</span>
                <strong>{count(result.panel.entities)}</strong>
              </div>
              <div>
                <span>年份范围</span>
                <strong>
                  {result.panel.minYear ?? "—"}–{result.panel.maxYear ?? "—"}
                </strong>
              </div>
              <div>
                <span>重复实体 × 年份</span>
                <strong>{result.panel.duplicateGroups}</strong>
              </div>
              <div>
                <span>年度缺口</span>
                <strong>{result.panel.missingYears}</strong>
              </div>
            </div>
          )}
          <section className="findings">
            <h3>
              检查记录 <span>{result.issues.length}</span>
            </h3>
            {result.issues.length ? (
              result.issues.map((issue, i) => (
                <div className={`finding ${issue.severity}`} key={i}>
                  <CircleAlert size={18} />
                  <div>
                    <strong>{issue.message}</strong>
                    <small>
                      {issue.code}
                      {issue.rows?.length
                        ? ` · 原始记录 ${issue.rows.join(", ")}`
                        : ""}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <div className="finding info">
                <Check size={18} />
                <span>在当前方案的检查范围内未发现异常。</span>
              </div>
            )}
          </section>
          <details className="clean-details">
            <summary>
              清洗记录 <span>{result.cleaningLog.length} 张表</span>
            </summary>
            <div className="clean-body">
              {result.cleaningLog.map((c) => (
                <p className="clean-log" key={c.table}>
                  <strong>
                    {datasets.find((d) => d.id === c.table)?.name}
                  </strong>
                  <span>
                    {c.before} → {c.after} 行 · 去空格 {c.trimmed} 格 · 缺失转换{" "}
                    {c.missing} 格 · 换算 {c.scaled} 格 · 合并完全重复{" "}
                    {c.duplicates} 行
                  </span>
                </p>
              ))}
            </div>
          </details>
          {result.ok && (
            <>
              <div className="export-box">
                <div>
                  <h3>把结果带走</h3>
                  <p>原始表快照、结果、审计记录与 Python 复现脚本。</p>
                </div>
                <Button onClick={onExport} disabled={!ready || exportBusy}>
                  {exportBusy ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <ArrowDownToLine />
                  )}
                  导出完整研究包
                </Button>
              </div>
              <div className="export-links">
                <button
                  disabled={!ready}
                  onClick={() =>
                    saveFile(
                      "panelprep-data.csv",
                      toCsv(
                        result.columns,
                        result.rows.map((r) => r.values),
                      ),
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  保真 CSV
                </button>
                <button
                  disabled={!ready}
                  onClick={() =>
                    saveFile(
                      "panelprep-excel-safe.csv",
                      toCsv(
                        result.columns,
                        result.rows.map((r) => r.values),
                        true,
                      ),
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  Excel 安全副本
                </button>
                <button
                  disabled={!ready}
                  onClick={() =>
                    saveFile("plan.json", JSON.stringify(result.plan, null, 2))
                  }
                >
                  处理方案 JSON
                </button>
              </div>
              <p className="field-hint">
                保真 CSV 用于程序分析；Excel
                安全副本会为可能执行公式的文本加前缀。
              </p>
              <div className="preview-heading">
                <h3>结果预览</h3>
                <span>前 30 行 · 点击记录号查看来源</span>
              </div>
              <Preview
                columns={result.columns}
                rows={result.rows.map((r) => r.values)}
                onTrace={onTrace}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
