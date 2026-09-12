import {
  AGENT_SYSTEM,
  proposalSchema,
  requestSchema,
  validateImportedPlan,
} from "@/lib/agent";
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
) {
  if (!stream) throw new Error("empty");
  const reader = stream.getReader();
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error("size");
      }
      text += decoder.decode(r.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: "请求来源无效。" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "请使用 JSON 请求。" }, 415);
  let body: unknown;
  try {
    body = JSON.parse(await readLimited(request.body, 150000));
  } catch {
    return json({ error: "请求无效或过大。" }, 400);
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success)
    return json({ error: "目标、数据概况或密钥格式无效。请检查后重试。" }, 400);
  const { apiKey, goal, profiles, currentPlan } = parsed.data;
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length)
    return json({ error: "数据表标识重复。" }, 400);
  const messages: { role: string; content: string }[] = [
    { role: "system", content: AGENT_SYSTEM },
    {
      role: "user",
      content: JSON.stringify({
        goal,
        profiles,
        currentPlan,
        outputExample: {
          plan: currentPlan,
          explanation: "拟定待核对的处理方案。",
          questions: [],
        },
      }),
    },
  ];
  const deadline = AbortSignal.timeout(55000),
    signal = AbortSignal.any([deadline, request.signal]);
  let tokens = 0;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-flash",
          messages,
          stream: false,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 5000,
        }),
        signal,
      });
      if (!r.ok) {
        await r.body?.cancel();
        const errors: Record<number, string> = {
          401: "DeepSeek 密钥无效，请检查后重试。",
          402: "DeepSeek 账户额度不足，请在提供方账户中查看。",
          429: "DeepSeek 请求过于频繁，请稍后重试。",
        };
        return json(
          {
            error: errors[r.status] ?? "DeepSeek 服务暂时不可用，请稍后重试。",
          },
          r.status === 401 || r.status === 402 ? 400 : 502,
        );
      }
      const data = JSON.parse(await readLimited(r.body, 300000));
      const choice = data.choices?.[0];
      tokens += Number.isSafeInteger(data.usage?.total_tokens)
        ? data.usage.total_tokens
        : 0;
      if (
        choice?.finish_reason !== "stop" ||
        typeof choice.message?.content !== "string" ||
        !choice.message.content.trim()
      )
        return json(
          {
            error:
              "模型返回了不完整或空白方案，本次未应用任何修改。请缩小目标后重试。",
          },
          502,
        );
      try {
        const p = proposalSchema.parse(JSON.parse(choice.message.content));
        const plan = validateImportedPlan(p.plan, profiles);
        return json({
          ...p,
          plan,
          usage: tokens,
          model: "deepseek-flash",
          attempts: attempt + 1,
        });
      } catch {
        if (attempt === 1)
          return json(
            {
              error:
                "模型方案未通过结构或字段检查，本次未应用任何修改。可以改用手动配置。",
            },
            502,
          );
        messages.push(
          {
            role: "assistant",
            content: choice.message.content.slice(0, 30000),
          },
          {
            role: "user",
            content:
              "方案未通过结构或字段引用检查。请核对所有必填字段、现有列名、合并顺序与上方 JSON 示例；只返回符合结构的修正 JSON。不得添加未知操作。",
          },
        );
      }
    }
  } catch {
    return json(
      {
        error: signal.aborted
          ? "AI 请求已取消或超时，本次未应用任何修改。"
          : "无法完成 AI 请求，请稍后重试或使用手动方案。",
      },
      502,
    );
  }
  return json({ error: "未得到有效方案。" }, 502);
}
