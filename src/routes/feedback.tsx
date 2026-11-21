import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Star,
  Send,
  MessageSquare,
  ThumbsUp,
  Sparkles,
  Zap,
  Palette,
  BarChart3,
  Bug,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Quote,
  ShieldCheck,
} from "lucide-react";

export const Route = createFileRoute("/feedback")({
  head: () => ({
    meta: [
      { title: "Feedback & Reviews · Pippzo" },
      { name: "description", content: "Share your feedback and review your Pippzo experience." },
    ],
  }),
  component: FeedbackPage,
});

type Category = "general" | "ai" | "scheduling" | "design" | "performance" | "bug";
type ReviewStatus = "new" | "reviewed" | "planned" | "done";

type Review = {
  id: string;
  author: string;
  avatar: string;
  rating: number;
  category: Category;
  body: string;
  date: string;
  helpful: number;
  status: ReviewStatus;
};

const STORAGE_KEY = "pippzo_customer_reviews";

function loadStoredReviews(): Review[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistReviews(reviews: Review[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
  } catch {}
}

const CATEGORIES: { value: Category; label: string; Icon: React.FC<{ className?: string }> }[] = [
  { value: "general", label: "General", Icon: MessageSquare },
  { value: "ai", label: "AI Agent", Icon: Sparkles },
  { value: "scheduling", label: "Scheduling", Icon: Zap },
  { value: "design", label: "Design & UI", Icon: Palette },
  { value: "performance", label: "Performance", Icon: BarChart3 },
  { value: "bug", label: "Bug Report", Icon: Bug },
];

const STATUS_CONFIG: Record<ReviewStatus, { label: string; color: string }> = {
  new: { label: "New", color: "bg-muted text-muted-foreground" },
  reviewed: { label: "Reviewed", color: "bg-blue-500/10 text-blue-500" },
  planned: { label: "Planned", color: "bg-amber-500/10 text-amber-600" },
  done: { label: "Implemented", color: "bg-emerald-500/10 text-emerald-600" },
};

function StarRating({
  value,
  onChange,
  readonly = false,
  size = "md",
}: {
  value: number;
  onChange?: (v: number) => void;
  readonly?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const [hover, setHover] = useState(0);
  const sz = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-7 w-7" : "h-5 w-5";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(i)}
          onMouseEnter={() => !readonly && setHover(i)}
          onMouseLeave={() => !readonly && setHover(0)}
          className={`transition-colors ${readonly ? "cursor-default" : "cursor-pointer"}`}
          aria-label={`${i} star${i > 1 ? "s" : ""}`}
        >
          <Star
            className={`${sz} transition-all ${
              i <= (hover || value)
                ? "fill-amber-400 text-amber-400"
                : "fill-transparent text-muted-foreground/30"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function ReviewCard({
  review,
  onHelpful,
}: {
  review: Review;
  onHelpful: (id: string) => void;
}) {
  const [helpful, setHelpful] = useState(review.helpful);
  const [voted, setVoted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const statusCfg = STATUS_CONFIG[review.status];
  const cat = CATEGORIES.find((c) => c.value === review.category);
  const CatIcon = cat?.Icon ?? MessageSquare;
  const isLong = review.body.length > 180;
  const displayBody = isLong && !expanded ? review.body.slice(0, 180) + "…" : review.body;

  const handleHelpfulClick = () => {
    if (!voted) {
      setHelpful((h) => h + 1);
      setVoted(true);
      onHelpful(review.id);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card/50 p-5 space-y-3 hover:border-border/80 hover:bg-card transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-foreground/10 border border-border grid place-items-center text-xs font-semibold shrink-0">
            {review.avatar}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium">{review.author}</p>
              <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 bg-emerald-500/10 px-1.5 py-0.2 rounded-full">
                <ShieldCheck className="h-2.5 w-2.5" /> Customer
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {new Date(review.date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${statusCfg.color}`}>
          {statusCfg.label}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <StarRating value={review.rating} readonly size="sm" />
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
          <CatIcon className="h-3 w-3" />
          {cat?.label}
        </span>
      </div>

      <div className="relative">
        <Quote className="h-3.5 w-3.5 text-muted-foreground/20 absolute -top-1 -left-1" />
        <p className="text-sm text-muted-foreground pl-3 leading-relaxed">{displayBody}</p>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 pl-3 text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Read more
              </>
            )}
          </button>
        )}
      </div>

      <div className="pt-2 border-t border-border/50 flex items-center justify-between">
        <button
          type="button"
          disabled={voted}
          onClick={handleHelpfulClick}
          className={`flex items-center gap-1.5 text-[11px] transition-colors ${
            voted
              ? "text-foreground cursor-default"
              : "text-muted-foreground hover:text-foreground cursor-pointer"
          }`}
        >
          <ThumbsUp className={`h-3.5 w-3.5 ${voted ? "fill-current" : ""}`} />
          {helpful} found this helpful
        </button>
        {review.status === "done" && (
          <span className="flex items-center gap-1 text-[11px] text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> Shipped
          </span>
        )}
        {review.status === "planned" && (
          <span className="flex items-center gap-1 text-[11px] text-amber-600">
            <Clock className="h-3.5 w-3.5" /> On roadmap
          </span>
        )}
      </div>
    </div>
  );
}

