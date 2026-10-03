import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { AgentManager } from "../src/agent-manager.js";
import type { AgentRecord, WidgetMode } from "../src/types.js";
import { AgentWidget, type UICtx } from "../src/ui/agent-widget.js";
import type { WorkflowAgentEntry } from "../src/workflow/progress.js";
import { createWorkflowTask, updateWorkflowProgressBatch, type WorkflowTask } from "../src/workflow/task.js";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const task = (id = "wf_audit") => createWorkflowTask({ id, script: "", meta: { name: id, description: "Audit" } });
const record = (id: string, workflowId?: string): AgentRecord => ({
  id, type: "general-purpose", description: `${id} description`, status: "running", isBackground: true,
  startedAt: Date.now(), toolUses: 0, lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
  compactionCount: 0, workflowId,
});

function harness(tasks: WorkflowTask[], agents: AgentRecord[] = [], mode: WidgetMode = "background") {
  let factory: Exclude<Parameters<UICtx["setWidget"]>[1], undefined> | undefined;
  const ui = {
    setWidget: vi.fn<UICtx["setWidget"]>((_key, content) => { factory = content; }),
    setStatus: vi.fn(), onTerminalInput: vi.fn(),
  };
  const tui = { terminal: { columns: 200 }, requestRender: vi.fn() };
  const widget = new AgentWidget({ listAgents: () => agents } as unknown as AgentManager,
    new Map(), () => mode, undefined, undefined, () => tasks);
  widget.setUICtx(ui);
  widget.update();
  const component = factory?.(tui, theme);
  return { widget, ui, tui, render: () => component?.render() ?? [] };
}

