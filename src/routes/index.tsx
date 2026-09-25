import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pippzo, your AI social media manager" },
      {
        name: "description",
        content:
          "Pippzo writes in your brand voice, designs on-brand visuals, publishes on schedule and reports what worked.",
      },
      { property: "og:title", content: "Pippzo, your AI social media manager" },
      {
        property: "og:description",
        content:
          "Pippzo writes in your brand voice, designs on-brand visuals, publishes on schedule and reports what worked.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400&display=swap",
      },
    ],
  }),
  component: Index,
});

const CSS = `
.pz {
  --paper-white: #ffffff;
  --canvas: #fafafa;
  --line: #eaeaea;
  --subtext: #666666;
  --icon: #7d7d7d;
  --ink: #171717;
  --onyx: #000000;

  --shadow-subtle: rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 1px 0px;

  --page-max-width: 1440px;
  --section-gap: 96px;
  --card-padding: 16px;
  --element-gap: 8px;

  --radius-cards: 12px;
  --radius-inputs: 12px;
  --radius-buttons: 8px;
  --radius-chips: 6px;
  --radius-pills: 9999px;

  background: var(--canvas);
  color: var(--ink);
  font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.pz *, .pz *::before, .pz *::after { box-sizing: border-box; }
.pz a { color: inherit; text-decoration: none; }
.pz button { font-family: inherit; }

.pz-shell { max-width: var(--page-max-width); margin: 0 auto; padding: 0 24px; }

.pz-caption {
  font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  line-height: 1.5;
  color: var(--icon);
  font-variant-numeric: tabular-nums;
}
.pz-mono {
  font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}

.pz-display { font-size: 48px; line-height: 1; letter-spacing: -2.88px; font-weight: 600; }
.pz-h2 { font-size: 32px; line-height: 1.17; letter-spacing: -1.28px; font-weight: 600; }
.pz-h3 { font-size: 24px; line-height: 1.33; letter-spacing: -0.48px; font-weight: 600; }
.pz-h4 { font-size: 20px; line-height: 1.25; font-weight: 600; }
.pz-sub { font-size: 18px; line-height: 1.56; }
.pz-body { font-size: 16px; line-height: 1.5; }
.pz-sm { font-size: 14px; line-height: 1.43; }
.pz-xs { font-size: 13px; line-height: 1.3; }

.pz-header {
  position: sticky; top: 0; z-index: 20;
  width: 100%;
  background: var(--paper-white);
  border-bottom: 1px solid var(--line);
}
.pz-header-row { height: 56px; display: flex; align-items: center; justify-content: space-between; }

.pz-logo { display: flex; align-items: center; gap: 10px; }
.pz-logo-mark {
  width: 24px; height: 24px; border-radius: var(--radius-chips);
  background: var(--onyx); color: var(--paper-white);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; line-height: 1; letter-spacing: -0.2px;
}
.pz-logo-word { font-size: 15px; font-weight: 600; letter-spacing: -0.2px; color: var(--onyx); }

.pz-nav { display: flex; align-items: center; gap: 24px; }
.pz-ghost {
  background: transparent; border: none; cursor: pointer;
  font-size: 14px; font-weight: 400; color: var(--subtext);
  padding: 0; transition: color .15s ease;
}
.pz-ghost:hover { color: var(--ink); }
.pz-nav-actions { display: flex; align-items: center; gap: 16px; }

.pz-btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--ink); color: var(--paper-white);
  font-size: 14px; font-weight: 500; line-height: 1.43;
  padding: 8px 12px; border: none; border-radius: var(--radius-buttons);
  cursor: pointer; transition: opacity .15s ease;
}
.pz-btn-primary:hover { opacity: .88; }
.pz-btn-secondary {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--paper-white); color: var(--ink);
  font-size: 14px; font-weight: 500; line-height: 1.43;
  padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius-buttons);
  cursor: pointer; transition: border-color .15s ease;
}
.pz-btn-secondary:hover { border-color: #c9c9c9; }

.pz-section { padding: var(--section-gap) 0; }
.pz-hero { padding: 80px 0 var(--section-gap); text-align: center; }
.pz-hero-title { margin: 20px auto 0; max-width: 820px; }
.pz-hero-sub { margin: 20px auto 0; max-width: 600px; color: var(--subtext); }

.pz-prompt { margin: 32px auto 0; max-width: 620px; }
.pz-prompt-box {
  background: var(--paper-white);
  border: 1px solid var(--line);
  border-radius: var(--radius-inputs);
  padding: 6px 6px 6px 16px;
  display: flex; align-items: center; gap: 12px;
  transition: box-shadow .15s ease, border-color .15s ease;
}
.pz-prompt-box:focus-within { box-shadow: 0px 0px 0px 4px rgba(0,0,0,0.04); border-color: #dcdcdc; }
.pz-prompt-input {
  flex: 1; background: transparent; border: none; outline: none;
  font-size: 15px; line-height: 1.5; color: var(--ink);
  font-family: inherit; padding: 12px 0;
}
.pz-prompt-input::placeholder { color: var(--subtext); }
.pz-prompt-go {
  flex: none; width: 36px; height: 36px; border-radius: var(--radius-buttons);
  background: var(--ink); color: var(--paper-white); border: none;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: opacity .15s ease;
}
.pz-prompt-go:hover { opacity: .88; }

.pz-chips { margin-top: var(--element-gap); display: flex; flex-wrap: wrap; align-items: center; justify-content: center; }
.pz-chip {
  background: transparent; border: 1px solid var(--line); border-radius: var(--radius-chips);
  color: var(--subtext); font-size: 13px; line-height: 1.3;
  padding: 4px 8px; margin: 4px; cursor: pointer;
  transition: color .15s ease, border-color .15s ease;
}
.pz-chip:hover { color: var(--ink); border-color: #c9c9c9; }

.pz-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 32px; }
.pz-section-head p { margin: 8px 0 0; color: var(--subtext); max-width: 520px; }

.pz-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 32px; }
.pz-pill {
  background: var(--paper-white); color: var(--ink);
  border: 1px solid rgba(0,0,0,0.08); border-radius: var(--radius-pills);
  font-size: 13px; line-height: 1.3; font-weight: 500;
  padding: 6px 12px; cursor: pointer; transition: background .15s ease, color .15s ease;
}
.pz-pill[data-active='true'] { background: var(--ink); color: var(--paper-white); border-color: var(--ink); }
.pz-pill:not([data-active='true']):hover { background: #f2f2f2; }

.pz-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1024px) { .pz-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 680px) { .pz-grid { grid-template-columns: minmax(0, 1fr); } }

.pz-card {
  background: var(--paper-white);
  border-radius: var(--radius-cards);
  box-shadow: var(--shadow-subtle);
  overflow: hidden;
  display: flex; flex-direction: column;
  transition: transform .15s ease;
}
.pz-card:hover { transform: translateY(-2px); }
.pz-card-preview {
  margin: var(--card-padding);
  border: 1px solid var(--line);
  border-radius: var(--radius-inputs);
  background: var(--canvas);
  height: 172px;
  padding: 14px;
  overflow: hidden;
}
.pz-card-body { padding: 0 var(--card-padding) var(--card-padding); }
.pz-card-body h3 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.2px; color: var(--ink); }
.pz-card-body p { margin: 6px 0 0; color: var(--subtext); }
.pz-card-foot { margin-top: 12px; display: flex; align-items: center; justify-content: space-between; }

.pz-line { height: 6px; border-radius: 3px; background: #e8e8e8; }
.pz-line-dark { height: 6px; border-radius: 3px; background: #cfcfcf; }

.pz-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 860px) { .pz-steps { grid-template-columns: minmax(0, 1fr); } }
.pz-step {
  background: var(--paper-white); border-radius: var(--radius-cards);
  box-shadow: var(--shadow-subtle); padding: var(--card-padding);
}
.pz-step h3 { margin: 20px 0 0; font-size: 18px; line-height: 1.56; font-weight: 600; letter-spacing: -0.2px; }
.pz-step p { margin: 8px 0 0; color: var(--subtext); }

.pz-band {
  background: var(--paper-white); border-radius: var(--radius-cards);
  box-shadow: var(--shadow-subtle);
  padding: 48px;
  display: flex; align-items: center; justify-content: space-between; gap: 32px;
}
@media (max-width: 860px) { .pz-band { padding: 32px; flex-direction: column; align-items: flex-start; } }
.pz-band p { margin: 12px 0 0; color: var(--subtext); max-width: 520px; }

.pz-footer { border-top: 1px solid var(--line); background: var(--paper-white); }
.pz-footer-row { padding: 32px 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pz-footer-links { display: flex; align-items: center; gap: 24px; }
`;

