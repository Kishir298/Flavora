import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Profile } from "../lib/api";
import { ProfileForm } from "../components/ProfileForm";

export function Onboarding() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    api.getProfile().then(setProfile).catch(() => setProfile({
      allergies: [], avoidFoods: [], favoriteCuisines: [], spicePreference: "medium",
      skillLevel: "beginner", nutritionGoals: {}, preferredCookTimeMinutes: 30, theme: "light",
    }));
  }, []);

  if (!profile) return <p className="p-6">Loading…</p>;

  return (
    <main className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold">Welcome to Flavora</h1>
      <p className="mt-1 text-sm opacity-70">Tell us what you can’t eat and what you like. Everything stays on this device.</p>
      <div className="mt-4">
        <ProfileForm
          initial={profile}
          saving={saving}
          onSave={async (p) => {
            setSaving(true);
            try {
              await api.saveProfile(p);
              nav("/");
            } finally {
              setSaving(false);
            }
          }}
        />
      </div>
    </main>
  );
}
