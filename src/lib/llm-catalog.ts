// Curated list of text models people can pick in Settings → Connections.
// Client-safe: no secrets, no server imports.

export type LlmProviderKindPublic =
  | "openai"
  | "anthropic"
  | "google"
  | "azure"
  | "deepseek"
  | "groq"
  | "openrouter"
  | "mistral"
  | "perplexity"
  | "ollama"
  | "custom";

export type CatalogModel = {
  id: string;
  label: string;
  hint: string;
};

export type CatalogProvider = {
  value: LlmProviderKindPublic;
  label: string;
  hint: string;
  keyHelp: string;
  models: CatalogModel[];
  /** Provider needs an explicit endpoint (Azure / Ollama / Custom endpoints). */
  requiresBaseUrl?: boolean;
  /** Model is typed, not picked — Azure deployment names and custom models are user-chosen. */
  freeformModel?: boolean;
  baseUrlHelp?: string;
  baseUrlPlaceholder?: string;
  modelHelp?: string;
};

export const LLM_CATALOG: CatalogProvider[] = [
  {
    value: "openai",
    label: "OpenAI",
    hint: "Chat completions on your own OpenAI account.",
    keyHelp: "platform.openai.com/api-keys — key starts with sk-",
    models: [
      {
        id: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        hint: "Balanced intelligence and cost. Recommended.",
      },
      { id: "gpt-5.5", label: "GPT-5.5", hint: "Top-tier reasoning for hard strategy work." },
      { id: "gpt-5.4", label: "GPT-5.4", hint: "More affordable, strong all-rounder." },
      {
        id: "gpt-5.4-mini",
        label: "GPT-5.4 mini",
        hint: "Fastest and cheapest for high-volume runs.",
      },
    ],
  },
  {
    value: "anthropic",
    label: "Anthropic (Claude)",
    hint: "Strong long-form writing and brand voice.",
    keyHelp: "console.anthropic.com/settings/keys",
    models: [
      {
        id: "claude-sonnet-5",
        label: "Claude Sonnet 5",
        hint: "Best balance of quality and speed.",
      },
      { id: "claude-opus-5", label: "Claude Opus 5", hint: "Deepest reasoning, highest cost." },
    ],
  },
  {
    value: "google",
    label: "Google Gemini",
    hint: "Multimodal: reads attached images and PDFs natively. Best value.",
    keyHelp: "aistudio.google.com/apikey",
    models: [
      {
        id: "gemini-3-flash-preview",
        label: "Gemini 3 Flash (preview)",
        hint: "Newest Flash generation.",
      },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Reliable everyday default." },
      {
        id: "gemini-2.5-flash-lite",
        label: "Gemini 2.5 Flash Lite",
        hint: "Cheapest, for simple tasks.",
      },
    ],
  },
  {
    value: "azure",
    label: "Azure OpenAI",
    hint: "Your own Azure OpenAI deployment. Needs the endpoint and the deployment name.",
    keyHelp: "Azure portal → your OpenAI resource → Keys and Endpoint",
    requiresBaseUrl: true,
    freeformModel: true,
    baseUrlHelp:
      "Must end at the deployment, with no trailing slash: https://<resource>.cognitiveservices.azure.com/openai/deployments/<deployment>. The app appends /chat/completions?api-version=2024-12-01-preview.",
    baseUrlPlaceholder:
      "https://my-resource.cognitiveservices.azure.com/openai/deployments/gpt-5.4",
    modelHelp: "Your Azure deployment name (not the underlying model name).",
    models: [],
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    hint: "High-intelligence V3 & R1 reasoning at disruptive low pricing.",
    keyHelp: "platform.deepseek.com/api_keys",
    models: [
      {
        id: "deepseek-chat",
        label: "DeepSeek V3 (Chat)",
        hint: "Extremely fast general writing and copywriting.",
      },
      {
        id: "deepseek-reasoner",
        label: "DeepSeek R1 (Reasoner)",
        hint: "Deep mathematical & logical chain-of-thought reasoning.",
      },
    ],
    baseUrlPlaceholder: "https://api.deepseek.com",
  },
  {
    value: "groq",
    label: "Groq (Ultra-Fast LPU)",
    hint: "Near-instant response times powered by Groq LPU inference.",
    keyHelp: "console.groq.com/keys",
    models: [
      {
        id: "llama-3.3-70b-versatile",
        label: "Llama 3.3 70B Versatile",
        hint: "Flagship open intelligence at lightning speed.",
      },
      {
        id: "llama-3.1-8b-instant",
        label: "Llama 3.1 8B Instant",
        hint: "Ultra-fast response for high-volume content.",
      },
      {
        id: "mixtral-8x7b-32768",
        label: "Mixtral 8x7B 32k",
        hint: "High quality MoE with extended context.",
      },
    ],
    baseUrlPlaceholder: "https://api.groq.com/openai/v1",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    hint: "Single unified API key for hundreds of AI models from multiple labs.",
    keyHelp: "openrouter.ai/keys",
    freeformModel: true,
    modelHelp: "Any model id from openrouter.ai (e.g. meta-llama/llama-3.3-70b-instruct or deepseek/deepseek-r1).",
    models: [
      {
        id: "meta-llama/llama-3.3-70b-instruct",
        label: "Llama 3.3 70B",
        hint: "Top open-source model.",
      },
      {
        id: "deepseek/deepseek-r1",
        label: "DeepSeek R1",
        hint: "SOTA reasoning engine.",
      },
      {
        id: "anthropic/claude-3.5-sonnet",
        label: "Claude 3.5 Sonnet",
        hint: "Anthropic via OpenRouter.",
      },
    ],
    baseUrlPlaceholder: "https://openrouter.ai/api/v1",
  },
  {
    value: "mistral",
    label: "Mistral AI",
    hint: "Flagship European intelligence models including Mistral Large and Small.",
    keyHelp: "console.mistral.ai/api-keys",
    models: [
      {
        id: "mistral-large-latest",
        label: "Mistral Large",
        hint: "Top-tier multilingual and analytical capabilities.",
      },
      {
        id: "mistral-small-latest",
        label: "Mistral Small",
        hint: "Fast, balanced, and cost-effective.",
      },
      {
        id: "codestral-latest",
        label: "Codestral",
        hint: "Specialized in code and structured JSON.",
      },
    ],
    baseUrlPlaceholder: "https://api.mistral.ai/v1",
  },
  {
    value: "perplexity",
    label: "Perplexity AI",
    hint: "Search-augmented generation and fresh web awareness via Sonar.",
    keyHelp: "perplexity.ai/settings/api",
    models: [
      {
        id: "sonar-pro",
        label: "Sonar Pro",
        hint: "Advanced search-grounded reasoning.",
      },
      {
        id: "sonar",
        label: "Sonar",
        hint: "Fast real-time web search chat model.",
      },
    ],
    baseUrlPlaceholder: "https://api.perplexity.ai",
  },
  {
    value: "ollama",
    label: "Ollama (Local / Self-Hosted)",
    hint: "Run open models locally on your GPU or private server with zero API fees.",
    keyHelp: "Enter any dummy string (e.g. 'ollama') if your instance has no auth.",
    requiresBaseUrl: true,
    freeformModel: true,
    baseUrlHelp: "Local default: http://localhost:11434/v1 (or your server's IP/domain).",
    baseUrlPlaceholder: "http://localhost:11434/v1",
    modelHelp: "Model tag pulled in Ollama (e.g. llama3.2, mistral, qwen2.5).",
    models: [],
  },
  {
    value: "custom",
    label: "Custom / Any OpenAI-Compatible API",
    hint: "Connect ANY other provider, self-hosted LLM, Together AI, vLLM, LM Studio, etc.",
    keyHelp: "API Key or Bearer Token for your custom endpoint.",
    requiresBaseUrl: true,
    freeformModel: true,
    baseUrlHelp: "Full Base URL (e.g. https://api.together.xyz/v1 or http://localhost:1234/v1).",
    baseUrlPlaceholder: "https://api.together.xyz/v1",
    modelHelp: "Model name/ID expected by your custom server.",
    models: [],
  },
];

export const DEFAULT_MODEL_ID: Record<LlmProviderKindPublic, string> = {
  openai: "gpt-5.6-terra",
  anthropic: "claude-sonnet-5",
  google: "gemini-2.5-flash",
  azure: "",
  deepseek: "deepseek-chat",
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct",
  mistral: "mistral-large-latest",
  perplexity: "sonar-pro",
  ollama: "llama3.2",
  custom: "",
};

export function catalogProvider(kind: LlmProviderKindPublic): CatalogProvider {
  return LLM_CATALOG.find((p) => p.value === kind) ?? LLM_CATALOG[0];
}

export function modelLabel(kind: string, id?: string | null): string {
  if (!id) return "provider default";
  const p = LLM_CATALOG.find((x) => x.value === kind);
  return p?.models.find((m) => m.id === id)?.label ?? id;
}

/** Providers that require an explicit endpoint. */
export function needsBaseUrl(kind: LlmProviderKindPublic): boolean {
  return !!catalogProvider(kind).requiresBaseUrl;
}
