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
import { applyNativeCursorRouting } from "../src/stream/pi-adapter.js";
import type { CursorModel } from "../src/stream/model-discovery.js";
import type { ChatCompletionRequest } from "../src/stream/types.js";

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

describe("auto-smart Shift+Tab optimize_for cycle", () => {
  it("collapses effort twins into unsuffixed auto-smart without removing aliases", () => {
    const processed = processModels(augmentedModels());
    const cycling = processed.find((model) => model.id === "auto-smart");

    expect(cycling).toMatchObject({
      name: "Auto",
      supportsEffort: true,
      requestedModelId: "auto-smart",
      effortMap: {
        off: null,
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: null,
        max: null,
      },
    });
    expect(cycling?.rawRoutingByEffort?.low?.parameters).toEqual([
      { id: "optimize_for", value: "cost" },
    ]);
    expect(cycling?.rawRoutingByEffort?.medium?.parameters).toEqual([
      { id: "optimize_for", value: "balanced" },
    ]);
    expect(cycling?.rawRoutingByEffort?.high?.parameters).toEqual([
      { id: "optimize_for", value: "intelligence" },
    ]);

    for (const id of ["auto-smart-cost", "auto-smart-balanced", "auto-smart-intelligence"]) {
      expect(processed.find((model) => model.id === id)?.supportsEffort).toBe(false);
    }
  });

  it("routes Shift+Tab levels onto optimize_for and defaults to Balance", () => {
    const lookup = buildRawModelLookup(processModels(augmentedModels()));

    const high: ChatCompletionRequest = {
      model: "auto-smart",
      messages: [],
      reasoning_effort: "high",
    };
    applyNativeCursorRouting(high, lookup);
    expect(high.cursor_model_id).toBe("auto-smart");
    expect(high.cursor_model_parameters).toEqual([{ id: "optimize_for", value: "intelligence" }]);

    const low: ChatCompletionRequest = {
      model: "auto-smart",
      messages: [],
      reasoning_effort: "low",
    };
    applyNativeCursorRouting(low, lookup);
    expect(low.cursor_model_parameters).toEqual([{ id: "optimize_for", value: "cost" }]);

    const untouched: ChatCompletionRequest = { model: "auto-smart", messages: [] };
    applyNativeCursorRouting(untouched, lookup);
    expect(untouched.cursor_model_parameters).toEqual([{ id: "optimize_for", value: "balanced" }]);
  });
});
