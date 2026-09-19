import { useEffect, useMemo, useRef, useState } from "react";
import { api, type InventoryItem } from "../lib/api";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { enqueueMutation } from "../lib/mutationQueue";

type SortKey = "name" | "expiry" | "status";

function statusRank(s?: string) {
  switch (s) {
    case "expired": return 0;
    case "expiring_soon": return 1;
    case "fresh": return 2;
    default: return 3; // unknown last
  }
}

function daysLabel(it: InventoryItem): string {
  if (it.status === "unknown" || it.daysRemaining == null) return "no expiry recorded";
  const d = it.daysRemaining;
  if (d < 0) return `expired ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ago`;
  if (d === 0) return "expires today";
  return `expires in ${d} day${d === 1 ? "" : "s"}`;
}

export function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("pieces");
  const [expiry, setExpiry] = useState("");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("expiry");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // edit state
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editUnit, setEditUnit] = useState("pieces");
  const [editExpiry, setEditExpiry] = useState("");
  const editNameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editId != null) editNameRef.current?.focus();
  }, [editId]);
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
    setError(null);
    const body = { name, quantity: qty === "" ? null : Number(qty), unit, expiryDate: expiry || undefined };
    try {
      await api.addInventory(body);
    } catch {
      // Offline or server-down: queue with full payload (incl. expiryDate)
      // so online/offline behavior matches; executor forwards expiryDate.
      await enqueueMutation({
        operation: "inventory.add",
        entityType: "inventory",
        entityId: name,
        payload: { name, quantity: body.quantity, unit, expiryDate: expiry || undefined },
      });
      setMsg("You're offline. Changes are saved locally and will sync when connection returns.");
    }
    try {
      setName(""); setQty(""); setExpiry("");
      await load();
    } catch {
      /* keep queued message offline */
    }
  };

  const startEdit = (it: InventoryItem) => {
    setEditId(it.id);
    setEditName(it.name);
    setEditQty(it.quantity != null ? String(it.quantity) : "");
    setEditUnit(it.unit ?? "pieces");
    setEditExpiry(it.expiryDate ? it.expiryDate.slice(0, 10) : "");
  };

  const cancelEdit = () => setEditId(null);

  const saveEdit = async (it: InventoryItem) => {
    const body = {
      name: editName,
      quantity: editQty === "" ? null : Number(editQty),
      unit: editUnit,
      expiryDate: editExpiry || null,
    };
    try {
      await api.updateInventory(it.id, body);
    } catch {
      await enqueueMutation({ operation: "inventory.update", entityType: "inventory", entityId: String(it.id), payload: { id: it.id, ...body } });
      setMsg("You're offline. Changes are saved locally and will sync when connection returns.");
    }
    try {
      setEditId(null);
      await load();
    } catch {
      /* keep queued message */
    }
  };

  const consume = async (id: number) => {
    try {
      await api.consumeInventory(id, 1);
    } catch {
      await enqueueMutation({ operation: "inventory.consume", entityType: "inventory", entityId: String(id), payload: { id, amount: 1 } });
      setMsg("You're offline. Changes are saved locally and will sync when connection returns.");
    }
    try {
      await load();
    } catch {
      /* offline */
    }
  };
  const remove = async (id: number) => {
    try {
      await api.removeInventory(id);
    } catch {
      await enqueueMutation({ operation: "inventory.remove", entityType: "inventory", entityId: String(id), payload: { id } });
      setMsg("You're offline. Changes are saved locally and will sync when connection returns.");
    }
    try {
      await load();
    } catch {
      /* offline */
    }
  };

  const shown = useMemo(() => {
    const filtered = items.filter((i) => !filter || i.name.toLowerCase().includes(filter.toLowerCase()) || (i.status ?? "") === filter);
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "status") return statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name);
      // expiry: unknown/no-date items last, then ascending days remaining
      const da = a.daysRemaining ?? Number.POSITIVE_INFINITY;
      const db = b.daysRemaining ?? Number.POSITIVE_INFINITY;
      return da - db || a.name.localeCompare(b.name);
    });
    return sorted;
  }, [items, filter, sort]);

  const expiring = items.filter((i) => i.status === "expiring_soon" || i.status === "expired");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
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

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <input aria-label="search inventory" placeholder="search or filter" className="rounded border px-2 py-1" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label>Sort
          <select aria-label="sort inventory" className="ml-1 rounded border px-2 py-1" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="expiry">by expiry (soonest first)</option>
            <option value="status">by status (expired first)</option>
            <option value="name">by name</option>
          </select>
        </label>
      </div>

      {loading ? <p role="status" className="mt-4">Loading inventory…</p>
      : shown.length === 0 ? <p role="status" className="mt-4">You haven&apos;t added any ingredients yet.</p>
      : (
        <ul className="mt-4 space-y-2">
          {shown.map((i) => (
            <li key={i.id} className="rounded border px-3 py-2">
              {editId === i.id ? (
                <form onSubmit={(ev) => { ev.preventDefault(); void saveEdit(i); }} className="flex flex-wrap items-end gap-2" aria-label={`edit ${i.name}`}>
                  <label className="text-sm">Ingredient
                    <input ref={editNameRef} aria-label={`edit ingredient name for ${i.name}`} className="ml-1 rounded border px-2 py-1" value={editName} onChange={(e) => setEditName(e.target.value)} required />
                  </label>
                  <label className="text-sm">Qty
                    <input aria-label={`edit quantity for ${i.name}`} type="number" min={0} className="ml-1 w-20 rounded border px-2 py-1" value={editQty} onChange={(e) => setEditQty(e.target.value)} />
                  </label>
                  <label className="text-sm">Unit
                    <select aria-label={`edit unit for ${i.name}`} className="ml-1 rounded border px-2 py-1" value={editUnit} onChange={(e) => setEditUnit(e.target.value)}>
                      {["g","kg","ml","l","pieces","cup","tbsp","tsp"].map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">Expiry
                    <input aria-label={`edit expiry date for ${i.name}`} type="date" className="ml-1 rounded border px-2 py-1" value={editExpiry} onChange={(e) => setEditExpiry(e.target.value)} />
                  </label>
                  <button type="submit" className="rounded bg-green-700 px-2 py-1 text-sm text-white">Save</button>
                  <button type="button" onClick={cancelEdit} className="rounded border px-2 py-1 text-sm">Cancel</button>
                </form>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <strong>{i.name}</strong>
                    <span className="ml-2 text-sm opacity-70">{i.quantity ?? "?"} {i.unit ?? ""} · {i.category} · {(i.status ?? "unknown").replace("_", " ")} · {daysLabel(i)}</span>
                  </div>
                  <button onClick={() => startEdit(i)} className="rounded border px-2 py-1 text-sm" aria-label={`edit ${i.name}`}>Edit</button>
                  <button onClick={() => void consume(i.id)} className="rounded border px-2 py-1 text-sm" aria-label={`consume one ${i.name}`}>Use 1</button>
                  <button onClick={() => void remove(i.id)} className="rounded border px-2 py-1 text-sm" aria-label={`remove ${i.name}`}>Remove</button>
                </div>
              )}
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
    </div>
  );
}
