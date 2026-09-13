import { useEffect, useState } from "react";
import { api, type InventoryItem } from "../lib/api";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { enqueueMutation } from "../lib/mutationQueue";

export function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("pieces");
  const [expiry, setExpiry] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { online, pending } = useOnlineStatus();

  const load = async () => {
    setLoading(true); setError(null);
    try { setItems(await api.inventory()); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load inventory."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const add = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setMsg(null);
    try {
      const body = { name, quantity: qty === "" ? null : Number(qty), unit, expiryDate: expiry || undefined };
      if (!online) {
        await enqueueMutation({ operation: "inventory.add", entityType: "inventory", entityId: name, payload: { name, quantity: body.quantity, unit } });
        setMsg("You're offline. Changes are saved locally and will sync when connection returns.");
      } else {
        await api.addInventory(body);
      }
      setName(""); setQty(""); setExpiry("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Add failed."); }
  };

  const consume = async (id: number) => {
    try { await api.consumeInventory(id, 1); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Consume failed."); }
  };
  const remove = async (id: number) => {
    try { await api.removeInventory(id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Remove failed."); }
  };

  const shown = items.filter((i) => !filter || i.name.includes(filter.toLowerCase()) || (i.status ?? "") === filter);
  const expiring = items.filter((i) => i.status === "expiring_soon" || i.status === "expired");

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-bold">Inventory</h1>
      {!online && <p role="status" className="mt-2 rounded bg-amber-100 px-3 py-2 text-sm">You&apos;re offline. Changes are saved locally and will sync when connection returns.{pending > 0 && ` (${pending} pending)`}</p>}
      {msg && <p role="status" className="mt-2 text-sm text-green-700">{msg}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}

      <form onSubmit={add} className="mt-4 flex flex-wrap gap-2" aria-label="add inventory item">
        <label className="text-sm">Ingredient
          <input aria-label="ingredient name" className="ml-1 rounded border px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="text-sm">Qty
          <input aria-label="quantity" type="number" min={0} className="ml-1 w-20 rounded border px-2 py-1" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="text-sm">Unit
          <select aria-label="unit" className="ml-1 rounded border px-2 py-1" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {["g","kg","ml","l","pieces","cup","tbsp","tsp"].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label className="text-sm">Expiry
          <input aria-label="expiry date" type="date" className="ml-1 rounded border px-2 py-1" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </label>
        <button type="submit" className="rounded bg-green-700 px-3 py-1 text-white">Add</button>
      </form>

      <div className="mt-4 flex gap-2 text-sm">
        <input aria-label="search inventory" placeholder="search or filter" className="rounded border px-2 py-1" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      {loading ? <p role="status" className="mt-4">Loading inventory…</p>
      : shown.length === 0 ? <p role="status" className="mt-4">You haven&apos;t added any ingredients yet.</p>
      : (
        <ul className="mt-4 space-y-2">
          {shown.map((i) => (
            <li key={i.id} className="flex items-center gap-3 rounded border px-3 py-2">
              <div className="flex-1">
                <strong>{i.name}</strong>
                <span className="ml-2 text-sm opacity-70">{i.quantity ?? "?"} {i.unit ?? ""} · {i.category} · {(i.status ?? "unknown").replace("_", " ")}</span>
              </div>
              <button onClick={() => consume(i.id)} className="rounded border px-2 py-1 text-sm" aria-label={`consume one ${i.name}`}>Use 1</button>
              <button onClick={() => remove(i.id)} className="rounded border px-2 py-1 text-sm" aria-label={`remove ${i.name}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {expiring.length > 0 && (
        <section aria-label="expiring soon" className="mt-6">
          <h2 className="font-semibold">Expiring soon ({expiring.length})</h2>
          <p className="text-sm opacity-70">Dates are your own estimates, not food-safety verdicts.</p>
        </section>
      )}
    </main>
  );
}
