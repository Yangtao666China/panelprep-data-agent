import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/plan/route";
import { validateImportedPlan } from "../lib/agent";
import { demoDatasets, demoPlan, profile } from "../lib/panelprep";
const data = () => ({
  apiKey: "sk-test-not-a-real-key",
  goal: "按地区年份合并，保留所有企业",
  profiles: demoDatasets().map(profile),
  currentPlan: demoPlan(),
});
const req = (body: unknown, origin = "http://local.test") =>
  new Request("http://local.test/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
const answer = (p: unknown = demoPlan()) => ({
  choices: [
    {
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          plan: p,
          explanation: "按现有字段拟定方案，待用户核对。",
          questions: [],
        }),
      },
    },
  ],
  usage: { total_tokens: 30 },
});
test("imported plan rejects arbitrary actions and unknown columns", () => {
  const p: any = demoPlan();
  p.execute = "delete";
  assert.throws(() => validateImportedPlan(p, demoDatasets().map(profile)));
  delete p.execute;
  p.joins[0].keys[0].right = "unknown";
  assert.throws(() => validateImportedPlan(p, demoDatasets().map(profile)));
});
test("AI endpoint rejects missing key and foreign origin without contacting provider", async () => {
  let calls = 0;
  const old = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("unexpected");
  };
  try {
    assert.equal((await POST(req({ ...data(), apiKey: "" }))).status, 400);
    assert.equal((await POST(req(data(), "https://foreign.test"))).status, 403);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = old;
  }
});
test("only metadata reaches fixed provider and validated draft returns", async () => {
  const old = globalThis.fetch;
  let sent: any;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "https://api.deepseek.com/chat/completions");
    sent = JSON.parse(String(init?.body));
    return Response.json(answer());
  };
  try {
    const r = await POST(req(data()));
    assert.equal(r.status, 200);
    const body: any = await r.json();
    assert.equal(body.attempts, 1);
    assert.equal(body.usage, 30);
    assert.equal(sent.model, "deepseek-flash");
    const user = JSON.parse(sent.messages[1].content);
    assert.ok(user.profiles);
    assert.equal(user.profiles[0].rows, 12);
    assert.equal(JSON.stringify(user).includes('"0001"'), false);
    assert.equal(JSON.stringify(user).includes("sk-test"), false);
  } finally {
    globalThis.fetch = old;
  }
});
test("invalid proposal gets at most one bounded correction", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json(answer({ version: 99 }));
  };
  try {
    const r = await POST(req(data()));
    assert.equal(r.status, 502);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = old;
  }
});
test("corrected proposal returns second attempt and total usage", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () =>
    Response.json(++calls === 1 ? answer({ version: 99 }) : answer());
  try {
    const r = await POST(req(data()));
    const body: any = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.attempts, 2);
    assert.equal(body.usage, 60);
  } finally {
    globalThis.fetch = old;
  }
});
test("truncation and empty model responses never appear as valid drafts", async () => {
  const old = globalThis.fetch;
  try {
    for (const result of [
      { choices: [{ finish_reason: "length", message: { content: "{}" } }] },
      { choices: [{ finish_reason: "stop", message: { content: "" } }] },
    ]) {
      globalThis.fetch = async () => Response.json(result);
      assert.equal((await POST(req(data()))).status, 502);
    }
  } finally {
    globalThis.fetch = old;
  }
});
test("provider errors cannot echo secrets or raw upstream bodies", async () => {
  const old = globalThis.fetch;
  try {
    for (const status of [401, 402, 429, 500]) {
      globalThis.fetch = async () =>
        new Response("secret-value-do-not-echo", { status });
      const r = await POST(req(data()));
      assert.equal((await r.text()).includes("secret-value"), false);
      assert.notEqual(r.status, 200);
    }
  } finally {
    globalThis.fetch = old;
  }
});
test("oversized request and invalid response JSON fail cleanly", async () => {
  assert.equal((await POST(req({ x: "a".repeat(160000) }))).status, 400);
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-json");
  try {
    assert.equal((await POST(req(data()))).status, 502);
  } finally {
    globalThis.fetch = old;
  }
});