describe("passive workflow widget", () => {
  it("retains the workflow summary when its child agents are filtered", () => {
    const run = task();
    const h = harness([run], [record("child", run.id)]);
    expect(h.render().join("\n")).toContain("workflow  wf_audit");
    expect(h.render().join("\n")).not.toContain("child description");
    expect(h.ui.setWidget).toHaveBeenCalledWith("agents", expect.any(Function), { placement: "aboveEditor" });
    h.widget.dispose();
    expect(h.ui.onTerminalInput).not.toHaveBeenCalled();
    expect(h.ui.setStatus).not.toHaveBeenCalled();
  });

  it("nests two children under their workflow without duplicate manager rows", () => {
    const run = task();
    updateWorkflowProgressBatch(run, [
      { type: "workflow_agent", index: 0, label: "scan", state: "progress", recordId: "child", toolCalls: 2, tokens: 1300, durationMs: 2500 },
      { type: "workflow_agent", index: 1, label: "audit", state: "start", queuedAt: 100 },
    ]);
    const h = harness([run], [record("child", run.id)]);
    const lines = h.render();
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^└─ .*workflow {2}wf_audit .*0\/2 completed/);
    expect(lines[2]).toBe("   ├─ scan · running · 2 tool calls · 1.3k token · 3s");
    expect(lines[3]).toBe("   └─ audit · queued");
    expect(lines.join("\n")).not.toContain("child description");
    h.widget.dispose();
  });

  it("keeps multiline labels, errors and previews on one bounded child line", () => {
    const run = task();
    updateWorkflowProgressBatch(run, [
      { type: "workflow_agent", index: 0, label: "\n  label\r\nextra label", state: "error", error: "\r failure\rextra error" },
      { type: "workflow_agent", index: 1, label: "preview", state: "progress", resultPreview: "\n latest\nextra preview" },
    ]);
    const h = harness([run]);
    expect(h.render()[2]).toBe("   ├─ label · failed · failure");
    expect(h.render()[3]).toBe("   └─ preview · running · latest");
    expect(h.render().join("\n")).not.toContain("extra");
    h.tui.terminal.columns = 18;
    const lines = h.render();
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).not.toMatch(/[\r\n]/);
      expect(visibleWidth(line)).toBeLessThanOrEqual(18);
    }
    expect(lines[2]).toMatch(/^ {3}├─/);
    expect(lines[3]).toMatch(/^ {3}└─/);
    h.widget.dispose();
  });

  it("groups multiple workflow trees with the final root's continuation closed", () => {
    const runs = [task("wf_first"), task("wf_last")];
    for (const run of runs) updateWorkflowProgressBatch(run, [
      { type: "workflow_agent", index: 0, label: `${run.id} child`, state: "done", cached: true },
    ]);
    const h = harness(runs);
    const lines = h.render();
    expect(lines[1]).toMatch(/^├─ .*workflow {2}wf_first/);
    expect(lines[2]).toBe("│  └─ wf_first child · done (cached)");
    expect(lines[3]).toMatch(/^└─ .*workflow {2}wf_last/);
    expect(lines[4]).toBe("   └─ wf_last child · done (cached)");
    h.widget.dispose();
  });

  it("derives every child display state from progress even without manager records", () => {
    const run = task();
    const entries: WorkflowAgentEntry[] = [
      { type: "workflow_agent", index: 0, label: "waiting", state: "start", queuedAt: 100 },
      { type: "workflow_agent", index: 1, label: "working", state: "progress", resultPreview: "latest output\nsecond line" },
      { type: "workflow_agent", index: 2, label: "success", state: "done" },
      { type: "workflow_agent", index: 3, label: "failure", state: "error", error: "broken" },
      { type: "workflow_agent", index: 4, label: "skip", state: "error", skipped: true },
      { type: "workflow_agent", index: 5, label: "block", state: "error", blocked: true },
      { type: "workflow_agent", index: 6, label: "replay", state: "done", cached: true },
    ];
    updateWorkflowProgressBatch(run, entries);
    const h = harness([run]);
    const output = h.render().join("\n");
    for (const text of ["waiting · queued", "working · running · latest output", "success · done",
      "failure · failed · broken", "skip · skipped", "block · blocked", "replay · done (cached)"]) {
      expect(output).toContain(text);
    }
    expect(output).not.toContain("second line");
    run.status = "paused";
    expect(h.render().join("\n")).toContain("working · running");
    run.status = "killed";
    expect(h.render().join("\n")).toContain("waiting · interrupted");
    expect(h.render().join("\n")).toContain("working · interrupted");
    expect(h.render().join("\n")).toContain("workflow  wf_audit");
    h.widget.dispose();
  });

  it("reads live progress without replacing the registered component", () => {
    const run = task();
    const h = harness([run]);
    expect(h.render().join("\n")).toContain("0/0 completed");
    updateWorkflowProgressBatch(run, [
      { type: "workflow_agent", index: 0, label: "scan", state: "done", tokens: 2600 },
      { type: "workflow_agent", index: 1, label: "audit", state: "progress" },
      { type: "workflow_log", message: "auditing routes" },
    ]);
    h.widget.update();
    const output = h.render().join("\n");
    expect(output).toContain("1/2 completed");
    expect(output).toContain("2.6k token");
    expect(output).toContain("auditing routes");
    expect(output).toContain("scan · done · 2.6k token");
    expect(output).toContain("audit · running");
    updateWorkflowProgressBatch(run, [
      { type: "workflow_agent", index: 1, label: "audit", state: "done", tokens: 100, toolCalls: 1 },
    ]);
    const updated = h.render().join("\n");
    expect(updated).toContain("2/2 completed");
    expect(updated).toContain("audit · done · 1 tool call · 100 token");
    expect(updated).not.toContain("└─ audit · running");
    expect(h.render().filter(line => line.includes("└─ audit ·"))).toHaveLength(1);
    expect(h.tui.requestRender).toHaveBeenCalled();
    expect(h.ui.setWidget).toHaveBeenCalledTimes(1);
    h.widget.dispose();
  });

  it.each(["completed", "failed", "killed", "paused"] as const)("shows the %s state", status => {
    const run = task();
    run.status = status;
    if (status === "failed") run.error = "script failed";
    const h = harness([run]);
    const output = h.render().join("\n");
    expect(output).toContain(status);
    expect(output).toContain(status === "completed" ? "✓" : status === "failed" ? "✗" : status === "killed" ? "■" : "Ⅱ");
    if (status === "failed") expect(output).toContain("script failed");
    h.widget.dispose();
  });

  it("shares the line cap with agents and accounts for every hidden workflow", () => {
    for (const workflowCount of [1, 5, 15]) {
      const tasks = Array.from({ length: workflowCount }, (_, i) => task(`wf_${i}`));
      const agents = Array.from({ length: 6 }, (_, i) => record(`run${i}`));
      agents.push({ ...record("queued"), status: "queued" });
      const h = harness(tasks, agents);
      const lines = h.render();
      const output = lines.join("\n");
      expect(lines.length).toBeLessThanOrEqual(12);
      expect(output).toContain("wf_0");
      expect(output).toContain("1 queued");
      if (workflowCount === 1) expect(output).toContain("run0 description");
      const hiddenWorkflows = tasks.filter(run => !output.includes(`workflow  ${run.id} `)).length;
      const hiddenAgents = agents.filter(agent => agent.status === "running" && !output.includes(agent.description)).length;
      expect(Number(/\+(\d+) more/.exec(output)?.[1])).toBe(hiddenWorkflows + hiddenAgents);
      h.tui.terminal.columns = 20;
      for (const line of h.render()) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
      h.widget.dispose();
    }
  });

  it("counts hidden workflow children separately and prioritizes live rows within the shared cap", () => {
    const runs = [task("wf_first"), task("wf_second")];
    for (const run of runs) updateWorkflowProgressBatch(run, Array.from({ length: 8 }, (_, index) => ({
      type: "workflow_agent" as const, index, label: `${run.id}-child-${index}`,
      state: index < 6 ? "done" as const : "start" as const,
      ...(index === 6 ? { queuedAt: 100 } : {}),
    })));
    const agents = [record("standalone"), { ...record("q"), status: "queued" as const }];
    const h = harness(runs, agents);
    const lines = h.render();
    const output = lines.join("\n");
    expect(lines).toHaveLength(12);
    expect(output).toContain("standalone description");
    expect(output).toContain("1 queued");
    for (const run of runs) {
      const headerIndex = lines.findIndex(line => line.includes(`workflow  ${run.id} `));
      expect(headerIndex).toBeGreaterThan(0);
      for (const index of [6, 7]) {
        const childIndex = lines.findIndex(line => line.includes(`${run.id}-child-${index} ·`));
        expect(childIndex).toBeGreaterThan(headerIndex);
        const nextHeaderIndex = lines.findIndex((line, i) => i > headerIndex && line.includes("workflow  "));
        if (nextHeaderIndex !== -1) expect(childIndex).toBeLessThan(nextHeaderIndex);
      }
    }
    const shown = lines.filter(line => line.includes("-child-")).length;
    expect(output).toContain(`+${16 - shown} more (${16 - shown} workflow agents)`);
    h.tui.terminal.columns = 24;
    for (const line of h.render()) expect(visibleWidth(line)).toBeLessThanOrEqual(24);
    h.widget.dispose();
  });

  it("never renders children of hidden workflow headers and includes them in overflow", () => {
    const runs = Array.from({ length: 12 }, (_, index) => task(`wf_${index}`));
    for (const run of runs) updateWorkflowProgressBatch(run, [
      { type: "workflow_agent", index: 0, label: `${run.id}-child`, state: "progress" },
    ]);
    const h = harness(runs, [{ ...record("q"), status: "queued" }]);
    const output = h.render().join("\n");
    expect(output).not.toContain("-child ·");
    expect(output).toContain("+15 more (3 workflows, 12 workflow agents)");
    expect(output).toContain("1 queued");
    expect(h.render()).toHaveLength(12);
    h.widget.dispose();
  });

  it("prioritizes live work over completed workflows", () => {
    const finished = Array.from({ length: 12 }, (_, i) => {
      const run = task(`wf_finished_${i}`);
      run.status = "completed";
      return run;
    });
    const live = task("wf_live");
    updateWorkflowProgressBatch(live, [
      { type: "workflow_agent", index: 0, label: "live-child", state: "progress" },
      { type: "workflow_agent", index: 1, label: "queued-child", state: "start", queuedAt: 100 },
    ]);
    const h = harness([...finished, live], [record("standalone"), { ...record("q"), status: "queued" }]);
    const output = h.render().join("\n");
    expect(output).toContain("workflow  wf_live");
    expect(output).toContain("live-child · running");
    expect(output).toContain("queued-child · queued");
    expect(output).toContain("standalone description");
    expect(output).toContain("1 queued");
    expect(h.render().length).toBeLessThanOrEqual(12);
    h.widget.dispose();
  });

  it("ages failed workflows and resets linger when a task runs again", () => {
    const run = task();
    run.status = "failed";
    const h = harness([run]);
    h.widget.markFinished(run.id);
    h.widget.onTurnStart();
    expect(h.render().join("\n")).toContain("wf_audit");
    h.widget.onTurnStart();
    expect(h.ui.setWidget).toHaveBeenLastCalledWith("agents", undefined);
    run.status = "running";
    h.widget.markRunning(run.id);
    h.widget.update();
    run.status = "completed";
    h.widget.markFinished(run.id);
    h.widget.update();
    expect(h.render().join("\n")).toContain("completed");
    h.widget.dispose();
  });

  it("hides workflows in off mode and ages terminal runs like agents", () => {
    const run = task();
    updateWorkflowProgressBatch(run, [{ type: "workflow_agent", index: 0, label: "hidden", state: "progress" }]);
    const off = harness([run], [], "off");
    expect(off.ui.setWidget).not.toHaveBeenCalled();
    off.widget.dispose();
    run.status = "completed";
    const h = harness([run]);
    h.widget.markFinished(run.id);
    h.widget.onTurnStart();
    expect(h.ui.setWidget).toHaveBeenLastCalledWith("agents", undefined);
    h.widget.dispose();
  });
});
