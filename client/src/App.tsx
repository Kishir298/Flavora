import { useEffect, useState } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Home } from "./pages/Home";
import { Onboarding } from "./pages/Onboarding";
import { RecipeDetail } from "./pages/RecipeDetail";
import { Saved } from "./pages/Saved";
import { Settings } from "./pages/Settings";
import { Explorer } from "./pages/Explorer";
import { api } from "./lib/api";

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
          <nav className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-2 flex gap-4 text-sm" aria-label="main">
            <Link to="/" className="font-bold text-green-700 dark:text-green-400">Flavora</Link>
            <Link to="/">Assistant</Link>
            <Link to="/explorer">Explorer</Link>
            <Link to="/saved">Saved</Link>
            <Link to="/settings">Settings</Link>
            <Link to="/onboarding" className="ml-auto opacity-70">Profile</Link>
          </nav>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/recipe/:id" element={<RecipeDetail />} />
            <Route path="/saved" element={<Saved />} />
            <Route path="/settings" element={<Settings onTheme={setTheme} />} />
            <Route path="/explorer" element={<Explorer />} />
          </Routes>
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