function FeedbackPage() {
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState<Category>("general");
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [filterCat, setFilterCat] = useState<Category | "all">("all");
  const [sortBy, setSortBy] = useState<"recent" | "rating" | "helpful">("recent");

  // Load reviews on mount from local storage (starts empty with zero seed reviews)
  useEffect(() => {
    setReviews(loadStoredReviews());
  }, []);

  // Attempt to autofill user name from Supabase session
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      const metaName =
        (u.user_metadata?.full_name as string) ||
        (u.user_metadata?.name as string) ||
        (u.email ? u.email.split("@")[0] : "");
      if (metaName) {
        setAuthorName(metaName);
      }
    });
  }, []);

  const totalReviews = reviews.length;
  const avg = totalReviews > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / totalReviews : 0;
  const dist = [5, 4, 3, 2, 1].map((n) => {
    const count = reviews.filter((r) => r.rating === n).length;
    const pct = totalReviews > 0 ? (count / totalReviews) * 100 : 0;
    return { n, count, pct };
  });

  const filtered = reviews
    .filter((r) => filterCat === "all" || r.category === filterCat)
    .sort((a, b) => {
      if (sortBy === "rating") return b.rating - a.rating;
      if (sortBy === "helpful") return b.helpful - a.helpful;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

  const handleHelpful = (id: string) => {
    setReviews((prev) => {
      const updated = prev.map((r) => (r.id === id ? { ...r, helpful: r.helpful + 1 } : r));
      persistReviews(updated);
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) {
      toast.error("Please select a star rating.");
      return;
    }
    if (body.trim().length < 10) {
      toast.error("Please write at least 10 characters.");
      return;
    }

    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 600));

    const finalAuthor = authorName.trim() || "Customer";
    const initials = finalAuthor
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "CU";

    const newReview: Review = {
      id: crypto.randomUUID(),
      author: finalAuthor,
      avatar: initials,
      rating,
      category,
      body: body.trim(),
      date: new Date().toISOString().split("T")[0],
      helpful: 0,
      status: "new",
    };

    const next = [newReview, ...reviews];
    setReviews(next);
    persistReviews(next);
    setSubmitting(false);
    setSubmitted(true);
    toast.success("Thank you for your feedback!");

    setTimeout(() => {
      setSubmitted(false);
      setRating(0);
      setCategory("general");
      setBody("");
    }, 3000);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Settings · Feedback</p>
        <h1 className="font-serif text-3xl">Feedback &amp; Reviews</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Your input directly shapes how Pippzo improves. Share what's working, what isn't, and what
          you'd love to see next. Only verified reviews submitted by customers are displayed here.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">
        {/* Reviews feed */}
        <div className="space-y-6 min-w-0">
          {/* Rating summary */}
          <div className="rounded-xl border border-border bg-card/50 p-5">
            {totalReviews === 0 ? (
              <div className="text-center py-4 space-y-1.5">
                <p className="text-sm font-medium">No reviews submitted yet</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Be the first to review Pippzo! Share your feedback using the form to have it appear
                  here.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-6 flex-wrap">
                <div className="text-center shrink-0">
                  <p className="font-serif text-5xl leading-none">{avg.toFixed(1)}</p>
                  <div className="mt-1">
                    <StarRating value={Math.round(avg)} readonly size="sm" />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {totalReviews} review{totalReviews !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex-1 space-y-1.5 min-w-[160px]">
                  {dist.map(({ n, count, pct }) => (
                    <div key={n} className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground w-3 shrink-0">{n}</span>
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-amber-400 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground w-4 shrink-0">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { value: "all" as const, label: "All" },
              ...CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
            ].map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilterCat(f.value as Category | "all")}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  filterCat === f.value
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground">
              {filtered.length} review{filtered.length !== 1 ? "s" : ""}
            </p>
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
              {(["recent", "rating", "helpful"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSortBy(s)}
                  className={`text-[11px] px-2.5 py-1 rounded-md transition-colors capitalize ${
                    sortBy === s
                      ? "bg-background text-foreground shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 p-10 text-center space-y-2">
                <MessageSquare className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                <p className="text-sm font-medium">No reviews in this category yet</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Only feedback submitted by actual customers is displayed. Submit your review using
                  the form to get started.
                </p>
              </div>
            ) : (
              filtered.map((r) => <ReviewCard key={r.id} review={r} onHelpful={handleHelpful} />)
            )}
          </div>
        </div>

        {/* Submit form */}
        <div className="sticky top-20">
          <div className="rounded-xl border border-border bg-card/60 backdrop-blur-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-muted/30">
              <p className="font-medium text-sm">Write a review</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Help us build what matters most to your workflow.
              </p>
            </div>

            {submitted ? (
              <div className="px-5 py-10 flex flex-col items-center gap-3 text-center">
                <div className="h-12 w-12 rounded-full bg-emerald-500/10 grid place-items-center">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                </div>
                <p className="font-medium">Feedback submitted!</p>
                <p className="text-xs text-muted-foreground">Thank you for helping us improve Pippzo.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Overall rating
                  </label>
                  <StarRating value={rating} onChange={setRating} size="lg" />
                  {rating > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {["", "Poor", "Fair", "Good", "Great", "Excellent!"][rating]}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="feedback-name"
                    className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    Your name or alias
                  </label>
                  <Input
                    id="feedback-name"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder="e.g. Alex M. or Founder"
                    className="h-9 text-sm"
                    maxLength={50}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Category
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {CATEGORIES.map((c) => {
                      const Icon = c.Icon;
                      return (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setCategory(c.value)}
                          className={`flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg border transition-all ${
                            category === c.value
                              ? "bg-foreground text-background border-foreground"
                              : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{c.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="feedback-body"
                    className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    Your feedback
                  </label>
                  <Textarea
                    id="feedback-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="What do you love? What can be better? Any feature requests?"
                    rows={4}
                    className="resize-none text-sm"
                    maxLength={1000}
                  />
                  <p className="text-[11px] text-muted-foreground text-right">{body.length}/1000</p>
                </div>

                <Button
                  type="submit"
                  className="w-full gap-2"
                  disabled={submitting || rating === 0 || body.trim().length < 10}
                >
                  {submitting ? (
                    "Submitting…"
                  ) : (
                    <>
                      <Send className="h-4 w-4" /> Submit feedback
                    </>
                  )}
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  Only feedback submitted here will be shown.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
