// Playbooks — markdown instruction files that tell the agent how to use each
// capability well. Bundled defaults ship with the app; a workspace can
// override or disable any of them from Settings.
//
// Server-only. Markdown is imported with ?raw so it is bundled at build time
// (the Worker runtime has no filesystem to read from).

import operatorMd from "@/playbooks/operator.md?raw";
import bufferMd from "@/playbooks/buffer.md?raw";
import imageMd from "@/playbooks/image.md?raw";
import videoMd from "@/playbooks/video.md?raw";
import researchMd from "@/playbooks/research.md?raw";
import writingMd from "@/playbooks/writing.md?raw";
import learningMd from "@/playbooks/learning.md?raw";
import engagementMd from "@/playbooks/engagement.md?raw";

export type PlaybookRequirement =
  "buffer_connection" | "image_capability" | "video_capability" | "none";

export type Playbook = {
  slug: string;
  name: string;
  description: string;
  /** Topic tag used to decide whether to inject it. "always" is unconditional. */
  loadWhen: string;
  requires: PlaybookRequirement;
  body: string;
  /** True when the workspace replaced the bundled text. */
  overridden?: boolean;
  enabled?: boolean;
};

const RAW: Record<string, string> = {
  operator: operatorMd,
  writing: writingMd,
  learning: learningMd,
  buffer: bufferMd,
  image: imageMd,
  video: videoMd,
  research: researchMd,
  engagement: engagementMd,
};

function parse(slug: string, raw: string): Playbook {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const front = match?.[1] ?? "";
  const body = raw.slice(match?.[0].length ?? 0).trim();
  const field = (k: string) => {
    const m = new RegExp(`^${k}:\\s*(.+)$`, "m").exec(front);
    return m?.[1]?.trim() ?? "";
  };
  const requires = (field("requires") || "none") as PlaybookRequirement;
  return {
    slug,
    name: field("name") || slug,
    description: field("description"),
    loadWhen: field("load_when") || slug,
    requires,
    body,
  };
}

/** The bundled defaults, in injection order. */
export function bundledPlaybooks(): Playbook[] {
  return Object.entries(RAW).map(([slug, raw]) => parse(slug, raw));
}

export function bundledPlaybook(slug: string): Playbook | null {
  const raw = RAW[slug];
  return raw ? parse(slug, raw) : null;
}

type Client = { from: (t: string) => any };

type OverrideRow = { slug: string; body: string; enabled: boolean };

/** Bundled defaults merged with any workspace overrides. */
export async function loadPlaybooks(
  client: Client | null,
  workspaceId: string | null,
): Promise<Playbook[]> {
  const base = bundledPlaybooks();
  if (!client || !workspaceId) return base;
  try {
    const { data } = await client
      .from("workspace_playbooks")
      .select("slug,body,enabled")
      .eq("workspace_id", workspaceId);
    const rows = (data ?? []) as OverrideRow[];
    if (!rows.length) return base;
    const byslug = new Map(rows.map((r) => [r.slug, r]));
    return base.map((p) => {
      const o = byslug.get(p.slug);
      if (!o) return p;
      return {
        ...p,
        body: o.body?.trim() ? o.body.trim() : p.body,
        overridden: !!o.body?.trim(),
        enabled: o.enabled,
      };
    });
  } catch (e) {
    console.warn("[playbooks] override lookup failed", e instanceof Error ? e.message : e);
    return base;
  }
}

export type Capabilities = {
  buffer?: boolean;
  image?: boolean;
  video?: boolean;
};

const KNOWN_REQUIREMENTS: ReadonlySet<string> = new Set([
  "buffer_connection",
  "image_capability",
  "video_capability",
  "none",
]);

// Warn once per unknown `requires:` value, not once per render — a typo in
// front matter would otherwise spam the log on every prompt build.
const warnedRequirements = new Set<string>();

function satisfied(p: Playbook, caps?: Capabilities): boolean {
  // An unrecognised requirement is a front-matter typo. Gating it as
  // always-satisfied would silently ship instructions for a capability nobody
  // checked — fail closed instead, and say so once.
  if (!KNOWN_REQUIREMENTS.has(p.requires)) {
    if (!warnedRequirements.has(p.requires)) {
      warnedRequirements.add(p.requires);
      console.warn(
        `[playbooks] unknown requires value "${p.requires}" on playbook "${p.slug}" — treating it as NOT satisfied`,
      );
    }
    return false;
  }
  if (p.requires === "none") return true;
  // No caps object at all: the caller never claimed to gate (legacy narrow
  // server callers), so keep the historic include-everything behaviour.
  if (caps === undefined) return true;
  // A caps object was passed: it is authoritative. A requirement counts as
  // satisfied ONLY when its capability is explicitly true — undefined means
  // the caller did not verify it, and unverified must not read as available.
  if (p.requires === "buffer_connection") return caps.buffer === true;
  if (p.requires === "image_capability") return caps.image === true;
  return caps.video === true;
}

export type RenderOptions = {
  /**
   * Exact-topic mode: include ONLY playbooks whose loadWhen or slug is in
   * `topics`, skipping `load_when: always` playbooks. For narrow
   * single-purpose calls (an image prompt, a video brief) where concatenating
   * the operator manifest and writing rules would pollute the prompt.
   */
  exact?: boolean;
};

/**
 * Renders the relevant playbooks as a prompt block.
 * `topics` selects which non-always playbooks to include; pass "all" for the
 * full set (chat), or a narrow list for single-purpose calls.
 */
export function renderPlaybooks(
  playbooks: Playbook[],
  topics: string[] | "all",
  caps?: Capabilities,
  opts?: RenderOptions,
): string {
  const picked = playbooks.filter((p) => {
    if (p.enabled === false) return false;
    if (!satisfied(p, caps)) return false;
    if (opts?.exact) {
      return topics !== "all" && (topics.includes(p.loadWhen) || topics.includes(p.slug));
    }
    if (p.loadWhen === "always") return true;
    return topics === "all" || topics.includes(p.loadWhen);
  });
  if (!picked.length) return "";
  const blocks = picked.map((p) => `### ${p.name}\n${p.body}`);
  return `=== PLAYBOOKS (operating instructions — follow them literally) ===\n${blocks.join("\n\n")}\n=== END PLAYBOOKS ===`;
}

/** Convenience: load + render in one call. */
export async function playbookBlock(
  client: Client | null,
  workspaceId: string | null,
  topics: string[] | "all",
  caps?: Capabilities,
  opts?: RenderOptions,
): Promise<string> {
  const all = await loadPlaybooks(client, workspaceId);
  return renderPlaybooks(all, topics, caps, opts);
}
