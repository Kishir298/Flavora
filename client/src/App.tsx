import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Home } from "./pages/Home";
import { Dashboard } from "./pages/Dashboard";
import { Meals } from "./pages/Meals";
import { Insights } from "./pages/Insights";
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
          <nav className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-2 flex gap-4 text-sm flex-wrap" aria-label="main">
            <Link to="/" className="font-bold text-green-700 dark:text-green-400">Flavora</Link>
            <NavItem to="/" label="Ask Flavora" end />
            <NavItem to="/dashboard" label="Dashboard" />
            <NavItem to="/meals" label="Meals" />
            <NavItem to="/insights" label="Insights" />
            <NavItem to="/explorer" label="Explorer" />
            <NavItem to="/inventory" label="Inventory" />
            <NavItem to="/groceries" label="Groceries" />
            <NavItem to="/meal-plan" label="Meal plan" />
            <NavItem to="/saved" label="Saved" />
            <NavItem to="/settings" label="Settings" />
            <NavItem to="/onboarding" label="Profile" className="ml-auto" />
          </nav>
          <SyncBanner />
          <main id="main" tabIndex={-1}>
          <Routes>
            {/* Primary UX is conversational: / is the chat, Dashboard lives at /dashboard. */}
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<Dashboard />} />
            {/* Back-compat: old /assistant links redirect to the new home. */}
            <Route path="/assistant" element={<Navigate to="/" replace />} />
            <Route path="/meals" element={<Meals />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/recipe/:id" element={<RecipeDetail />} />
            <Route path="/saved" element={<Saved />} />
            <Route path="/settings" element={<Settings onTheme={setTheme} />} />
            <Route path="/explorer" element={<Explorer />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/groceries" element={<Groceries />} />
            <Route path="/meal-plan" element={<MealPlan />} />
            <Route
              path="*"
              element={
                <div className="p-6 max-w-2xl mx-auto">
                  <h1 className="text-2xl font-bold">Page not found</h1>
                  <p className="mt-1 text-sm opacity-70">
                    That page doesn&apos;t exist. <Link to="/" className="underline text-green-700 dark:text-green-400">Ask Flavora what to eat</Link> or pick a section above.
                  </p>
                </div>
              }
            />
          </Routes>
          </main>
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

function NavItem({ to, label, end, className }: { to: string; label: string; end?: boolean; className?: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `${className ?? ""} ${isActive ? "font-semibold underline underline-offset-4" : "opacity-80"}`}
    >
      {label}
    </NavLink>
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
