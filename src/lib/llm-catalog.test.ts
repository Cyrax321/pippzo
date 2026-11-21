import { describe, it, expect } from "vitest";
import {
  LLM_CATALOG,
  DEFAULT_MODEL_ID,
  catalogProvider,
  modelLabel,
  needsBaseUrl,
} from "./llm-catalog";

describe("llm-catalog", () => {
  it("includes all requested custom and open providers alongside core providers", () => {
    const values = LLM_CATALOG.map((p) => p.value);
    expect(values).toContain("openai");
    expect(values).toContain("anthropic");
    expect(values).toContain("google");
    expect(values).toContain("azure");
    expect(values).toContain("deepseek");
    expect(values).toContain("groq");
    expect(values).toContain("openrouter");
    expect(values).toContain("mistral");
    expect(values).toContain("perplexity");
    expect(values).toContain("ollama");
    expect(values).toContain("custom");
  });

  it("marks custom, ollama, and azure as requiring a base URL", () => {
    expect(needsBaseUrl("custom")).toBe(true);
    expect(needsBaseUrl("ollama")).toBe(true);
    expect(needsBaseUrl("azure")).toBe(true);
    expect(needsBaseUrl("deepseek")).toBe(false);
    expect(needsBaseUrl("groq")).toBe(false);
  });

  it("returns defaults for custom and third-party models", () => {
    expect(DEFAULT_MODEL_ID.deepseek).toBe("deepseek-chat");
    expect(DEFAULT_MODEL_ID.groq).toBe("llama-3.3-70b-versatile");
    expect(DEFAULT_MODEL_ID.ollama).toBe("llama3.2");
  });

  it("correctly resolves custom provider info", () => {
    const custom = catalogProvider("custom");
    expect(custom.label).toContain("Custom");
    expect(custom.freeformModel).toBe(true);
    expect(custom.requiresBaseUrl).toBe(true);
  });

  it("resolves model labels properly", () => {
    expect(modelLabel("deepseek", "deepseek-chat")).toContain("DeepSeek V3");
    expect(modelLabel("custom", "my-custom-model-id")).toBe("my-custom-model-id");
  });
});
