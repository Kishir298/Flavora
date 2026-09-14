import { useCallback, useEffect, useState } from "react";
import { api, type AppliedSub } from "./api";
import { enqueueMutation } from "./mutationQueue";
import { useOnlineStatus } from "./useOnlineStatus";

/** Applied substitutions per recipe — persisted server-side, mirrored locally. */
export function useSubstitutions(recipeId: string | undefined) {
  const [subs, setSubs] = useState<AppliedSub[]>([]);
  const [loading, setLoading] = useState(false);
  const { online } = useOnlineStatus();

  const refresh = useCallback(async () => {
    if (!recipeId) return;
    setLoading(true);
    try { setSubs(await api.listSubs(recipeId)); } catch { /* offline — keep local */ }
    finally { setLoading(false); }
  }, [recipeId]);

  useEffect(() => { refresh(); }, [refresh]);

  const apply = async (originalName: string, replacementName: string) => {
    if (!recipeId) return;
    // optimistic local mirror — keeps recipe detail, groceries, meal plans consistent offline
    setSubs((prev) => {
      const rest = prev.filter((s) => s.originalName.toLowerCase() !== originalName.toLowerCase());
      return [...rest, { recipeId, originalName, replacementName, safety: "unknown" }];
    });
    if (!online) {
      await enqueueMutation({
        operation: "sub.apply",
        entityType: "substitution",
        entityId: `${recipeId}||${originalName}`,
        payload: { recipeId, originalName, replacementName },
      });
      return { recipeId, originalName, replacementName, safety: "unknown" } as AppliedSub;
    }
    const res = await api.applySub({ recipeId, originalName, replacementName });
    setSubs((prev) => {
      const rest = prev.filter((s) => s.originalName.toLowerCase() !== originalName.toLowerCase());
      return [...rest, res];
    });
    return res;
  };

  const revert = async (originalName: string) => {
    if (!recipeId) return;
    setSubs((prev) => prev.filter((s) => s.originalName.toLowerCase() !== originalName.toLowerCase()));
    if (!online) {
      await enqueueMutation({
        operation: "sub.revert",
        entityType: "substitution",
        entityId: `${recipeId}||${originalName}`,
        payload: { recipeId, originalName },
      });
      return;
    }
    await api.revertSub({ recipeId, originalName });
  };

  return { subs, loading, refresh, apply, revert };
}
