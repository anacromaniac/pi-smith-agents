/** Real get_subagent_result wiring: pending reads never wait or consume results. */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agent-runner.js", async () => {
  const actual = await vi.importActual<typeof import("../src/agent-runner.js")>("../src/agent-runner.js");
  return { ...actual, runAgent: vi.fn() };
});

import { runAgent } from "../src/agent-runner.js";
import subagentsExtension from "../src/index.js";
import type { AgentRecord } from "../src/types.js";

function makePi() {
  const tools = new Map<string, any>();
  const lifecycle = new Map<string, any>();
  const pi = {
    registerMessageRenderer: vi.fn(),
    registerTool: vi.fn((t: any) => tools.set(t.name, t)),
    registerCommand: vi.fn(),
    registerEntryRenderer: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn(),
    on: vi.fn((event: string, handler: any) => lifecycle.set(event, handler)),
    events: { emit: vi.fn(), on: vi.fn(() => vi.fn()) },
    appendEntry: vi.fn(),
    sendMessage: vi.fn(),
  } as any;
  return { pi, tools, lifecycle };
}

function ctx() {
  return {
    hasUI: false,
    ui: { setStatus: vi.fn(), setWidget: vi.fn(), notify: vi.fn() },
    cwd: process.cwd(),
    model: undefined,
    modelRegistry: { find: vi.fn(), getAvailable: vi.fn(() => []) },
    sessionManager: { getSessionId: vi.fn(() => "s1"), getBranch: vi.fn(() => []) },
    getSystemPrompt: vi.fn(() => "parent"),
  } as any;
}

const textOf = (r: any): string => r.content[0].text;
const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

function deferredRuns() {
  const resolvers: Array<() => void> = [];
  vi.mocked(runAgent).mockImplementation(() => new Promise((resolve) => {
    resolvers.push(() => resolve({
      responseText: "THE-RESULT-PAYLOAD",
      session: { dispose: vi.fn() } as any,
      aborted: false,
      steered: false,
    }));
  }));
  return resolvers;
}

async function spawnBackground(tools: Map<string, any>): Promise<{ id: string; queued: boolean }> {
  const r = await tools.get("Agent").execute(
    "tc-spawn",
    { prompt: "go", description: "nonblocking result test", subagent_type: "general-purpose", run_in_background: true },
    undefined, undefined, ctx(),
  );
  return { id: /Agent ID: (\S+)/.exec(textOf(r))![1], queued: textOf(r).includes("queued in background") };
}

function getRecord(id: string): AgentRecord {
  const registry = Reflect.get(globalThis, Symbol.for("pi-subagents:manager")) as {
    getRecord(id: string): AgentRecord;
  };
  return registry.getRecord(id);
}

async function drainRuns(resolvers: Array<() => void>): Promise<void> {
  while (resolvers.length > 0) {
    for (const resolve of resolvers.splice(0)) resolve();
    await flush();
  }
}

afterEach(() => vi.useRealTimers());

describe("get_subagent_result is always nonblocking", () => {
  it.each(["running", "queued"] as const)("returns %s immediately and preserves eventual notification", async (status) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const { pi, tools, lifecycle } = makePi();
    subagentsExtension(pi);
    const resolvers = deferredRuns();
    try {
      let spawned = await spawnBackground(tools);
      if (status === "queued") {
        for (let i = 0; i < 20 && !spawned.queued; i++) spawned = await spawnBackground(tools);
        expect(spawned.queued).toBe(true);
      }
      const record = getRecord(spawned.id);
      expect(record.status).toBe(status);
      const getResult = tools.get("get_subagent_result");
      expect(getResult.parameters.properties).not.toHaveProperty("wait");
      const promiseRead = vi.fn(() => { throw new Error("Result retrieval must not read the pending promise"); });
      const pendingPromise = record.promise;
      Object.defineProperty(record, "promise", { configurable: true, get: promiseRead });
      const result = await getResult.execute("tc-status", { agent_id: spawned.id }, undefined, undefined, ctx());
      Object.defineProperty(record, "promise", { configurable: true, writable: true, value: pendingPromise });

      expect(textOf(result)).toContain(`Status: ${status}`);
      expect(textOf(result)).toContain("Await its automatic completion notification");
      expect(textOf(result)).not.toMatch(/wait:|check back|No output/);
      expect(promiseRead).not.toHaveBeenCalled();
      expect(record.resultConsumed).not.toBe(true);
      expect(record.status).toBe(status);

      await drainRuns(resolvers);
      await vi.advanceTimersByTimeAsync(500);
      expect(JSON.stringify(pi.sendMessage.mock.calls)).toContain(spawned.id);
      const completed = await getResult.execute("tc-result", { agent_id: spawned.id }, undefined, undefined, ctx());
      expect(textOf(completed)).toContain("THE-RESULT-PAYLOAD");
      expect(record.resultConsumed).toBe(true);
    } finally {
      await lifecycle.get("session_shutdown")?.();
    }
  });

  it.each(["id", "handle"])("consumes a terminal result by %s and cancels its held notification", async (reference) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const { pi, tools, lifecycle } = makePi();
    subagentsExtension(pi);
    const resolvers = deferredRuns();
    try {
      const { id } = await spawnBackground(tools);
      await drainRuns(resolvers);
      await vi.advanceTimersByTimeAsync(100);
      const agentReference = reference === "id" ? id : "general-purpose";
      const result = await tools.get("get_subagent_result").execute("tc-result", { agent_id: agentReference }, undefined, undefined, ctx());
      expect(textOf(result)).toContain("THE-RESULT-PAYLOAD");
      expect(getRecord(id).resultConsumed).toBe(true);
      await vi.advanceTimersByTimeAsync(500);
      expect(pi.sendMessage).not.toHaveBeenCalled();
    } finally {
      await lifecycle.get("session_shutdown")?.();
    }
  });
});
