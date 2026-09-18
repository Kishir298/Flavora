import { useEffect, useState } from "react";
import { api, type Profile, type Goals } from "../lib/api";
import { AiStatus } from "../components/AiStatus";
import { ProfileForm } from "../components/ProfileForm";
import { enqueueMutation } from "../lib/mutationQueue";

export function Settings({ onTheme }: { onTheme: (t: string) => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goals, setGoals] = useState<Goals>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getProfile()
      .then((p) => {
        setProfile(p);
        onTheme(p.theme);
      })
      .catch(() => setError("Could not load profile."));
    api.getGoals().then(setGoals).catch(() => {});
  }, [onTheme]);

  if (error && !profile) {
    return (
      <p role="alert" className="p-6 text-red-600">
        {error}
      </p>
    );
  }
  if (!profile) return <p className="p-6">Loading…</p>;

  return (
<div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm opacity-70">
        Preferences feed filtering and ranking. Learning starts from default weights and personalises after enough
        cooks/saves/skips (local only).
      </p>
      <div className="mt-2">
        <AiStatus />
      </div>
      <div className="mt-4">
        <ProfileForm
          initial={profile}
          saving={saving}
          onSave={async (p) => {
            setSaving(true);
            setError("");
            setMsg("");
            try {
              const next = await api.saveProfile(p);
              setProfile(next);
              onTheme(next.theme);
              setMsg("Profile saved.");
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              if (/failed to fetch|network|offline|load failed/i.test(msg)) {
                try {
                  await enqueueMutation({ operation: "profile.save", entityType: "profile", entityId: "local", payload: { ...p } });
                  setProfile({ ...profile, ...p });
                  if (p.theme) onTheme(p.theme);
                  setMsg("Profile saved locally — will sync when online.");
                  return;
                } catch {
                  /* fall through */
                }
              }
              setError(e instanceof Error ? e.message : "Could not save profile.");
            } finally {
              setSaving(false);
            }
          }}
        />
      </div>
      <GoalsForm
        goals={goals}
          onSave={async (g) => {
            setSaving(true);
            setError("");
            try {
              setGoals(await api.saveGoals(g));
              setMsg("Goals saved.");
            } catch {
              await enqueueMutation({ operation: "goals.save", entityType: "goals", entityId: "local", payload: { ...g } });
              setGoals(g);
              setMsg("Goals saved locally — will sync when online.");
            } finally {
              setSaving(false);
            }
          }}
      />
      <div className="mt-6 space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-2 rounded border text-sm"
            onClick={() => {
              const next = profile.theme === "dark" ? "light" : "dark";
              api
                .saveProfile({ theme: next })
                .then((p) => {
                  setProfile(p);
                  onTheme(p.theme);
                  setMsg(`Theme set to ${p.theme}.`);
                })
                .catch(() => setError("Could not update theme."));
            }}
          >
            Toggle dark / light (now: {profile.theme})
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            className="px-3 py-2 rounded border text-sm"
            onClick={() =>
              api
                .seed()
                .then(() => setMsg("Demo data loaded."))
                .catch(() => setError("Seed failed."))
            }
          >
            Load demo data
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded border text-sm text-red-600"
            onClick={() => {
              if (confirm("Reset all local data?")) {
                api
                  .reset()
                  .then(() => setMsg("Reset done."))
                  .catch(() => setError("Reset failed."));
              }
            }}
          >
            Reset all data
          </button>
        </div>
        {msg && (
          <p className="text-sm text-green-700 dark:text-green-400" role="status">
            {msg}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function GoalsForm({ goals, onSave }: { goals: Goals; onSave: (g: Partial<Goals>) => Promise<void> }) {
  const [form, setForm] = useState<Goals>({});
  useEffect(() => setForm({ ...goals }), [goals]);
  const num = (v: string): number | null => (v === "" ? null : Number(v));
  const val = (v: number | null | undefined): string => (v == null ? "" : String(v));
  return (
    <form
      aria-label="goals-form"
      className="mt-6 rounded border border-neutral-200 dark:border-neutral-800 p-4 space-y-2"
      onSubmit={(e) => { e.preventDefault(); void onSave(form); }}
    >
      <h2 className="font-semibold text-lg">Eating goals</h2>
      <p className="text-sm opacity-70">Same goals feed the Dashboard and Insights. Stored on this laptop only.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">Meals per day
          <input aria-label="meals per day goal" type="number" min={0} className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900" value={val(form.mealsPerDay)} onChange={(e) => setForm({ ...form, mealsPerDay: num(e.target.value) })} />
        </label>
        <label className="text-sm">Vegetable meals / week
          <input aria-label="vegetable meals goal" type="number" min={0} className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900" value={val(form.vegMealsPerWeek)} onChange={(e) => setForm({ ...form, vegMealsPerWeek: num(e.target.value) })} />
        </label>
        <label className="text-sm">Home-cooked / week
          <input aria-label="home-cooked goal" type="number" min={0} className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900" value={val(form.cookTimesPerWeek)} onChange={(e) => setForm({ ...form, cookTimesPerWeek: num(e.target.value) })} />
        </label>
        <label className="text-sm">Water ml / day
          <input aria-label="water goal" type="number" min={0} className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900" value={val(form.waterMlPerDay)} onChange={(e) => setForm({ ...form, waterMlPerDay: num(e.target.value) })} />
        </label>
        <label className="text-sm">Max calories / day
          <input aria-label="max calories goal" type="number" min={0} className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900" value={val(form.maxCalories)} onChange={(e) => setForm({ ...form, maxCalories: num(e.target.value) })} />
        </label>
      </div>
      <button type="submit" className="rounded bg-green-700 px-4 py-2 text-white">Save goals</button>
    </form>
  );
}
