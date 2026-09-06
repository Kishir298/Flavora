import { useEffect, useState } from "react";
import { api, type Profile } from "../lib/api";
import { ProfileForm } from "../components/ProfileForm";

export function Settings({ onTheme }: { onTheme: (t: string) => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.getProfile().then((p) => {
      setProfile(p);
      onTheme(p.theme);
    }).catch(() => {});
  }, [onTheme]);

  if (!profile) return <p className="p-6">Loading…</p>;

  return (
    <main className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="mt-4">
        <ProfileForm
          initial={profile}
          saving={saving}
          onSave={async (p) => {
            setSaving(true);
            try {
              const next = await api.saveProfile(p);
              setProfile(next);
              onTheme(next.theme);
              setMsg("Saved.");
            } finally {
              setSaving(false);
            }
          }}
        />
      </div>
      <div className="mt-6 space-y-2">
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded border text-sm" onClick={() => {
            const next = profile.theme === "dark" ? "light" : "dark";
            api.saveProfile({ theme: next }).then((p) => {
              setProfile(p);
              onTheme(p.theme);
            }).catch(() => {});
          }}>
            Toggle dark / light (now: {profile.theme})
          </button>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded border text-sm" onClick={() => api.seed().then(() => setMsg("Seeded demo data."))}>
            Load demo data
          </button>
          <button className="px-3 py-2 rounded border text-sm text-red-600" onClick={() => {
            if (confirm("Reset all local data?")) api.reset().then(() => setMsg("Reset done."));
          }}>
            Reset all data
          </button>
        </div>
        {msg && <p className="text-sm text-green-700">{msg}</p>}
      </div>
    </main>
  );
}
