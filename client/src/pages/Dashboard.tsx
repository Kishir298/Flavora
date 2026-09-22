import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type StatsResult, type Insight, type MealLog, type Goals } from "../lib/api";
import { BarChart, GoalRing } from "../components/charts";

const card = "rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4";

export function Dashboard() {
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [goals, setGoals] = useState<Goals>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, i, m, g] = await Promise.allSettled([
        api.statistics("weekly"),
        api.insights(),
        api.mealLog.list(),
        api.getGoals(),
      ]);
      if (cancelled) return;
      if (s.status === "fulfilled") setStats(s.value);
      else setError(s.reason instanceof Error ? s.reason.message : String(s.reason));
      if (i.status === "fulfilled") setInsights(i.value);
      if (m.status === "fulfilled") setMeals(m.value.slice(0, 5));
      if (g.status === "fulfilled") setGoals(g.value);
      if (s.status === "rejected" && i.status === "rejected" && m.status === "rejected" && g.status === "rejected") {
        // error already set from stats; keep partial UI for any fulfilled slice
      }
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!stats ? (
        <p role="status">Loading…</p>
      ) : stats.status === "insufficient" ? (
        <section className={card} aria-label="Getting started">
          <h2 className="font-semibold text-lg">Welcome to Flavora</h2>
          <p className="mt-1">{stats.reason ?? "You haven't logged enough meals yet to generate meaningful insights."}</p>
          <div className="mt-3 flex gap-2 flex-wrap">
            <Link to="/" className="inline-block rounded bg-green-700 px-4 py-2 text-white">Ask Flavora what to eat</Link>
            <Link to="/meals" className="inline-block rounded border border-green-700 px-4 py-2 text-green-700">Log your first meal</Link>
          </div>
        </section>
      ) : (
        <>
          <section className={card} aria-label="Today's overview">
            <h2 className="font-semibold text-lg">This week</h2>
            <p className="text-sm opacity-80">
              {stats.totalMeals} meal(s) across {stats.activeDays} day(s) · {stats.variety.uniqueMeals} different meals · {stats.variety.uniqueFoods} different foods
              {stats.nutrition.calories != null && <> · {stats.nutrition.calories} kcal logged ({stats.nutrition.daysWithData}d with data)</>}
            </p>
            <div className="mt-3">
              <BarChart
                values={stats.mealsPerDay}
                labels={stats.buckets.map((b) => b.date.slice(5))}
                title={`Meals logged over the last 7 days: ${stats.buckets.map((b) => `${b.date} ${b.meals}`).join(", ")}`}
                barLabel={(v, i) => `${stats.buckets[i].date}: ${v} meals`}
              />
            </div>
          </section>

          {stats.goalProgress.length > 0 && (
            <section className={card} aria-label="Goal progress">
              <h2 className="font-semibold text-lg">Goal progress</h2>
              <div className="grid gap-3 mt-2 sm:grid-cols-2">
                {stats.goalProgress.filter((g) => g.target != null).map((g) => (
                  <GoalRing key={g.label} label={g.label} actual={g.actual} target={g.target as number} />
                ))}
              </div>
              {Object.entries(goals).filter(([k]) => k !== "updatedAt").every(([, v]) => v == null) && (
                <p className="text-sm mt-2"><Link to="/settings" className="underline">Set goals in Settings</Link> to track progress.</p>
              )}
            </section>
          )}

          <section className={card} aria-label="Recent meals">
            <h2 className="font-semibold text-lg">Recent meals</h2>
            {meals.length === 0 ? (
              <p className="text-sm">No meals yet. <Link to="/meals" className="underline">Log one</Link>.</p>
            ) : (
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {meals.map((m) => (
                  <li key={m.id} className="py-2 text-sm">
                    <span className="font-medium">{m.name}</span>
                    {" · "}{m.mealType}{" · "}{new Date(m.loggedAt).toLocaleString()}
                    {m.nutrition?.calories != null && <>{" · "}{m.nutrition.calories} kcal</>}
                    {m.tags?.length ? <>{" · "}{m.tags.join(", ")}</> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={card} aria-label="Insights">
            <h2 className="font-semibold text-lg">Insights</h2>
            <ul className="list-disc ml-5 text-sm space-y-1">
              {insights.map((i) => <li key={i.id}>{i.text}</li>)}
            </ul>
            <p className="text-sm mt-2"><Link to="/insights" className="underline">Open full statistics</Link></p>
          </section>
        </>
      )}
    </div>
  );
}
