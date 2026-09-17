import { useEffect, useState } from "react";
import { api, type StatsResult, type Insight } from "../lib/api";
import { BarChart, GoalRing } from "../components/charts";

const card = "rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4";

export function Insights() {
  const [range, setRange] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.statistics(range).then(setStats).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    if (range === "weekly") api.insights().then(setInsights).catch(() => {});
  }, [range]);

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Insights</h1>
      <div role="group" aria-label="Time range" className="flex gap-2 text-sm">
        {(["daily", "weekly", "monthly"] as const).map((r) => (
          <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}
            className={`rounded border px-3 py-1 ${range === r ? "bg-green-700 text-white" : ""}`}>{r}</button>
        ))}
      </div>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!stats ? <p>Loading…</p> : stats.status === "insufficient" ? (
        <section className={card}>
          <h2 className="font-semibold">Not enough data yet</h2>
          <p className="text-sm mt-1">{stats.reason}</p>
        </section>
      ) : (
        <>
          <section className={card} aria-label="Meal activity">
            <h2 className="font-semibold text-lg">Meal activity</h2>
            <p className="text-sm opacity-80">{stats.totalMeals} meal(s) · {stats.activeDays} active day(s)</p>
            <div className="mt-2">
              <BarChart
                values={stats.mealsPerDay}
                labels={stats.buckets.map((b) => b.date.slice(5))}
                title={`Meals per day: ${stats.buckets.map((b) => `${b.date} ${b.meals}`).join(", ")}`}
                barLabel={(v, i) => `${stats.buckets[i].date}: ${v} meals`}
              />
            </div>
          </section>
          <section className={card} aria-label="Nutrition trends">
            <h2 className="font-semibold text-lg">Nutrition</h2>
            {stats.nutrition.daysWithData === 0 ? (
              <p className="text-sm">No nutrition data logged yet — add calories when logging meals to see trends.</p>
            ) : (
              <p className="text-sm">
                {stats.nutrition.calories != null && <>{stats.nutrition.calories} kcal total · </>}
                {stats.nutrition.protein_g != null && <>{stats.nutrition.protein_g}g protein · </>}
                across {stats.nutrition.daysWithData} day(s) with data.
              </p>
            )}
            <p className="text-sm mt-1">Variety: {stats.variety.uniqueMeals} meals · {stats.variety.uniqueFoods} foods.
              {stats.repeats.length > 0 && <> Most repeated: {stats.repeats.map((r) => `${r.name} (${r.count}×)`).join(", ")}.</>}
              {stats.cuisineVariety.count > 0 && <> Cuisines: {stats.cuisineVariety.cuisines.join(", ")}.</>}
            </p>
            {stats.averages.mealsPerDay != null && (
              <p className="text-sm mt-1">Average: {stats.averages.mealsPerDay} meals per active day
                {stats.averages.caloriesPerDay != null && <> · {stats.averages.caloriesPerDay} kcal per day</>}.</p>
            )}
            <p className="text-sm mt-1">Timing: morning {stats.timing.morning} · afternoon {stats.timing.afternoon} · evening {stats.timing.evening} · night {stats.timing.night}.</p>
            {stats.waste && (stats.waste.expiring > 0 || stats.waste.expired > 0) && (
              <p className="text-sm mt-1">Inventory: {stats.waste.expired} expired · {stats.waste.expiring} expiring soon (estimated dates).</p>
            )}
          </section>
          {stats.goalProgress.filter((g) => g.target != null).length > 0 && (
            <section className={card} aria-label="Goal consistency">
              <h2 className="font-semibold text-lg">Goals</h2>
              <div className="grid gap-3 mt-2 sm:grid-cols-2">
                {stats.goalProgress.filter((g) => g.target != null).map((g) => (
                  <GoalRing key={g.label} label={g.label} actual={g.actual} target={g.target as number} />
                ))}
              </div>
            </section>
          )}
          {range === "weekly" && insights.length > 0 && (
            <section className={card} aria-label="Habit insights">
              <h2 className="font-semibold text-lg">Habit insights</h2>
              <ul className="list-disc ml-5 text-sm space-y-1">
                {insights.map((i) => <li key={i.id}>{i.text}</li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
