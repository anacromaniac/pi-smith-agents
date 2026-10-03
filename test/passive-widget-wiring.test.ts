import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/workflow/runtime.js", () => ({ runWorkflow: vi.fn() }));

import subagentsExtension from "../src/index.js";
import type { UICtx } from "../src/ui/agent-widget.js";
import { runWorkflow, type WorkflowRunResult } from "../src/workflow/runtime.js";
import { ctx, flush, type Hermetic, hermeticDir, makePi } from "./helpers/boot-extension.js";

const meta = { name: "audit", description: "Audit routes" };
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

describe("passive widget extension wiring", () => {
  let hermetic: Hermetic;
  beforeEach(() => { hermetic = hermeticDir({ settings: { schedulingEnabled: false } }); });
  afterEach(() => { hermetic.restore(); vi.resetAllMocks(); });

  it.each(["completed", "failed"] as const)("refreshes workflow progress and %s without terminal input or below-editor UI", async status => {
    const booted = makePi();
    subagentsExtension(booted.pi);
    let factory: Exclude<Parameters<UICtx["setWidget"]>[1], undefined> | undefined;
    const ui = {
      setWidget: vi.fn<UICtx["setWidget"]>((_key, content) => { factory = content; }),
      setStatus: vi.fn(), onTerminalInput: vi.fn(), notify: vi.fn(), addAutocompleteProvider: vi.fn(),
    };
    const context = ctx({ hasUI: true, ui });
    await booted.lifecycle.get("session_start")({}, context);
    await booted.lifecycle.get("tool_execution_start")({}, context);
    let finish: ((result: WorkflowRunResult) => void) | undefined;
    let progress: Parameters<typeof runWorkflow>[0]["onProgress"];
    vi.mocked(runWorkflow).mockImplementation(options => {
      progress = options.onProgress;
      return new Promise(resolve => { finish = resolve; });
    });
    const tui = { terminal: { columns: 200 }, requestRender: vi.fn() };
    try {
      await booted.tools.get("SubagentWorkflow").execute("tc", {
        script: 'export const meta = { name: "audit", description: "Audit routes" }; return 1;',
      }, undefined, undefined, context);
      const component = factory?.(tui, theme);
      expect(component?.render().join("\n")).toContain("workflow  audit");
      progress?.([
        { type: "workflow_agent", index: 0, label: "scan", state: "done", tokens: 1300 },
        { type: "workflow_log", message: "verified routes" },
      ]);
      expect(tui.requestRender).toHaveBeenCalled();
      expect(component?.render().join("\n")).toContain("1/1 completed");
      expect(component?.render().join("\n")).toContain("   └─ scan · done · 1.3k token");
      expect(component?.render().join("\n")).toContain("verified routes");
      finish?.({ status, meta, agentCount: 1, replayedCount: 0,
        ...(status === "failed" ? { error: "script failed" } : { value: 1 }) });
      await flush();
      expect(component?.render().join("\n")).toContain(status);
      if (status === "failed") expect(component?.render().join("\n")).toContain("script failed");
      expect(ui.onTerminalInput).not.toHaveBeenCalled();
      expect(ui.setStatus).not.toHaveBeenCalled();
      for (const [key, content, options] of ui.setWidget.mock.calls) {
        expect(key).toBe("agents");
        if (content) expect(options?.placement).toBe("aboveEditor");
      }
    } finally {
      await booted.lifecycle.get("session_shutdown")({}, context);
    }
    expect(ui.setWidget).toHaveBeenLastCalledWith("agents", undefined);
    expect(ui.onTerminalInput).not.toHaveBeenCalled();
    expect(ui.setStatus).not.toHaveBeenCalled();
  });
});
