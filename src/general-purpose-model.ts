import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentConfig } from "./types.js";

let generalPurposeModel: string | null = null;

export function getGeneralPurposeModel(): string | null { return generalPurposeModel; }
export function setGeneralPurposeModel(model: string | null): void { generalPurposeModel = model; }

export function resolveGeneralPurposeModel(
  config: AgentConfig | undefined,
  registry: {
    find(provider: string, modelId: string): Model<Api> | undefined;
    getAvailable(): Model<Api>[];
  },
): Model<Api> | undefined {
  if (!config?.isDefault || config.name !== "general-purpose" || generalPurposeModel === null) return undefined;

  const separator = generalPurposeModel.indexOf("/");
  const provider = generalPurposeModel.slice(0, separator);
  const modelId = generalPurposeModel.slice(separator + 1);
  const available = registry.getAvailable();
  const model = separator > 0 && modelId.length > 0
    && available.some(entry => entry.provider === provider && entry.id === modelId)
    ? registry.find(provider, modelId)
    : undefined;
  if (!model) {
    throw new Error(`Configured generalPurposeModel is unavailable: "${generalPurposeModel}". Use an available provider/modelId or set generalPurposeModel to null to inherit the parent model.`);
  }
  return model;
}
