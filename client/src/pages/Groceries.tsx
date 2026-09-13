import { useEffect, useState } from "react";
import { api, type GroceryItem } from "../lib/api";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { enqueueMutation } from "../lib/mutationQueue";

export function Groceries() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { online, pending } = useOnlineStatus();

  const load = async () => {
    setLoading(true); setError(null);
    try { setItems(await api.groceries()); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load grocery list."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const add = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      if (!online) {
        await enqueueMutation({ operation: "grocery.add", entityType: "grocery", entityId: name, payload: { name } });
      } else await api.addGrocery({ name });
      setName("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Add failed."); }
  };

  const toggle = async (it: GroceryItem) => {
    // optimistic UI
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, checked: !x.checked } : x)));
    try {
      if (!online) await enqueueMutation({ operation: "grocery.check", entityType: "grocery", entityId: String(it.id), payload: { id: it.id, checked: !it.checked } });
      else await api.updateGrocery(it.id, { checked: !it.checked });
    } catch { await load(); }
  };

  const groups = new Map<string, GroceryItem[]>();
  for (const it of items) {
    if (!groups.has(it.category)) groups.set(it.category, []);
    groups.get(it.category)!.push(it);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold">Grocery list</h1>
      {!online && <p role="status" className="mt-2 rounded bg-amber-100 px-3 py-2 text-sm">You&apos;re offline. Changes are saved locally and will sync when connection returns.{pending > 0 && ` (${pending} pending)`}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <form onSubmit={add} className="mt-4 flex gap-2" aria-label="add grocery item">
        <input aria-label="grocery item name" className="flex-1 rounded border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required placeholder="tomatoes" />
        <button className="rounded bg-green-700 px-3 py-2 text-white">Add</button>
      </form>
      {loading ? <p role="status" className="mt-4">Loading groceries…</p>
      : items.length === 0 ? <p role="status" className="mt-4">Your grocery list is empty.</p>
      : [...groups.entries()].map(([cat, list]) => (
        <section key={cat} aria-label={cat} className="mt-4">
          <h2 className="font-semibold capitalize">{cat}</h2>
          <ul className="mt-1 space-y-1">
            {list.map((it) => (
              <li key={it.id} className="flex items-center gap-2 rounded border px-3 py-2">
                <input type="checkbox" aria-label={`check ${it.name}`} checked={it.checked} onChange={() => toggle(it)} />
                <span className={it.checked ? "line-through opacity-60" : ""}>{it.name}{it.quantity != null && ` — ${it.quantity} ${it.unit ?? ""}`}{it.note && ` (${it.note})`}</span>
                {it.recipeIds.length > 0 && <span className="ml-auto text-xs opacity-60">from {it.recipeIds.length} recipe(s)</span>}
                <button onClick={() => api.removeGrocery(it.id).then(load)} className="rounded border px-2 py-1 text-xs" aria-label={`remove ${it.name}`}>Remove</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {items.some((i) => i.checked) && (
        <button onClick={() => api.clearGroceryCompleted().then(load)} className="mt-4 rounded border px-3 py-1 text-sm">Clear completed</button>
      )}
    </main>
  );
}
