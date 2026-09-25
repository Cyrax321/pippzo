import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useBrandProfile } from "@/lib/brand-store";
import { ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Social Studio — Plan, create and schedule social content" },
      {
        name: "description",
        content:
          "A simple workspace to define your brand, generate posts and visuals, schedule them, and see what performed.",
      },
      { property: "og:title", content: "Social Studio — Plan, create and schedule social content" },
      {
        property: "og:description",
        content:
          "A simple workspace to define your brand, generate posts and visuals, schedule them, and see what performed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const steps = [
  {
    n: "01",
    title: "Set up your brand",
    url: "/marca",
    desc: "Add your name, audience and what you offer. Everything the studio writes starts here.",
    how: "Fill the short form once — you can upload a PDF brand guideline and let it extract the details for you.",
  },
  {
    n: "02",
    title: "Tune the guide",
    url: "/guia",
    desc: "Tone of voice, content pillars, words to use and avoid.",
    how: "Edit any field and save. The agent reads this guide before writing a single line.",
  },
  {
    n: "03",
    title: "Create posts",
    url: "/crear",
    desc: "Write once, get versions adapted to each channel.",
    how: "Type a topic, pick the channels, then attach an image from your library or generate one.",
  },
  {
    n: "04",
    title: "Build a library",
    url: "/library",
    desc: "Images and short videos in one place.",
    how: "Upload your own files or generate them from a prompt — anything saved here can be attached to a post.",
  },
  {
    n: "05",
    title: "Schedule",
    url: "/calendario",
    desc: "See the week ahead and push posts to your scheduler.",
    how: "Connect your scheduling account under Settings → Connections, then send any post to a channel and time.",
  },
  {
    n: "06",
    title: "Review results",
    url: "/reports",
    desc: "What performed, what didn't, and what the agent learned.",
    how: "Hit “Sync performance” to pull your published posts, then filter by date range or channel.",
  },
];

function Index() {
  const profile = useBrandProfile();
  // Rendered only after hydration: the server's clock/timezone differs from the
  // visitor's, which would otherwise cause a hydration mismatch.
  const [dateline, setDateline] = useState("");
  useEffect(() => {
    setDateline(
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
    );
  }, []);

  return (
    <div className="relative">
      {/* Masthead */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 md:px-10 pt-10 md:pt-14 pb-8">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <p className="label-eyebrow">Social studio</p>
            <p className="label-eyebrow tabular-nums" suppressHydrationWarning>
              {dateline}
            </p>
          </div>
          <div className="mt-6 flex items-end justify-between gap-6 flex-wrap">
            <h1 className="font-serif text-[12vw] md:text-[6.5rem] leading-[0.9] tracking-[-0.04em]">
              Your social workspace
            </h1>
          </div>
        </div>
      </section>

      {/* Lede */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 md:px-10 py-12 md:py-16 grid md:grid-cols-12 gap-8 md:gap-12">
          <div className="md:col-span-7">
            <p className="label-eyebrow">How this works</p>
            <h2 className="mt-4 font-serif text-3xl md:text-5xl leading-[1.05] tracking-tight">
              Define your voice once.
              <br />
              <span className="italic text-muted-foreground">Then create, schedule and learn.</span>
            </h2>
          </div>
          <div className="md:col-span-5 md:pt-2">
            <div className="rule mb-5" />
            <p className="text-base md:text-lg leading-relaxed text-foreground/85">
              Start with your brand so the studio knows how you sound. From there you can draft
              posts, add images or short videos, schedule them to your channels, and come back to
              Reports to see what actually worked. If you'd rather just talk, ask the agent and it
              will do the steps for you.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              <Link
                to={profile ? "/crear" : "/marca"}
                className="group inline-flex items-center gap-2 bg-foreground text-background px-5 py-3 text-sm font-medium hover:bg-foreground/90 transition"
              >
                {profile ? "Create a post" : "Start with your brand"}
                <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
              <Link
                to="/chat"
                className="inline-flex items-center gap-2 border border-foreground px-5 py-3 text-sm hover:bg-foreground hover:text-background transition"
              >
                Talk to the agent
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section>
        <div className="mx-auto max-w-6xl px-6 md:px-10 py-12 md:py-16">
          <div className="flex items-baseline justify-between mb-8">
            <p className="label-eyebrow">Step by step</p>
            <p className="label-eyebrow tabular-nums">06 steps</p>
          </div>
          <ul className="divide-y divide-border border-y border-border">
            {steps.map((s) => (
              <li key={s.url}>
                <Link
                  to={s.url}
                  className="group grid grid-cols-12 gap-x-4 gap-y-1 items-start py-6 md:py-7 hover:bg-foreground hover:text-background transition-colors px-2 md:px-3 -mx-2 md:-mx-3"
                >
                  <span className="col-span-2 md:col-span-1 font-mono text-xs tabular-nums text-muted-foreground group-hover:text-background/60 md:pt-2">
                    {s.n}
                  </span>
                  <span className="col-span-10 md:col-span-3 font-serif text-2xl md:text-3xl">
                    {s.title}
                  </span>
                  <span className="col-span-12 md:col-span-7 text-sm md:text-base text-muted-foreground group-hover:text-background/80">
                    {s.desc}
                    <span className="block mt-1 text-xs md:text-sm text-muted-foreground/80 group-hover:text-background/60">
                      {s.how}
                    </span>
                  </span>
                  <span className="hidden md:flex md:col-span-1 justify-end md:pt-2">
                    <ArrowUpRight className="h-5 w-5 opacity-40 group-hover:opacity-100 transition" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Colophon */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 md:px-10 py-10 grid md:grid-cols-3 gap-6 items-end">
          <div>
            <p className="label-eyebrow">Colophon</p>
            <p className="mt-2 font-serif text-xl italic">«Less hype, more craft.»</p>
          </div>
          <div className="text-sm text-muted-foreground">
            Set in Instrument Serif and Inter. Shipped every night by an agent that does not brag
            about being AI.
          </div>
          <div className="md:text-right">
            <p className="label-eyebrow">Edition {new Date().getFullYear()}</p>
            <p className="mt-1 text-sm">Open source · MIT</p>
          </div>
        </div>
      </section>
    </div>
  );
}
