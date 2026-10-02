import type { Api, Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENTS } from "../src/default-agents.js";
import { getGeneralPurposeModel, resolveGeneralPurposeModel, setGeneralPurposeModel } from "../src/general-purpose-model.js";

const model = { provider: "test", id: "configured" } as Model<Api>;
const registry = {
  find: vi.fn((provider: string, id: string) => provider === model.provider && id === model.id ? model : undefined),
  getAvailable: vi.fn(() => [model]),
};
const config = DEFAULT_AGENTS.get("general-purpose");

afterEach(() => {
  setGeneralPurposeModel(null);
  vi.clearAllMocks();
  registry.getAvailable.mockReturnValue([model]);
});

describe("configured general-purpose model", () => {
  it("inherits without a configured model", () => {
    expect(getGeneralPurposeModel()).toBeNull();
    expect(resolveGeneralPurposeModel(config, registry)).toBeUndefined();
    expect(registry.find).not.toHaveBeenCalled();
  });

  it("resolves an exact available provider/modelId", () => {
    setGeneralPurposeModel("test/configured");
    expect(getGeneralPurposeModel()).toBe("test/configured");
    expect(resolveGeneralPurposeModel(config, registry)).toBe(model);
  });

  it("does not apply to custom general-purpose overrides or other types", () => {
    setGeneralPurposeModel("test/missing");
    expect(resolveGeneralPurposeModel({ ...config!, isDefault: false }, registry)).toBeUndefined();
    expect(resolveGeneralPurposeModel({ ...config!, name: "custom" }, registry)).toBeUndefined();
    expect(resolveGeneralPurposeModel(undefined, registry)).toBeUndefined();
  });

  it("rejects an unknown model instead of inheriting", () => {
    setGeneralPurposeModel("test/missing");
    expect(() => resolveGeneralPurposeModel(config, registry)).toThrow('Configured generalPurposeModel is unavailable: "test/missing"');
  });

  it("rejects a registered model without available credentials", () => {
    setGeneralPurposeModel("test/configured");
    registry.getAvailable.mockReturnValue([]);
    expect(() => resolveGeneralPurposeModel(config, registry)).toThrow("unavailable");
    expect(registry.find).not.toHaveBeenCalled();
  });

  it("does not fuzzy-match or substitute providers", () => {
    for (const input of ["configured", "other/configured", "test/config", "test/", "/configured"]) {
      setGeneralPurposeModel(input);
      expect(() => resolveGeneralPurposeModel(config, registry)).toThrow("unavailable");
    }
  });

  it("clears a configured model", () => {
    setGeneralPurposeModel("test/configured");
    setGeneralPurposeModel(null);
    expect(resolveGeneralPurposeModel(config, registry)).toBeUndefined();
  });
});
