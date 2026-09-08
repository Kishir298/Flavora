import { useEffect, useState } from "react";
import { api, type Profile } from "../lib/api";
import { ProfileForm } from "../components/ProfileForm";

export function Settings({ onTheme }: { onTheme: (t: string) => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
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
    <main className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm opacity-70">
        Preferences feed filtering and ranking. Learning starts from default weights and personalises after enough
        cooks/saves/skips (local only).
      </p>
      <div className="mt-4">
        <ProfileForm
          initial={profile}
          saving={saving}
          onSave={async (p) => {
            setSaving(true);
            setError("");
            try {
              const next = await api.saveProfile(p);
              setProfile(next);
              onTheme(next.theme);
              setMsg("Profile saved.");
            } catch {
              setError("Could not save profile.");
            } finally {
              setSaving(false);
            }
          }}
        />
      </div>
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
    </main>
  );
}
