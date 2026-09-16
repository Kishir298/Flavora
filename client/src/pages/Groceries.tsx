import { useEffect, useState } from "react";
import { api, type GroceryItem } from "../lib/api";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { enqueueMutation } from "../lib/mutationQueue";

export function Groceries() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("pieces");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // edit state
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editUnit, setEditUnit] = useState("pieces");
  const [removedItems, setRemovedItems] = useState<GroceryItem[]>([]);
  const { online, pending } = useOnlineStatus();

  const load = async () => {
    setLoading(true); setError(null);
    try {
      setItems(await api.groceries());
      try { setRemovedItems((await api.groceries(true)).filter((g) => g.removed).slice(0, 10)); }
      catch { /* optional */ }
    }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load grocery list."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const add = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    try {
      const payload = { name, quantity: qty === "" ? null : Number(qty), unit };
      if (!online) {
        await enqueueMutation({ operation: "grocery.add", entityType: "grocery", entityId: name, payload });
        setMsg("You're offline. Changes are saved locally and will sync when connection returns.");
      } else {
        await api.addGrocery(payload);
      }
      setName(""); setQty("");
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

  const startEdit = (it: GroceryItem) => {
    setEditId(it.id);
    setEditName(it.name);
    setEditQty(it.quantity != null ? String(it.quantity) : "");
    setEditUnit(it.unit ?? "pieces");
  };

  const saveEdit = async (it: GroceryItem) => {
    const body = { name: editName, quantity: editQty === "" ? null : Number(editQty), unit: editUnit };
    try {
      if (!online) {
        await enqueueMutation({ operation: "grocery.update", entityType: "grocery", entityId: String(it.id), payload: { id: it.id, ...body } });
        setMsg("You're offline. Changes are saved locally and will sync when connection returns.");
      } else {
        await api.updateGrocery(it.id, body);
      }
      setEditId(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Update failed."); }
  };

  const remove = async (it: GroceryItem) => {
    // optimistic removal
    setItems((prev) => prev.filter((x) => x.id !== it.id));
    try {
      if (!online) await enqueueMutation({ operation: "grocery.remove", entityType: "grocery", entityId: String(it.id), payload: { id: it.id } });
      else await api.removeGrocery(it.id);
      await load();
    } catch { await load(); }
  };

  const restore = async (it: GroceryItem) => {
    try {
      if (!online) await enqueueMutation({ operation: "grocery.remove", entityType: "grocery", entityId: String(it.id), payload: { id: it.id, restore: true } });
      else await api.removeGrocery(it.id, true);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Restore failed."); }
  };

  const groups = new Map<string, GroceryItem[]>();
  for (const it of items) {
    if (!groups.has(it.category)) groups.set(it.category, []);
    groups.get(it.category)!.push(it);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold">Grocery list</h1>
      {!online && <p role="status" className="mt-2 rounded bg-amber-100 px-3 py-2 text-sm">You&apos;re offline. Changes are saved locally and will sync when connection returns.{pending > 0 && ` (${pending} pending)`}</p>}
      {msg && <p role="status" className="mt-2 text-sm text-green-700">{msg}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <form onSubmit={add} className="mt-4 flex flex-wrap gap-2" aria-label="add grocery item">
        <input aria-label="grocery item name" className="rounded border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required placeholder="tomatoes" />
        <label className="text-sm">Qty
          <input aria-label="grocery quantity" type="number" min={0} className="ml-1 w-20 rounded border px-2 py-1" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="text-sm">Unit
          <select aria-label="grocery unit" className="ml-1 rounded border px-2 py-1" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {["g","kg","ml","l","pieces","cup","tbsp","tsp"].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <button className="rounded bg-green-700 px-3 py-2 text-white">Add</button>
      </form>
      {loading ? <p role="status" className="mt-4">Loading groceries…</p>
      : items.length === 0 ? <p role="status" className="mt-4">Your grocery list is empty.</p>
      : [...groups.entries()].map(([cat, list]) => (
        <section key={cat} aria-label={cat} className="mt-4">
          <h2 className="font-semibold capitalize">{cat}</h2>
          <ul className="mt-1 space-y-1">
            {list.map((it) => (
              <li key={it.id} className="rounded border px-3 py-2">
                {editId === it.id ? (
                  <form onSubmit={(ev) => { ev.preventDefault(); void saveEdit(it); }} className="flex flex-wrap items-end gap-2" aria-label={`edit ${it.name}`}>
                    <label className="text-sm">Name
                      <input aria-label={`edit name for ${it.name}`} className="ml-1 rounded border px-2 py-1" value={editName} onChange={(e) => setEditName(e.target.value)} required />
                    </label>
                    <label className="text-sm">Qty
                      <input aria-label={`edit quantity for ${it.name}`} type="number" min={0} className="ml-1 w-20 rounded border px-2 py-1" value={editQty} onChange={(e) => setEditQty(e.target.value)} />
                    </label>
                    <label className="text-sm">Unit
                      <select aria-label={`edit unit for ${it.name}`} className="ml-1 rounded border px-2 py-1" value={editUnit} onChange={(e) => setEditUnit(e.target.value)}>
                        {["g","kg","ml","l","pieces","cup","tbsp","tsp"].map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </label>
                    <button type="submit" className="rounded bg-green-700 px-2 py-1 text-sm text-white">Save</button>
                    <button type="button" onClick={() => setEditId(null)} className="rounded border px-2 py-1 text-sm">Cancel</button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <input type="checkbox" aria-label={`check ${it.name}`} checked={it.checked} onChange={() => void toggle(it)} />
                    <span className={it.checked ? "line-through opacity-60" : ""}>{it.name}{it.quantity != null && ` — ${it.quantity} ${it.unit ?? ""}`}{it.note && ` (${it.note})`}</span>
                    {it.recipeIds.length > 0 && <span className="ml-auto text-xs opacity-60">from {it.recipeIds.length} recipe(s)</span>}
                    <button onClick={() => startEdit(it)} className="rounded border px-2 py-1 text-xs" aria-label={`edit ${it.name}`}>Edit</button>
                    <button onClick={() => void remove(it)} className="rounded border px-2 py-1 text-xs" aria-label={`remove ${it.name}`}>Remove</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {items.some((i) => i.checked) && (
        <button
          onClick={() => {
            if (!online) void enqueueMutation({ operation: "grocery.clearCompleted", entityType: "grocery", entityId: "all", payload: {} }).then(load);
            else api.clearGroceryCompleted().then(load);
          }}
          className="mt-4 rounded border px-3 py-1 text-sm"
        >
          Clear completed
        </button>
      )}
      {removedItems.length > 0 && (
        <section aria-label="recently removed" className="mt-6">
          <h2 className="font-semibold">Recently removed</h2>
          <ul className="mt-1 space-y-1 text-sm">
            {removedItems.map((it) => (
              <li key={it.id} className="flex items-center gap-2">
                <span className="opacity-70">{it.name}</span>
                <button onClick={() => void restore(it)} className="rounded border px-2 py-0.5 text-xs" aria-label={`restore ${it.name}`}>Restore</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
