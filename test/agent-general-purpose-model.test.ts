import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "../src/agent-runner.js";
import { setDefaultsDisabled } from "../src/agent-types.js";
import { setGeneralPurposeModel } from "../src/general-purpose-model.js";
import subagentsExtension from "../src/index.js";
import { ctx, type Hermetic, hermeticDir, makePi, textOf } from "./helpers/boot-extension.js";

vi.mock("../src/agent-runner.js", async () => ({
  ...await vi.importActual<Record<string, unknown>>("../src/agent-runner.js"),
  runAgent: vi.fn(),
}));

const PARENT_MODEL = { provider: "test", id: "parent", name: "Parent" };
const CONFIGURED_MODEL = { provider: "test", id: "configured", name: "Configured" };
const AVAILABLE_MODELS = [PARENT_MODEL, CONFIGURED_MODEL];

let environment: Hermetic;
let shutdown: (() => Promise<void>) | undefined;

function boot(configuredModel: string | null, agentFiles?: Record<string, string>) {
  environment = hermeticDir({
    settings: {
      generalPurposeModel: configuredModel,
      outputTranscript: false,
      scopeModels: false,
      schedulingEnabled: false,
    },
    agentFiles,
  });
  const { pi, tools, lifecycle } = makePi();
  subagentsExtension(pi);
  shutdown = () => lifecycle.get("session_shutdown")({}, ctx());
  return tools.get("Agent");
}

beforeEach(() => {
  setDefaultsDisabled(false);
  setGeneralPurposeModel(null);
  vi.mocked(runAgent).mockReset();
  vi.mocked(runAgent).mockResolvedValue({
    responseText: "done",
    session: { dispose: vi.fn() } as never,
    aborted: false,
    steered: false,
  });
});

afterEach(async () => {
  await shutdown?.();
  shutdown = undefined;
  setGeneralPurposeModel(null);
  environment?.restore();
});

function parentContext() {
  return ctx({
    model: PARENT_MODEL,
    modelRegistry: {
      find: vi.fn((provider: string, modelId: string) =>
        AVAILABLE_MODELS.find(model => model.provider === provider && model.id === modelId)),
      getAvailable: vi.fn(() => AVAILABLE_MODELS),
    },
  });
}

describe("Agent general-purpose model default", () => {
  it.each([false, true])("passes the configured model to the runner (background: %s)", async (background) => {
    const tool = boot("test/configured");
    await tool.execute("configured", {
      prompt: "go",
      description: "configured model",
      subagent_type: "general-purpose",
      run_in_background: background,
    }, undefined, undefined, parentContext());

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runAgent).mock.calls[0][3].model).toBe(CONFIGURED_MODEL);
  });

  it("uses the configured model when an unknown type falls back to general-purpose", async () => {
    const tool = boot("test/configured");
    await tool.execute("fallback", {
      prompt: "go",
      description: "fallback model",
      subagent_type: "Explore",
      run_in_background: false,
    }, undefined, undefined, parentContext());

    expect(vi.mocked(runAgent).mock.calls[0]?.[1]).toBe("general-purpose");
    expect(vi.mocked(runAgent).mock.calls[0]?.[3].model).toBe(CONFIGURED_MODEL);
  });

  it("ignores the built-in default for a custom general-purpose without a model pin", async () => {
    const tool = boot("test/missing", {
      "general-purpose": "---\ndescription: Custom agent\n---\nCustom agent.\n",
    });
    await tool.execute("custom-inherit", {
      prompt: "go",
      description: "custom inheritance",
      subagent_type: "general-purpose",
      run_in_background: false,
    }, undefined, undefined, parentContext());

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runAgent).mock.calls[0][3].model).toBe(PARENT_MODEL);
  });

  it("returns an unavailable configured model error before spawning", async () => {
    const tool = boot("test/missing");
    const result = await tool.execute("unavailable", {
      prompt: "go",
      description: "unavailable model",
      subagent_type: "general-purpose",
    }, undefined, undefined, parentContext());

    expect(textOf(result)).toContain('Configured generalPurposeModel is unavailable: "test/missing"');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("lets an explicit call model bypass an unavailable configured default", async () => {
    const tool = boot("test/missing");
    await tool.execute("override", {
      prompt: "go",
      description: "explicit override",
      subagent_type: "general-purpose",
      model: "test/parent",
      run_in_background: false,
    }, undefined, undefined, parentContext());

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runAgent).mock.calls[0][3].model).toBe(PARENT_MODEL);
  });

  it("inherits the parent model when the configured default is null", async () => {
    const tool = boot(null);
    await tool.execute("inherit", {
      prompt: "go",
      description: "inherit model",
      subagent_type: "general-purpose",
      run_in_background: false,
    }, undefined, undefined, parentContext());

    expect(vi.mocked(runAgent).mock.calls[0][3].model).toBe(PARENT_MODEL);
  });

  it("does not evaluate the built-in default for a custom general-purpose model pin", async () => {
    const tool = boot("test/missing", {
      "general-purpose": "---\nmodel: test/parent\n---\nCustom agent.\n",
    });
    await tool.execute("custom", {
      prompt: "go",
      description: "custom model",
      subagent_type: "general-purpose",
      run_in_background: false,
    }, undefined, undefined, parentContext());

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runAgent).mock.calls[0][3].model).toBe(PARENT_MODEL);
  });
});