const FILTERS = ["All", "Writing", "Visuals", "Publishing", "Inbox", "Reports"] as const;

type Filter = (typeof FILTERS)[number];

type Template = {
  name: string;
  filter: Exclude<Filter, "All">;
  kind: "post" | "visual" | "calendar" | "inbox" | "report" | "brand";
  to: string;
};

const templates: Template[] = [
  { name: "Launch announcement", filter: "Writing", kind: "post", to: "/chat" },
  { name: "Thread outline", filter: "Writing", kind: "post", to: "/chat" },
  { name: "Brand carousel", filter: "Visuals", kind: "visual", to: "/library" },
  { name: "Weekly schedule", filter: "Publishing", kind: "calendar", to: "/calendario" },
  { name: "Reply queue", filter: "Inbox", kind: "inbox", to: "/inbox" },
  { name: "Performance digest", filter: "Reports", kind: "report", to: "/reports" },
];

function Preview({ kind }: { kind: Template["kind"] }) {
  if (kind === "post") {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="pz-mono" style={{ color: "var(--icon)" }}>
          LINKEDIN / 124 WORDS
        </div>
        <div className="pz-line-dark" style={{ width: "88%" }} />
        <div className="pz-line" style={{ width: "100%" }} />
        <div className="pz-line" style={{ width: "96%" }} />
        <div className="pz-line" style={{ width: "72%" }} />
        <div className="mt-auto flex gap-2 pt-2">
          <span className="pz-chip" style={{ margin: 0, pointerEvents: "none" }}>
            #launch
          </span>
          <span className="pz-chip" style={{ margin: 0, pointerEvents: "none" }}>
            #buildinpublic
          </span>
        </div>
      </div>
    );
  }
  if (kind === "visual") {
    return (
      <div className="flex h-full gap-2">
        <div className="flex-1 rounded-[8px] bg-[#e8e8e8]" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="pz-line-dark" style={{ width: "60%" }} />
          <div className="pz-line" style={{ width: "100%" }} />
          <div className="pz-line" style={{ width: "84%" }} />
          <div className="mt-auto rounded-[8px] bg-[#efefef] p-2">
            <div className="pz-mono" style={{ color: "var(--icon)" }}>
              4:5 PORTRAIT
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (kind === "calendar") {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="pz-mono" style={{ color: "var(--icon)" }}>
          NEXT 7 DAYS / 9 SLOTS
        </div>
        <div className="grid flex-1 grid-cols-7 gap-1">
          {[68, 30, 52, 84, 40, 62, 24].map((h, i) => (
            <div key={i} className="flex flex-col justify-end gap-1">
              <div
                className="rounded-[4px]"
                style={{ height: `${h}%`, background: i === 3 ? "var(--ink)" : "#e2e2e2" }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (kind === "inbox") {
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="pz-mono" style={{ color: "var(--icon)" }}>
          INBOX / 3 URGENT
        </div>
        <div className="ml-auto w-[82%] rounded-[8px] bg-[#efefef] p-2">
          <div className="pz-line" style={{ width: "100%" }} />
        </div>
        <div className="w-[88%] rounded-[8px] border border-[#e8e8e8] bg-[var(--paper-white)] p-2">
          <div className="pz-line-dark" style={{ width: "70%" }} />
          <div className="pz-line" style={{ width: "92%", marginTop: 6 }} />
        </div>
        <div className="mt-auto flex items-center gap-2">
          <span className="pz-chip" style={{ margin: 0, pointerEvents: "none" }}>
            DRAFTED
          </span>
          <span className="pz-chip" style={{ margin: 0, pointerEvents: "none" }}>
            NEEDS APPROVAL
          </span>
        </div>
      </div>
    );
  }
  if (kind === "report") {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="pz-mono" style={{ color: "var(--icon)" }}>
          ENGAGEMENT / 30 DAYS
        </div>
        <div className="flex flex-1 items-end gap-2">
          {[42, 58, 36, 74, 66, 90, 61].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-[4px]"
              style={{ height: `${h}%`, background: i === 5 ? "var(--ink)" : "#e2e2e2" }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="pz-mono" style={{ color: "var(--icon)" }}>
            +38% VS PRIOR
          </span>
          <span className="pz-chip" style={{ margin: 0, pointerEvents: "none" }}>
            CAROUSELS WIN
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="pz-mono" style={{ color: "var(--icon)" }}>
        BRAND SPEC / V3
      </div>
      <div className="pz-line-dark" style={{ width: "52%" }} />
      <div className="pz-line" style={{ width: "100%" }} />
      <div className="pz-line" style={{ width: "86%" }} />
      <div className="mt-auto grid grid-cols-4 gap-1 pt-1">
        {["#171717", "#666666", "#eaeaea", "#fafafa"].map((c) => (
          <div
            key={c}
            className="rounded-[4px] border border-[#e8e8e8]"
            style={{ height: 20, background: c }}
          />
        ))}
      </div>
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    t: "Teach it your brand",
    d: "Voice, vocabulary, visual rules. Set once, applied to every post, image and reply the agent writes.",
  },
  {
    n: "02",
    t: "Connect your channels",
    d: "Buffer for publishing, your own model keys for thinking, your own generators for visuals. All encrypted at rest.",
  },
  {
    n: "03",
    t: "Approve, then automate",
    d: "Everything lands in an approval queue first. Review it, edit it, or switch approvals off and let it run.",
  },
];

function Index() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("All");
  const [prompt, setPrompt] = useState("");

  const shown = filter === "All" ? templates : templates.filter((t) => t.filter === filter);

  return (
    <>
      <style>{CSS}</style>
      <div className="pz">
        <header className="pz-header">
          <div className="pz-shell pz-header-row">
            <Link to="/" className="pz-logo">
              <span className="pz-logo-mark">P</span>
              <span className="pz-logo-word">Pippzo</span>
            </Link>
            <nav className="pz-nav">
              <a href="#templates" className="pz-ghost">
                Templates
              </a>
              <a href="#how" className="pz-ghost">
                How it works
              </a>
              <a href="#start" className="pz-ghost">
                Pricing
              </a>
            </nav>
            <div className="pz-nav-actions">
              <Link to="/auth" className="pz-ghost">
                Sign in
              </Link>
              <Link to="/onboarding" className="pz-btn-primary">
                Get started
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
        </header>

        <section className="pz-shell pz-hero">
          <p className="pz-caption">AI SOCIAL MEDIA MANAGER / BRING YOUR OWN KEYS</p>
          <h1 className="pz-display pz-hero-title">Your social media, handled.</h1>
          <p className="pz-body pz-hero-sub">
            Pippzo writes in your brand voice, designs on-brand visuals, publishes on schedule and
            tells you what actually worked.
          </p>

          <div className="pz-prompt">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                navigate({ to: "/onboarding" });
              }}
            >
              <div className="pz-prompt-box">
                <input
                  className="pz-prompt-input"
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ask Pippzo for a post, an image, or a full week of content"
                />
                <button type="submit" className="pz-prompt-go" aria-label="Start">
                  <ArrowRight size={16} />
                </button>
              </div>
            </form>
            <div className="pz-chips">
              {[
                "Write a launch post",
                "Plan my week",
                "Scan a competitor",
                "Report what worked",
              ].map((c) => (
                <button
                  key={c}
                  type="button"
                  className="pz-chip"
                  onClick={() => navigate({ to: "/onboarding" })}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section id="templates" className="pz-shell pz-section">
          <div className="pz-section-head">
            <div>
              <h2 className="pz-h2">Start from a template</h2>
              <p className="pz-sm">
                Every template is a starting point. The agent rewrites it in your voice before
                anything reaches your queue.
              </p>
            </div>
            <span className="pz-mono" style={{ color: "var(--icon)" }}>
              {String(shown.length).padStart(2, "0")} / 06 SHOWN
            </span>
          </div>

          <div className="pz-pills">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className="pz-pill"
                data-active={filter === f}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="pz-grid">
            {shown.map((t) => (
              <Link key={t.name} to={t.to} className="pz-card">
                <div className="pz-card-preview">
                  <Preview kind={t.kind} />
                </div>
                <div className="pz-card-body">
                  <h3>{t.name}</h3>
                  <p className="pz-sm">Runs on your workspace, saved to your approval queue.</p>
                  <div className="pz-card-foot">
                    <span className="pz-mono" style={{ color: "var(--icon)" }}>
                      {t.filter.toUpperCase()}
                    </span>
                    <ArrowRight size={14} style={{ color: "var(--icon)" }} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section id="how" className="pz-shell pz-section">
          <div className="pz-section-head">
            <div>
              <h2 className="pz-h2">How it works</h2>
              <p className="pz-sm">Three steps. No platform account, no vendor lock-in.</p>
            </div>
          </div>
          <div className="pz-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="pz-step">
                <span className="pz-mono" style={{ color: "var(--icon)" }}>
                  {s.n}
                </span>
                <h3>{s.t}</h3>
                <p className="pz-sm">{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="start" className="pz-shell pz-section">
          <div className="pz-band">
            <div>
              <h2 className="pz-h3">Start free, bring your own keys.</h2>
              <p className="pz-sm">
                Your API keys stay encrypted in your own database. You pay your providers directly.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <Link to="/auth" className="pz-btn-secondary">
                Sign in
              </Link>
              <Link to="/onboarding" className="pz-btn-primary">
                Get started
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
        </section>

        <footer className="pz-footer">
          <div className="pz-shell pz-footer-row">
            <div className="pz-logo">
              <span className="pz-logo-mark" style={{ width: 20, height: 20, fontSize: 10 }}>
                P
              </span>
              <span className="pz-sm" style={{ color: "var(--subtext)" }}>
                Pippzo, open source, bring your own keys.
              </span>
            </div>
            <div className="pz-footer-links">
              <span className="pz-mono" style={{ color: "var(--icon)" }}>
                {"\u00a9"} {new Date().getFullYear()} / MIT
              </span>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
