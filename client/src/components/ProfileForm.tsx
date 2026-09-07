import { useState } from "react";
import type { Profile } from "../lib/api";

export const ALL_CUISINES = [
  "italian",
  "indian",
  "chinese",
  "japanese",
  "mexican",
  "french",
  "american",
  "mediterranean",
  "middle eastern",
  "african",
];

/** Shared profile form used by Onboarding + Settings. Keyboard-navigable, labeled. */
export function ProfileForm({
  initial,
  onSave,
  saving,
}: {
  initial: Profile;
  onSave: (p: Partial<Profile>) => Promise<void> | void;
  saving?: boolean;
}) {
  const [allergies, setAllergies] = useState(initial.allergies.join(", "));
  const [avoidFoods, setAvoidFoods] = useState(initial.avoidFoods.join(", "));
  const [favoriteCuisines, setFavoriteCuisines] = useState<string[]>(initial.favoriteCuisines);
  const [spicePreference, setSpicePreference] = useState<Profile["spicePreference"]>(initial.spicePreference);
  const [skillLevel, setSkillLevel] = useState(initial.skillLevel);
  const [preferredCookTimeMinutes, setPreferredCookTimeMinutes] = useState(initial.preferredCookTimeMinutes);
  const [maxCalories, setMaxCalories] = useState(initial.nutritionGoals?.maxCalories?.toString() ?? "");
  const [highProtein, setHighProtein] = useState(!!initial.nutritionGoals?.highProtein);

  const split = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

  return (
    <form
      aria-label="profile-form"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          allergies: split(allergies),
          avoidFoods: split(avoidFoods),
          favoriteCuisines,
          spicePreference: spicePreference as Profile["spicePreference"],
          skillLevel,
          preferredCookTimeMinutes: Number(preferredCookTimeMinutes),
          nutritionGoals: {
            highProtein,
            ...(maxCalories ? { maxCalories: Number(maxCalories) } : {}),
          },
        });
      }}
    >
      <div>
        <label htmlFor="allergies" className="block text-sm font-medium">Allergies (comma-separated, absolute exclusions)</label>
        <input id="allergies" className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700" value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="peanut, milk" />
      </div>
      <div>
        <label htmlFor="avoid" className="block text-sm font-medium">Foods to avoid</label>
        <input id="avoid" className="mt-1 w-full rounded border px-3 py-2 bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700" value={avoidFoods} onChange={(e) => setAvoidFoods(e.target.value)} placeholder="pork, cilantro" />
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Favorite cuisines</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {ALL_CUISINES.map((c) => (
            <label key={c} className="text-sm flex items-center gap-1 border rounded px-2 py-1 cursor-pointer capitalize">
              <input
                type="checkbox"
                checked={favoriteCuisines.includes(c)}
                onChange={() => setFavoriteCuisines((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))}
              />
              {c}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-4 flex-wrap">
        <div>
          <label htmlFor="spice" className="block text-sm font-medium">Spice preference</label>
          <select id="spice" className="mt-1 rounded border px-2 py-2 bg-white dark:bg-neutral-900" value={spicePreference} onChange={(e) => setSpicePreference(e.target.value as Profile["spicePreference"])}>
            <option value="mild">mild</option>
            <option value="medium">medium</option>
            <option value="hot">hot</option>
          </select>
        </div>
        <div>
          <label htmlFor="skill" className="block text-sm font-medium">Cooking skill</label>
          <select id="skill" className="mt-1 rounded border px-2 py-2 bg-white dark:bg-neutral-900" value={skillLevel} onChange={(e) => setSkillLevel(e.target.value)}>
            <option value="beginner">beginner</option>
            <option value="intermediate">intermediate</option>
            <option value="advanced">advanced</option>
          </select>
        </div>
        <div>
          <label htmlFor="time" className="block text-sm font-medium">Preferred cook time (min)</label>
          <input id="time" type="number" min={5} max={180} className="mt-1 rounded border px-2 py-2 w-28 bg-white dark:bg-neutral-900" value={preferredCookTimeMinutes} onChange={(e) => setPreferredCookTimeMinutes(Number(e.target.value))} />
        </div>
        <div>
          <label htmlFor="cals" className="block text-sm font-medium">Max calories (optional)</label>
          <input id="cals" type="number" min={100} className="mt-1 rounded border px-2 py-2 w-28 bg-white dark:bg-neutral-900" value={maxCalories} onChange={(e) => setMaxCalories(e.target.value)} placeholder="600" />
        </div>
      </div>
      <label className="text-sm flex items-center gap-2">
        <input type="checkbox" checked={highProtein} onChange={(e) => setHighProtein(e.target.checked)} />
        High-protein goal
      </label>
      <button type="submit" disabled={saving} className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50">
        {saving ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
