import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Profile } from "../lib/api";
import { enqueueMutation, isNetworkError } from "../lib/mutationQueue";
import { ProfileForm } from "../components/ProfileForm";

export function Onboarding() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    api.getProfile().then(setProfile).catch(() => setProfile({
      allergies: [], avoidFoods: [], favoriteCuisines: [], spicePreference: "medium",
      skillLevel: "beginner", nutritionGoals: {}, preferredCookTimeMinutes: 30, theme: "light",
    }));
  }, []);

  if (!profile) return <p role="status" className="p-6">Loading…</p>;

  return (
<div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold">Welcome to Flavora</h1>
      <p className="mt-1 text-sm opacity-70">Tell us what you can’t eat and what you like. Everything stays on this device.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4">
        <ProfileForm
          initial={profile}
          saving={saving}
          onSave={async (p) => {
            setSaving(true);
            setError("");
            try {
              await api.saveProfile(p);
              nav("/");
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              if (isNetworkError(msg)) {
                await enqueueMutation({
                  operation: "profile.save",
                  entityType: "profile",
                  entityId: "local",
                  payload: p as Record<string, unknown>,
                });
                // Don't strand offline users on onboarding — profile syncs later.
                nav("/");
                return;
              }
              setError(e instanceof Error ? e.message : "Could not save profile.");
            } finally {
              setSaving(false);
            }
          }}
        />
      </div>
    </div>
  );
}
