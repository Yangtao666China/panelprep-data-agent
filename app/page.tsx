"use client";
import { useMemo, useRef, useState } from "react";
import {
  Database,
  FileSpreadsheet,
  FlaskConical,
  GitMerge,
  Plus,
  ShieldCheck,
  Trash2,
  X,
  CircleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlanEditor } from "@/components/panel/plan-editor";
import { Results } from "@/components/panel/results";
import { AgentAssistant } from "@/components/panel/agent-assistant";
import { Choice, Preview, count } from "@/components/panel/widgets";
import {
  Dataset,
  Plan,
  Result,
  LIMITS,
  decodeFile,
  demoDatasets,
  demoPlan,
  emptyPlan,
  parseDelimited,
  prepare,
  profile,
} from "@/lib/panelprep";

export default function Home() {
  const [datasets, setDatasets] = useState<Dataset[]>(demoDatasets),
    [plan, setPlan] = useState<Plan>(demoPlan),
    [result, setResult] = useState<Result | null>(() =>
      prepare(demoDatasets(), demoPlan()),
    );
  const [tab, setTab] = useState("plan"),
    [active, setActive] = useState("firms"),
    [example, setExample] = useState(true),
    [stale, setStale] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [info, setInfo] = useState(false),
    [trace, setTrace] = useState<number | null>(null),
    [exportBusy, setExportBusy] = useState(false),
    [encoding, setEncoding] = useState<"utf-8" | "gb18030">("utf-8");
  const revision = useRef(0);
  const input = useRef<HTMLInputElement>(null),
    planInput = useRef<HTMLInputElement>(null);
  const selected = datasets.find((d) => d.id === active) ?? datasets[0],
    stats = useMemo(() => (selected ? profile(selected) : null), [selected]);
  function change(p: Plan) {
    revision.current++;
    setPlan(p);
    setStale(true);
    setError("");
    setTrace(null);
  }
  function loadDemo() {
    revision.current++;
    const d = demoDatasets(),
      p = demoPlan();
    setDatasets(d);
    setPlan(p);
    setResult(prepare(d, p));
    setActive(d[0].id);
    setExample(true);
    setStale(false);
    setTab("plan");
    setError("");
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const rev = revision.current;
    setBusy(true);
    setError("");
    try {
      const previous = example ? [] : datasets;
      if (previous.length + files.length > 5)
        throw new Error("最多同时整理 5 张表，请先移除不需要的表。");
      const added: Dataset[] = [];
      for (const f of Array.from(files)) {
        if (!/\.(csv|tsv|txt)$/i.test(f.name))
          throw new Error("首版支持 CSV / TSV，Excel 请先另存为 CSV UTF-8。");
        if (f.size > LIMITS.bytes) throw new Error(`${f.name} 超过 10 MB。`);
        const bytes = await f.arrayBuffer();
        const sha = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        )
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
        let id = "t_" + sha.slice(0, 16),
          suffix = 2;
        while ([...previous, ...added].some((d) => d.id === id))
          id = "t_" + sha.slice(0, 16) + "_" + suffix++;
        const d = parseDelimited(decodeFile(bytes, encoding), id, f.name);
        d.sha256 = sha;
        d.encoding = encoding;
        added.push(d);
      }
      const all = [...previous, ...added];
      if (
        all.reduce((n, d) => n + d.rows.length * d.columns.length, 0) >
        LIMITS.cells
      )
        throw new Error("数据总量超过 200 万单元格，请分批整理。");
      if (rev !== revision.current) return;
      setDatasets(all);
      change(
        previous.length
          ? {
              ...plan,
              cleaning: [...plan.cleaning, ...emptyPlan(added).cleaning],
            }
          : emptyPlan(all),
      );
      setResult(null);
      setActive(added[0].id);
      setExample(false);
      setTab("plan");
    } catch (e) {
      if (rev === revision.current) setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  function remove(id: string) {
    const d = datasets.filter((d) => d.id !== id);
    setDatasets(d);
    change(emptyPlan(d));
    setResult(null);
    setActive(d[0]?.id ?? "");
  }
  async function run() {
    setBusy(true);
    setError("");
    try {
      const rev = revision.current;
      const { prepareInWorker } = await import("@/lib/client-runner");
      const r = await prepareInWorker(datasets, plan);
      if (rev === revision.current) {
        setResult(r);
        setStale(false);
        setTab("results");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importPlan(file?: File) {
    if (!file) return;
    const rev = revision.current;
    try {
      if (file.size > 100000) throw new Error("方案文件过大。");
      const { validateImportedPlan } = await import("@/lib/agent");
      const p = validateImportedPlan(
        JSON.parse(await file.text()),
        datasets.map(profile),
      );
      if (rev !== revision.current) return;
      change(p);
      setTab("plan");
    } catch (e) {
      if (rev === revision.current)
        setError(`方案导入失败：${(e as Error).message}`);
    }
    if (planInput.current) planInput.current.value = "";
  }
  async function bundle() {
    if (!result?.ok || stale) return;
    setExportBusy(true);
    setError("");
    try {
      const { downloadBundle } = await import("@/lib/export");
      await downloadBundle(datasets, result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  }
  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="brand">
          <span className="brand-symbol">
            <GitMerge size={22} />
          </span>
          PanelPrep<span className="edition">研究工作台</span>
        </div>
        <div className="top-actions">
          <span className="privacy">
            <ShieldCheck size={15} />
            表格在本机处理
          </span>
          <Button variant="ghost" onClick={() => setInfo(true)}>
            使用说明
          </Button>
          <a
            href="https://github.com/Yangtao666China/panelprep"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </header>
      <main className="workspace">
        <div className="workspace-title">
          <div>
            <div className="eyebrow">DATA PREPARATION</div>
            <h1>让每一次合并，都有据可查。</h1>
            <p>整理研究数据，核对样本变化，保留完整处理记录。</p>
          </div>
          <div className="title-actions">
            <Button variant="outline" onClick={loadDemo} disabled={busy}>
              <FlaskConical />
              载入示例
            </Button>
            <Button onClick={() => input.current?.click()} disabled={busy}>
              <Plus />
              导入数据
            </Button>
          </div>
        </div>
        <input
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt"
          multiple
          hidden
          onChange={(e) => importFiles(e.target.files)}
        />
        <input
          ref={planInput}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => importPlan(e.target.files?.[0])}
        />
        {error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={18} />
            <span>{error}</span>
            <button aria-label="关闭错误提示" onClick={() => setError("")}>
              <X size={17} />
            </button>
          </div>
        )}
        <div className="work-grid">
          <aside className="data-panel">
            <div className="section-title">
              <h2>数据表</h2>
              <span>{datasets.length} / 5</span>
            </div>
            {example && (
              <div className="example-label">合成示例 · 导入后替换</div>
            )}
            <div className="dataset-list">
              {datasets.map((d, i) => (
                <div
                  className={`dataset-card ${active === d.id ? "selected" : ""}`}
                  key={d.id}
                >
                  <button
                    className="dataset-pick"
                    onClick={() => {
                      setActive(d.id);
                      setTab("data");
                    }}
                  >
                    <span className="dataset-icon">
                      <FileSpreadsheet size={19} />
                    </span>
                    <span>
                      <strong>{d.name}</strong>
                      <small>
                        {count(d.rows.length)} 行 · {d.columns.length} 列
                      </small>
                    </span>
                  </button>
                  <div className="dataset-foot">
                    <span
                      className={
                        d.id === plan.base ? "base-badge" : "table-tag"
                      }
                    >
                      {d.id === plan.base ? "主表" : `表 ${i + 1}`}
                    </span>
                    <button
                      aria-label={`移除 ${d.name}`}
                      disabled={busy}
                      onClick={() => remove(d.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              className="drop-area"
              onClick={() => input.current?.click()}
              disabled={busy}
            >
              <Plus size={22} />
              <strong>添加 CSV / TSV</strong>
              <span>最多 5 张表，单文件 10 MB</span>
            </button>
            <label className="field-label">导入编码</label>
            <Choice
              value={encoding}
              onChange={(v) => setEncoding(v as typeof encoding)}
              options={[
                { value: "utf-8", label: "UTF-8（推荐）" },
                { value: "gb18030", label: "GB18030 / GBK" },
              ]}
              label="导入编码"
            />
            <div className="local-note">
              <ShieldCheck size={18} />
              <p>关闭或刷新页面会清空工作区，请及时导出研究包。</p>
            </div>
          </aside>
          <section className="main-panel">
            <Tabs value={tab} onValueChange={setTab}>
              <div className="main-tabbar">
                <TabsList variant="line">
                  <TabsTrigger value="plan">处理方案</TabsTrigger>
                  <TabsTrigger value="results">
                    结果与审计
                    {result?.issues.length ? (
                      <span className="tab-count">{result.issues.length}</span>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger value="data">数据预览</TabsTrigger>
                </TabsList>
                <span className="status-text">
                  {stale ? "待重新运行" : result?.ok ? "检查已完成" : ""}
                </span>
              </div>
              <TabsContent value="plan">
                {datasets.length ? (
                  <PlanEditor
                    datasets={datasets}
                    plan={plan}
                    onChange={change}
                    onRun={run}
                    busy={busy}
                    onImport={() => planInput.current?.click()}
                  />
                ) : (
                  <div className="empty-state">
                    <Database size={36} />
                    <h3>从你的第一张表开始</h3>
                    <p>导入数据，或载入示例试用完整流程。</p>
                    <Button onClick={() => input.current?.click()}>
                      导入数据
                    </Button>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="results">
                <Results
                  datasets={datasets}
                  result={result}
                  stale={stale}
                  busy={busy}
                  exportBusy={exportBusy}
                  onRun={run}
                  onExport={bundle}
                  onTrace={setTrace}
                />
              </TabsContent>
              <TabsContent value="data">
                <div className="data-content">
                  <div className="panel-heading">
                    <div>
                      <h2>{selected?.name ?? "数据预览"}</h2>
                      <p>保留文本和前导零，不自动猜测字段含义。</p>
                    </div>
                  </div>
                  {selected && (
                    <>
                      <div className="column-summary">
                        {stats?.columns.map((c) => (
                          <div key={c.name}>
                            <strong>{c.name}</strong>
                            <span>{c.distinct} 个不同值</span>
                            {c.missing > 0 && <em>{c.missing} 个空值</em>}
                            {c.whitespace > 0 && (
                              <em>{c.whitespace} 处首尾空格</em>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="preview-heading">
                        <h3>原始记录</h3>
                        <span>前 30 / {count(selected.rows.length)} 行</span>
                      </div>
                      <Preview
                        columns={selected.columns}
                        rows={selected.rows}
                        recordNumbers={selected.recordNumbers}
                      />
                      <p className="field-hint">
                        记录号包含表头；引号中的换行属于同一条记录。
                      </p>
                    </>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </section>
          <AgentAssistant
            datasets={datasets}
            plan={plan}
            onApply={(p) => {
              change(p);
              setTab("plan");
            }}
          />
        </div>
        <footer className="footer">
          <span>PanelPrep · 可复现的数据准备</span>
          <span>结果可靠性取决于字段含义、数据来源与研究设计。</span>
        </footer>
      </main>
      <Dialog open={info} onOpenChange={setInfo}>
        <DialogContent className="help-dialog">
          <DialogHeader>
            <DialogTitle>从原始表到研究数据</DialogTitle>
            <DialogDescription>
              支持 1–5 张 CSV / TSV，单表最多 10 MB、10 万行，总计最多 200
              万单元格。
            </DialogDescription>
          </DialogHeader>
          <ol>
            <li>
              <strong>导入数据：</strong>字段先按文本读取，保留前导零。Excel
              请先另存为 CSV UTF-8。
            </li>
            <li>
              <strong>明确合并键：</strong>
              选择主表、辅助表和关系。字段含义不明时先查数据字典。
            </li>
            <li>
              <strong>复核清洗规则：</strong>
              去空格、缺失标记、完全重复行和单位换算都由你明确选择。
            </li>
            <li>
              <strong>运行并核对：</strong>
              检查未匹配样本、重复面板键和年度缺口。
            </li>
            <li>
              <strong>导出研究包：</strong>保存原始表快照、结果、审计记录和
              Python 复现脚本。
            </li>
          </ol>
          <p>
            AI
            可选，密钥只保留在当前页面内存。无需连接模型也可以手动完成全部整理。刷新前请导出。
          </p>
        </DialogContent>
      </Dialog>
      <Dialog
        open={trace !== null}
        onOpenChange={(v) => {
          if (!v) setTrace(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              记录 #{trace === null ? "" : trace + 1} 的来源
            </DialogTitle>
            <DialogDescription>
              完全重复行合并后保留全部原始记录号。
            </DialogDescription>
          </DialogHeader>
          {trace !== null &&
            result?.rows[trace] &&
            Object.entries(result.rows[trace].origins).map(([id, rows]) => (
              <div className="trace-entry" key={id}>
                <FileSpreadsheet size={19} />
                <div>
                  <strong>
                    {datasets.find((d) => d.id === id)?.name ?? id}
                  </strong>
                  <p>原始记录 {rows.join(", ")}</p>
                </div>
              </div>
            ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}
