import { useEffect, useState } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Home } from "./pages/Home";
import { Onboarding } from "./pages/Onboarding";
import { RecipeDetail } from "./pages/RecipeDetail";
import { Saved } from "./pages/Saved";
import { Settings } from "./pages/Settings";
import { Explorer } from "./pages/Explorer";
import { Inventory } from "./pages/Inventory";
import { Groceries } from "./pages/Groceries";
import { MealPlan } from "./pages/MealPlan";
import { api } from "./lib/api";
import { useOnlineStatus } from "./lib/useOnlineStatus";

export function App() {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    api.getProfile().then((p) => setTheme(p.theme)).catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
          <a
            href="#main"
            onClick={(e) => {
              // Move focus (not just scroll) so screen-reader and keyboard
              // users land in the main content.
              const main = document.getElementById("main");
              if (main) {
                e.preventDefault();
                main.focus({ preventScroll: false });
              }
            }}
            className="sr-only focus:not-sr-only focus:absolute focus:bg-white focus:p-2"
          >
            Skip to content
          </a>
          <nav className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-2 flex gap-4 text-sm" aria-label="main">
            <Link to="/" className="font-bold text-green-700 dark:text-green-400">Flavora</Link>
            <Link to="/">Assistant</Link>
            <Link to="/explorer">Explorer</Link>
            <Link to="/inventory">Inventory</Link>
            <Link to="/groceries">Groceries</Link>
            <Link to="/meal-plan">Meal plan</Link>
            <Link to="/saved">Saved</Link>
            <Link to="/settings">Settings</Link>
            <Link to="/onboarding" className="ml-auto opacity-70">Profile</Link>
          </nav>
          <SyncBanner />
          <main id="main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/recipe/:id" element={<RecipeDetail />} />
            <Route path="/saved" element={<Saved />} />
            <Route path="/settings" element={<Settings onTheme={setTheme} />} />
            <Route path="/explorer" element={<Explorer />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/groceries" element={<Groceries />} />
            <Route path="/meal-plan" element={<MealPlan />} />
          </Routes>
          </main>
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

function SyncBanner() {
  const { online, pending, syncState, syncNow } = useOnlineStatus();
  if (online && pending === 0 && syncState !== "syncing") return null;
  return (
    <div role="status" aria-live="polite" className="bg-amber-100 px-4 py-1 text-xs text-amber-900">
      {!online
        ? `Offline — ${pending} change(s) saved locally and will sync when connection returns.`
        : syncState === "syncing"
          ? "Syncing changes…"
          : syncState === "failed"
            ? "Some changes failed to sync. They stay saved locally — press Sync now to retry."
            : `${pending} change(s) pending sync.`}
      {online && pending > 0 && syncState !== "syncing" && (
        <button onClick={() => void syncNow()} className="ml-2 underline">Sync now</button>
      )}
    </div>
  );
}
