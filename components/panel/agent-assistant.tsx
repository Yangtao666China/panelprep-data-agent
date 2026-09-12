"use client";
import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { replySchema } from "@/lib/agent";
import { Dataset, Plan, profile, validatePlan } from "@/lib/panelprep";
export function AgentAssistant({
  datasets,
  plan,
  onApply,
}: {
  datasets: Dataset[];
  plan: Plan;
  onApply: (p: Plan) => void;
}) {
  const [goal, setGoal] = useState(
    "按地区、年份合并企业财务表与地区指标，保留全部企业样本，检查公司年度是否重复。",
  );
  const [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [proposal, setProposal] = useState<{
      plan: Plan;
      explanation: string;
      questions: string[];
      usage?: number;
    } | null>(null);
  const controller = useRef<AbortController | null>(null),
    revision = useRef(0);
  useEffect(() => {
    revision.current++;
    controller.current?.abort();
    // A new input snapshot invalidates the external request and its draft.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(false);
    setProposal(null);
  }, [datasets, plan]);
  useEffect(() => () => controller.current?.abort(), []);
  async function ask() {
    if (!key.trim()) {
      setMessage(
        "请填写自己的 DeepSeek API Key。无需连接 AI，也能在处理方案中完成全部整理操作。",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    setProposal(null);
    const rev = revision.current;
    const c = new AbortController();
    controller.current = c;
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: key,
          goal,
          profiles: datasets.map(profile),
          currentPlan: plan,
        }),
        signal: c.signal,
      });
      const raw: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          raw &&
            typeof raw === "object" &&
            "error" in raw &&
            typeof raw.error === "string"
            ? raw.error
            : "AI 服务暂时不可用。",
        );
      const data = replySchema.parse(raw);
      const issues = validatePlan(datasets, data.plan);
      if (issues.length) throw new Error(issues.join("；"));
      if (rev === revision.current) setProposal(data);
    } catch (e) {
      if ((e as Error).name !== "AbortError" && rev === revision.current)
        setMessage((e as Error).message);
    } finally {
      if (rev === revision.current) setBusy(false);
    }
  }
  function cancel() {
    revision.current++;
    controller.current?.abort();
    setBusy(false);
  }
  return (
    <aside className="agent-panel">
      <div className="agent-heading">
        <span className="agent-symbol">
          <Sparkles size={20} />
        </span>
        <div>
          <h2>整理助手</h2>
          <span>AI 规划 · 人工复核 · 程序检查</span>
        </div>
      </div>
      <p className="agent-intro">
        描述整理目标，助手根据字段和数据概况，拟定一份可以修改的方案。
      </p>
      <label className="field-label" htmlFor="goal">
        这次想整理什么？
      </label>
      <textarea
        id="goal"
        className="goal-input"
        value={goal}
        onChange={(e) => {
          cancel();
          setProposal(null);
          setGoal(e.target.value);
        }}
        maxLength={2000}
        rows={5}
      />
      <details className="api-settings" open>
        <summary>
          连接 DeepSeek <span>{key ? "已填写" : "选填"}</span>
        </summary>
        <div>
          <label className="field-label" htmlFor="api-key">
            你的 API Key
          </label>
          <input
            id="api-key"
            className="text-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            placeholder="sk-…"
            onChange={(e) => {
              cancel();
              setKey(e.target.value);
            }}
          />
          <p>仅保存在本次页面会话。调用使用你的 DeepSeek API 额度。</p>
        </div>
      </details>
      <Button
        className="ask-button"
        disabled={busy || !datasets.length || !goal.trim()}
        onClick={ask}
      >
        {busy ? <LoaderCircle className="spin" /> : <Sparkles />}
        {busy ? "正在检查方案…" : "生成 AI 整理方案"}
      </Button>
      {busy && (
        <button className="cancel-ai" onClick={cancel}>
          取消请求
        </button>
      )}
      <p className="ai-privacy">
        <ShieldCheck size={14} />
        整理目标、表名、列名与汇总统计经本站服务转发至
        DeepSeek，不发送表格原始行；密钥不持久保存。
      </p>
      <details className="summary-details">
        <summary>查看将发送的数据概况</summary>
        <pre>{JSON.stringify(datasets.map(profile), null, 2)}</pre>
      </details>
      {message && (
        <div className="ai-message" role="status">
          {message}
        </div>
      )}
      {proposal && (
        <div className="proposal">
          <div className="proposal-title">
            <Check size={17} />
            <strong>草案已生成，尚未执行</strong>
          </div>
          <p>{proposal.explanation}</p>
          <div className="proposal-facts">
            <span>
              主表：{datasets.find((d) => d.id === proposal.plan.base)?.name}
            </span>
            <span>{proposal.plan.joins.length} 次合并</span>
            {proposal.usage !== undefined && (
              <span>本次使用 {proposal.usage.toLocaleString()} tokens</span>
            )}
          </div>
          {proposal.questions.length > 0 && (
            <div className="proposal-questions">
              <strong>需要你核对</strong>
              {proposal.questions.map((q, i) => (
                <p key={i}>{q}</p>
              ))}
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => {
              const p = proposal.plan;
              onApply(p);
              setMessage(
                "草案已填入处理方案。请逐项核对，然后运行整理与检查。",
              );
            }}
          >
            填入方案，逐项核对
          </Button>
        </div>
      )}
      <div className="agent-boundary">
        <h3>这份工具会坚持</h3>
        <p>
          <Check size={15} />
          合并关系不符时停止
        </p>
        <p>
          <Check size={15} />
          结果记录可以追溯来源
        </p>
        <p>
          <Check size={15} />
          不凭空补全缺失和统计口径
        </p>
      </div>
      <div className="quick-summary">
        <span>当前工作区</span>
        <strong>
          {datasets.reduce((n, d) => n + d.rows.length, 0).toLocaleString()}
          <small>条原始记录</small>
        </strong>
        <div>
          <span>{datasets.length} 张数据表</span>
          <span>{plan.joins.length} 次计划合并</span>
        </div>
      </div>
    </aside>
  );
}
