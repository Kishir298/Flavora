import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Recommendation } from "../lib/api";
import { AiStatus, type AiSource } from "../components/AiStatus";
import { RecipeCard } from "../components/RecipeCard";
import { enqueueMealLog } from "../lib/mealQueue";

interface ChatMsg {
  id: number;
  role: "user" | "flavora";
  text: string;
}

const QUICK_ACTIONS: { label: string; message?: string; to?: string }[] = [
  { label: "Make a meal", message: "I want to make a meal" },
  { label: "Eat healthier", message: "I want something healthy" },
  { label: "Use my pantry", message: "I want to use what I already have" },
  { label: "Plan meals", to: "/meal-plan" },
];

let msgId = 0;
const nextId = () => ++msgId;

const CHAT_STORE_KEY = "flavora:chat:v1";

function loadChat(): { messages: ChatMsg[]; sessionId?: string } | null {
  try {
    const raw = localStorage.getItem(CHAT_STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { messages?: ChatMsg[]; sessionId?: string };
    if (!Array.isArray(data.messages)) return null;
    for (const m of data.messages) msgId = Math.max(msgId, m.id);
    return { messages: data.messages.slice(-50), sessionId: data.sessionId };
  } catch {
    return null;
  }
}

/** Flavora home: zero-friction conversational food requests (§6). */
export function Home() {
  const restored = useRef(loadChat());
  const [messages, setMessages] = useState<ChatMsg[]>(
    restored.current?.messages ?? [
      { id: nextId(), role: "flavora", text: "Tell me what you're craving — I'll figure out what I need to know." },
    ]
  );
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>(restored.current?.sessionId);
  const [results, setResults] = useState<Recommendation[]>([]);
  const [mealType, setMealType] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSent, setLastSent] = useState("");
  const [doneNoResults, setDoneNoResults] = useState(false);
  const [aiSource, setAiSource] = useState<AiSource>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [logged, setLogged] = useState<Record<string, boolean>>({});
  const logRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Persist conversation so reload/navigation doesn't wipe it (server session
  // survives 30m; the client keeps the sessionId + recent bubbles locally).
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORE_KEY, JSON.stringify({ messages: messages.slice(-50), sessionId }));
    } catch {
      /* storage full/blocked — chat still works in-memory */
    }
  }, [messages, sessionId]);

  function push(role: ChatMsg["role"], text: string) {
    setMessages((m) => [...m, { id: nextId(), role, text }]);
  }

  async function send(text: string, opts?: { skipUserPush?: boolean }) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError("");
    setLastSent(trimmed);
    setDoneNoResults(false);
    if (!opts?.skipUserPush) push("user", trimmed);
    setInput("");
    try {
      const res = await api.conversation({ sessionId, message: trimmed });
      setSessionId(res.sessionId);
      setAiSource(res.source);
      setFallbackReason(res.fallbackReason ?? null);
      if (res.done) {
        setResults(res.recommendations);
        // Keep logged flags only for recipes still shown; drop stale ids
        // from earlier turns so a later query never shows a disabled Logged ✓.
        setLogged((prev) => {
          const ids = new Set(res.recommendations.map((r) => r.recipeId));
          const next: Record<string, boolean> = {};
          for (const [k, v] of Object.entries(prev)) if (ids.has(k) && v) next[k] = true;
          return next;
        });
        setDoneNoResults(res.recommendations.length === 0);
        const fr = res.foodRequest as { mealType?: string; availableIngredients?: string[] };
        if (typeof fr?.mealType === "string") setMealType(fr.mealType);
        // Remember owned ingredients for RecipeDetail's `have` highlighting.
        try {
          const have = Array.isArray(fr?.availableIngredients) ? fr.availableIngredients : [];
          sessionStorage.setItem("flavora:lastHave", JSON.stringify(have));
        } catch {
          /* storage blocked — detail page still works without `have` */
        }
        push("flavora", res.reply || "Here are my picks.");
      } else {
        // Keep prior recommendations visible until the next done turn
        // replaces them; clearing here caused flicker mid-conversation.
        setDoneNoResults(false);
        push("flavora", res.question || "Tell me a bit more.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "assistant failed");
    } finally {
      setLoading(false);
      // Scroll the log end into view (bottom-anchored), not the container top.
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" }));
    }
  }

  function newChat() {
    setMessages([{ id: nextId(), role: "flavora", text: "Tell me what you're craving — I'll figure out what I need to know." }]);
    setSessionId(undefined);
    setResults([]);
    setMealType(undefined);
    setError("");
    setLastSent("");
    setDoneNoResults(false);
    setLogged({});
    try {
      localStorage.removeItem(CHAT_STORE_KEY);
    } catch {
      /* ignore */
    }
  }

  async function logMeal(r: Recommendation) {
    const mt: "breakfast" | "lunch" | "dinner" | "snack" | "other" = (
      ["breakfast", "lunch", "dinner", "snack"] as string[]
    ).includes(mealType ?? "")
      ? (mealType as "breakfast" | "lunch" | "dinner" | "snack")
      : "other";
    const payload = {
      name: r.title,
      mealType: mt,
      loggedAt: new Date().toISOString(),
      foods: (r.ingredients ?? []).slice(0, 8).map((name) => ({ name })),
      servings: 1,
      nutrition: r.nutrition
        ? {
            calories: r.nutrition.calories ?? null,
            protein_g: r.nutrition.protein_g ?? null,
            carbs_g: r.nutrition.carbs_g ?? null,
            fat_g: r.nutrition.fat_g ?? null,
          }
        : null,
    };
    try {
      await api.mealLog.add(payload);
      setLogged((l) => ({ ...l, [r.recipeId]: true }));
      push("flavora", `Logged "${r.title}". See your Dashboard for updated stats.`);
    } catch (err) {
      // Offline: queue the meal log for replay instead of erroring out.
      const msg = err instanceof Error ? err.message : String(err);
      if (/failed to fetch|network|offline|load failed/i.test(msg)) {
        try {
          await enqueueMealLog("add", payload);
          setLogged((l) => ({ ...l, [r.recipeId]: true }));
          push("flavora", `Saved "${r.title}" offline — it will sync to your Dashboard when you're back online.`);
          return;
        } catch {
          /* fall through to error display */
        }
      }
      setError(err instanceof Error ? err.message : "logging failed");
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold tracking-tight">FLAVORA</h1>
      <p className="mt-1 text-lg">What are you craving today?</p>

      <div ref={logRef} role="log" aria-live="polite" aria-busy={loading} aria-label="Flavora conversation" className="mt-4 space-y-2 min-h-24">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={newChat}
            disabled={loading}
            className="text-xs px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 opacity-70 disabled:opacity-40"
            aria-label="Start a new conversation"
          >
            New chat
          </button>
        </div>
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <p
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-green-700 text-white"
                  : "bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700"
              }`}
            >
              {m.text}
            </p>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <p className="rounded-2xl px-3 py-2 text-sm bg-neutral-100 dark:bg-neutral-800" role="status">
              Thinking…
            </p>
          </div>
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="mt-3 flex gap-2"
        aria-label="ask-flavora-form"
      >
        <label htmlFor="craving-input" className="sr-only">
          Tell Flavora what you want to eat
        </label>
        <input
          id="craving-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="I want something spicy with chicken…"
          autoComplete="off"
          className="flex-1 rounded-full border px-4 py-2 bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-5 py-2 rounded-full bg-green-700 text-white disabled:opacity-50"
        >
          Ask Flavora
        </button>
      </form>

      <div className="mt-3">
        <p className="text-xs opacity-60 mb-1">Quick actions:</p>
        <div className="flex gap-2 flex-wrap">
          {QUICK_ACTIONS.map((a) =>
            a.to ? (
              <Link key={a.label} to={a.to} className="px-3 py-1.5 rounded-full border text-sm border-green-700 text-green-700 dark:text-green-400">
                {a.label}
              </Link>
            ) : (
              <button
                key={a.label}
                type="button"
                disabled={loading}
                onClick={() => void send(a.message ?? a.label)}
                className="px-3 py-1.5 rounded-full border text-sm border-green-700 text-green-700 dark:text-green-400 disabled:opacity-50"
              >
                {a.label}
              </button>
            )
          )}
        </div>
      </div>

      <AiStatus source={aiSource} fallbackReason={fallbackReason} />
      {error && (
        <div role="alert" className="mt-2 text-sm text-red-600 flex items-center gap-2 flex-wrap">
          <span>{error}</span>
          {lastSent && (
            <button
              type="button"
              onClick={() => void send(lastSent, { skipUserPush: true })}
              disabled={loading}
              className="px-2 py-1 rounded border border-red-600 disabled:opacity-50"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {doneNoResults && (
        <section aria-label="no recommendations" className="mt-6 rounded border border-neutral-200 dark:border-neutral-700 p-4 text-sm">
          <p className="font-semibold">No strong match in your local library.</p>
          <p className="mt-1 opacity-80">
            Try adding more ingredients, increasing your time limit, or picking another cuisine — allergy and avoid-food filters always stay on.
          </p>
          <button
            type="button"
            onClick={newChat}
            className="mt-2 px-3 py-1.5 rounded-full border text-sm border-green-700 text-green-700 dark:text-green-400"
          >
            Start over
          </button>
        </section>
      )}

      {results.length > 0 && (
        <section aria-label="recommendations" className="mt-6 grid gap-3" aria-live="polite">
          {results.map((r) => (
            <div key={r.recipeId}>
              <RecipeCard
                recipe={{
                  id: r.recipeId,
                  title: r.title,
                  cuisine: r.cuisine,
                  cookTime: r.cookTime,
                  difficulty: r.difficulty,
                  costTier: r.costTier,
                  ingredients: r.ingredients ?? [],
                  nutrition: r.nutrition,
                  score: r.score,
                }}
              />
              <div className="mt-1 ml-1 flex items-center gap-2 flex-wrap">
                <p className="text-xs opacity-70">{(r.matchReasons ?? []).join(" · ")}</p>
                <button
                  type="button"
                  disabled={!!logged[r.recipeId]}
                  onClick={() => void logMeal(r)}
                  className="text-xs px-2 py-1 rounded border border-green-700 text-green-700 dark:text-green-400 disabled:opacity-50"
                  aria-label={`Log ${r.title} as eaten`}
                >
                  {logged[r.recipeId] ? "Logged ✓" : "Log as eaten"}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
