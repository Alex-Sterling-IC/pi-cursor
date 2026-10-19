import { describe, expect, it } from "vitest";
import type { CursorParameterizedModel } from "../src/client/cursor-wire.js";
import {
  augmentCursorModels,
  modelsFromParameterizedMetadata,
  optimizeForIdPart,
  optimizeForLabel,
} from "../src/models/parameterized.js";
import {
  applyRawCursorModelId,
  buildRawModelLookup,
  processModels,
} from "../src/models/processing.js";
import type { CursorModel } from "../src/stream/model-discovery.js";

const autoSmart: CursorParameterizedModel = {
  name: "auto-smart",
  clientDisplayName: "Auto",
  serverModelName: "auto-smart",
  supportsImages: true,
  supportsMaxMode: true,
  supportsNonMaxMode: true,
  variants: [
    {
      parameters: [{ id: "optimize_for", value: "intelligence" }],
      isMaxMode: false,
      displayName: "Auto Intelligence",
      isDefaultMaxConfig: false,
      isDefaultNonMaxConfig: false,
    },
    {
      parameters: [{ id: "optimize_for", value: "balanced" }],
      isMaxMode: false,
      displayName: "Auto Balance",
      isDefaultMaxConfig: true,
      isDefaultNonMaxConfig: true,
    },
    {
      parameters: [{ id: "optimize_for", value: "cost" }],
      isMaxMode: false,
      displayName: "Auto Cost",
      isDefaultMaxConfig: false,
      isDefaultNonMaxConfig: false,
    },
  ],
};

function raw(id: string, name: string): CursorModel {
  return { id, name, reasoning: false, contextWindow: 200_000, maxTokens: 64_000 };
}

describe("optimize_for helpers", () => {
  it("maps Cursor Auto labels and id suffixes", () => {
    expect(optimizeForIdPart("balanced")).toBe("-balanced");
    expect(optimizeForLabel("balanced")).toBe("Balance");
    expect(optimizeForLabel("intelligence")).toBe("Intelligence");
    expect(optimizeForLabel("cost")).toBe("Cost");
    expect(optimizeForIdPart(undefined)).toBe("");
    expect(optimizeForLabel(undefined)).toBeUndefined();
  });
});

describe("auto-smart optimize_for picker aliases", () => {
  it("emits distinct Auto Cost / Balance / Intelligence rows with wire parameters", () => {
    const rows = modelsFromParameterizedMetadata([autoSmart]);
    const byId = new Map(rows.map((model) => [model.id, model]));

    expect(byId.get("auto-smart-cost")).toMatchObject({
      name: "Auto Cost",
      requestedModelId: "auto-smart",
      parameters: [{ id: "optimize_for", value: "cost" }],
      requestedMaxMode: false,
    });
    expect(byId.get("auto-smart-balanced")).toMatchObject({
      name: "Auto Balance",
      requestedModelId: "auto-smart",
      parameters: [{ id: "optimize_for", value: "balanced" }],
      requestedMaxMode: false,
    });
    expect(byId.get("auto-smart-intelligence")).toMatchObject({
      name: "Auto Intelligence",
      requestedModelId: "auto-smart",
      parameters: [{ id: "optimize_for", value: "intelligence" }],
      requestedMaxMode: false,
    });

    // supportsMaxMode synthesizes explicit Max Mode twins.
    expect(byId.get("auto-smart-cost-max-mode")).toMatchObject({
      name: "Auto Cost Max Mode",
      requestedModelId: "auto-smart",
      parameters: [{ id: "optimize_for", value: "cost" }],
      requestedMaxMode: true,
    });
    expect(byId.get("auto-smart-balanced-max-mode")?.parameters).toEqual([
      { id: "optimize_for", value: "balanced" },
    ]);
    expect(byId.get("auto-smart-intelligence-max-mode")?.parameters).toEqual([
      { id: "optimize_for", value: "intelligence" },
    ]);
  });

  it("keeps aliases selectable alongside the bare Auto catalog row", () => {
    const augmented = augmentCursorModels([raw("default", "Auto")], [autoSmart]);
    const ids = new Set(augmented.map((model) => model.id));

    expect(ids.has("auto")).toBe(true);
    expect(ids.has("auto-smart-cost")).toBe(true);
    expect(ids.has("auto-smart-balanced")).toBe(true);
    expect(ids.has("auto-smart-intelligence")).toBe(true);

    const processed = processModels(augmented);
    expect(processed.find((model) => model.id === "auto-smart-balanced")).toMatchObject({
      supportsEffort: false,
      parameters: [{ id: "optimize_for", value: "balanced" }],
    });
    expect(processed.find((model) => model.id === "auto-smart-cost")?.supportsEffort).toBe(false);
    expect(processed.find((model) => model.id === "auto-smart-intelligence")?.supportsEffort).toBe(
      false,
    );
  });

  it("routes picker selection onto requestedModel parameters", () => {
    const processed = processModels(augmentedModels());
    const lookup = buildRawModelLookup(processed);
    const payload: Record<string, unknown> = {
      model: "auto-smart-intelligence",
    };
    applyRawCursorModelId(payload, lookup);

    expect(payload.cursor_model_id).toBe("auto-smart");
    expect(payload.cursor_model_parameters).toEqual([
      { id: "optimize_for", value: "intelligence" },
    ]);
  });
});

function augmentedModels(): CursorModel[] {
  return augmentCursorModels([raw("default", "Auto")], [autoSmart]);
}
