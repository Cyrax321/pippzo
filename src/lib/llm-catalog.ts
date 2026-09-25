// Curated list of text models people can pick in Settings → Connections.
// Client-safe: no secrets, no server imports.

export type LlmProviderKindPublic = "openai" | "anthropic" | "google" | "azure";

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
  /** Provider needs an explicit endpoint (Azure deployments are per-resource). */
  requiresBaseUrl?: boolean;
  /** Model is typed, not picked — Azure deployment names are user-chosen. */
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
];

export const DEFAULT_MODEL_ID: Record<LlmProviderKindPublic, string> = {
  openai: "gpt-5.6-terra",
  anthropic: "claude-sonnet-5",
  google: "gemini-2.5-flash",
  azure: "",
};

export function catalogProvider(kind: LlmProviderKindPublic): CatalogProvider {
  return LLM_CATALOG.find((p) => p.value === kind) ?? LLM_CATALOG[0];
}

export function modelLabel(kind: string, id?: string | null): string {
  if (!id) return "provider default";
  const p = LLM_CATALOG.find((x) => x.value === kind);
  return p?.models.find((m) => m.id === id)?.label ?? id;
}

/** Azure is the only kind where the deployment URL is not derivable from the key. */
export function needsBaseUrl(kind: LlmProviderKindPublic): boolean {
  return !!catalogProvider(kind).requiresBaseUrl;
}
