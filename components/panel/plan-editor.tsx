"use client";
import { GitMerge, Plus, ShieldCheck, X, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Choice, items } from "./widgets";
import {
  Cleaning,
  Dataset,
  Plan,
  emptyPlan,
  plannedColumns,
  suggestJoin,
} from "@/lib/panelprep";
export function PlanEditor({
  datasets,
  plan,
  onChange,
  onRun,
  busy,
  onImport,
}: {
  datasets: Dataset[];
  plan: Plan;
  onChange: (p: Plan) => void;
  onRun: () => void;
  busy: boolean;
  onImport: () => void;
}) {
  const columns = plannedColumns(datasets, plan);
  let noYear = "__none";
  while (columns.includes(noYear)) noYear = "_" + noYear;
  const clean = (id: string, fn: (c: Cleaning) => Cleaning) =>
    onChange({
      ...plan,
      cleaning: plan.cleaning.map((c) => (c.table === id ? fn(c) : c)),
    });
  return (
    <div className="plan-content">
      <div className="panel-heading">
        <div>
          <h2>定义整理步骤</h2>
          <p>明确合并键与样本保留方式，再运行检查。</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onImport}>
          导入方案
        </Button>
      </div>
      <div className="step-block">
        <div className="step-label">
          <span className="step-number">01</span>
          <h3>选择主表</h3>
        </div>
        <Choice
          value={plan.base}
          onChange={(v) =>
            onChange(
              emptyPlan([
                datasets.find((d) => d.id === v)!,
                ...datasets.filter((d) => d.id !== v),
              ]),
            )
          }
          options={datasets.map((d) => ({ value: d.id, label: d.name }))}
          label="主表"
        />
        <p className="field-hint">主表决定观察样本。更换主表将重置处理方案。</p>
      </div>
      <div className="step-block">
        <div className="step-label">
          <span className="step-number">02</span>
          <h3>设置合并</h3>
          <span className="muted">{plan.joins.length} 步</span>
        </div>
        {plan.joins.map((j, ji) => {
          const right = datasets.find((d) => d.id === j.table)!;
          const left = plannedColumns(datasets, plan, ji);
          const update = (patch: Partial<typeof j>) =>
            onChange({
              ...plan,
              joins: plan.joins.map((s, i) =>
                i === ji ? { ...s, ...patch } : s,
              ),
            });
          return (
            <div className="join-card" key={j.table}>
              <div className="join-heading">
                <div>
                  <GitMerge size={17} />
                  <strong>{right.name}</strong>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`移除 ${right.name} 合并`}
                  onClick={() =>
                    onChange({
                      ...plan,
                      joins: plan.joins.filter((_, i) => i !== ji),
                      panel: { entity: [], year: "" },
                    })
                  }
                >
                  <X />
                </Button>
              </div>
              <div className="key-labels">
                <span>当前主表字段</span>
                <span></span>
                <span>辅助表字段</span>
                <span></span>
              </div>
              {j.keys.map((k, ki) => (
                <div className="key-pair" key={ki}>
                  <Choice
                    value={k.left}
                    onChange={(v) =>
                      update({
                        keys: j.keys.map((p, i) =>
                          i === ki ? { ...p, left: v } : p,
                        ),
                      })
                    }
                    options={items(left)}
                    label={`合并${ji + 1}左键${ki + 1}`}
                  />
                  <span className="equals">=</span>
                  <Choice
                    value={k.right}
                    onChange={(v) =>
                      update({
                        keys: j.keys.map((p, i) =>
                          i === ki ? { ...p, right: v } : p,
                        ),
                      })
                    }
                    options={items(right.columns)}
                    label={`合并${ji + 1}右键${ki + 1}`}
                  />
                  <button
                    aria-label={`删除合并键${ki + 1}`}
                    onClick={() =>
                      update({ keys: j.keys.filter((_, i) => i !== ki) })
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  update({ keys: [...j.keys, { left: "", right: "" }] })
                }
              >
                <Plus />
                增加合并键
              </Button>
              <div className="join-options">
                <div>
                  <label className="field-label">保留哪些样本</label>
                  <Choice
                    value={j.how}
                    onChange={(v) => update({ how: v as typeof j.how })}
                    options={[
                      { value: "left", label: "左连接 · 保留全部主表记录" },
                      { value: "inner", label: "内连接 · 仅保留匹配记录" },
                    ]}
                    label="连接类型"
                  />
                </div>
                <div>
                  <label className="field-label">预期合并关系</label>
                  <Choice
                    value={j.relationship}
                    onChange={(v) =>
                      update({ relationship: v as typeof j.relationship })
                    }
                    options={[
                      { value: "many-to-one", label: "多对一 · 辅助表键唯一" },
                      { value: "one-to-one", label: "一对一 · 两侧键唯一" },
                      { value: "one-to-many", label: "一对多 · 主表键唯一" },
                    ]}
                    label="合并关系"
                  />
                </div>
              </div>
            </div>
          );
        })}
        {datasets
          .filter(
            (d) =>
              d.id !== plan.base && !plan.joins.some((j) => j.table === d.id),
          )
          .map((d) => (
            <button
              className="add-join"
              key={d.id}
              onClick={() =>
                onChange({
                  ...plan,
                  joins: [...plan.joins, suggestJoin(columns, d)],
                })
              }
            >
              <Plus size={17} />
              合并 {d.name}
            </button>
          ))}
        <p className="field-hint">
          缺失键不匹配。重复键不符合所选关系时停止处理。新增步骤的同名键是规则建议，请核对含义。
        </p>
      </div>
      <div className="step-block">
        <div className="step-label">
          <span className="step-number">03</span>
          <h3>明确清洗规则</h3>
          <span className="muted">可选</span>
        </div>
        {datasets.map((d) => {
          const c = plan.cleaning.find((c) => c.table === d.id)!;
          return (
            <details className="clean-details" key={d.id}>
              <summary>
                <span>{d.name}</span>
                <span>
                  {c.trim.length +
                    c.scales.length +
                    (c.missingTokens.length ? 1 : 0) +
                    (c.dropExactDuplicates ? 1 : 0)}{" "}
                  项规则
                </span>
              </summary>
              <div className="clean-body">
                <label className="field-label">
                  视为缺失的文本（逗号分隔，区分大小写）
                </label>
                <input
                  className="text-input"
                  key={c.missingTokens.join(",")}
                  defaultValue={c.missingTokens.join(",")}
                  placeholder="NA,N/A,--"
                  onBlur={(e) =>
                    clean(d.id, (c) => ({
                      ...c,
                      missingTokens: e.target.value.split(",").filter(Boolean),
                    }))
                  }
                />
                <label className="check-line">
                  <Checkbox
                    checked={c.dropExactDuplicates}
                    onCheckedChange={(v) =>
                      clean(d.id, (c) => ({
                        ...c,
                        dropExactDuplicates: v === true,
                      }))
                    }
                  />
                  删除清洗后整行完全相同的重复记录
                </label>
                <label className="field-label">去除首尾空格的列</label>
                <div className="column-checks">
                  {d.columns.map((col) => (
                    <label className="check-line" key={col}>
                      <Checkbox
                        checked={c.trim.includes(col)}
                        onCheckedChange={(v) =>
                          clean(d.id, (c) => ({
                            ...c,
                            trim: v
                              ? [...c.trim, col]
                              : c.trim.filter((x) => x !== col),
                          }))
                        }
                      />
                      {col}
                    </label>
                  ))}
                </div>
                {c.scales.map((s, si) => (
                  <div className="scale-rule" key={si}>
                    <Choice
                      value={s.column}
                      onChange={(v) =>
                        clean(d.id, (c) => ({
                          ...c,
                          scales: c.scales.map((x, i) =>
                            i === si ? { ...x, column: v } : x,
                          ),
                        }))
                      }
                      options={items(d.columns)}
                      label="换算列"
                    />
                    <div className="scale-inputs">
                      {(["from", "to", "factor"] as const).map((f) => (
                        <label key={f}>
                          {f === "from"
                            ? "原单位"
                            : f === "to"
                              ? "目标单位"
                              : "乘以倍数"}
                          <input
                            className="text-input"
                            type={f === "factor" ? "number" : "text"}
                            value={s[f]}
                            onChange={(e) =>
                              clean(d.id, (c) => ({
                                ...c,
                                scales: c.scales.map((x, i) =>
                                  i === si
                                    ? {
                                        ...x,
                                        [f]:
                                          f === "factor"
                                            ? Number(e.target.value)
                                            : e.target.value,
                                      }
                                    : x,
                                ),
                              }))
                            }
                          />
                        </label>
                      ))}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="移除换算"
                        onClick={() =>
                          clean(d.id, (c) => ({
                            ...c,
                            scales: c.scales.filter((_, i) => i !== si),
                          }))
                        }
                      >
                        <X />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    clean(d.id, (c) => ({
                      ...c,
                      scales: [
                        ...c.scales,
                        { column: "", factor: 1, from: "", to: "" },
                      ],
                    }))
                  }
                >
                  <Plus />
                  添加明确的单位换算
                </Button>
                <p className="field-hint">
                  不推断币种、汇率、名义 / 实际值或统计口径。
                </p>
              </div>
            </details>
          );
        })}
      </div>
      <div className="step-block">
        <div className="step-label">
          <span className="step-number">04</span>
          <h3>检查年度面板</h3>
          <span className="muted">可选</span>
        </div>
        <div className="join-options">
          <div>
            <label className="field-label">实体标识（可多选）</label>
            <div className="column-checks panel-keys">
              {columns.map((c) => (
                <label className="check-line" key={c}>
                  <Checkbox
                    checked={plan.panel.entity.includes(c)}
                    onCheckedChange={(v) =>
                      onChange({
                        ...plan,
                        panel: {
                          ...plan.panel,
                          entity: v
                            ? [...plan.panel.entity, c]
                            : plan.panel.entity.filter((x) => x !== c),
                        },
                      })
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="field-label">年份字段</label>
            <Choice
              value={plan.panel.year || noYear}
              onChange={(v) =>
                onChange({
                  ...plan,
                  panel: { ...plan.panel, year: v === noYear ? "" : v },
                })
              }
              options={[
                { value: noYear, label: "不检查年份" },
                ...items(columns),
              ]}
              label="年份字段"
            />
            <p className="field-hint">
              检查实体 × 年份唯一性，及每个实体首尾年之间的年度缺口。
            </p>
          </div>
        </div>
      </div>
      <div className="run-bar">
        <span>
          <ShieldCheck size={17} />
          原始数据不会被修改
        </span>
        <Button size="lg" onClick={onRun} disabled={busy}>
          {busy ? <LoaderCircle className="spin" /> : <GitMerge />}
          运行整理与检查
        </Button>
      </div>
    </div>
  );
}
