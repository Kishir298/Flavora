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
    const prev = subs;
    // optimistic local mirror — keeps recipe detail, groceries, meal plans consistent offline
    setSubs((prevSubs) => {
      const rest = prevSubs.filter((s) => s.originalName.toLowerCase() !== originalName.toLowerCase());
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
    try {
      const res = await api.applySub({ recipeId, originalName, replacementName });
      setSubs((prevSubs) => {
        const rest = prevSubs.filter((s) => s.originalName.toLowerCase() !== originalName.toLowerCase());
        return [...rest, res];
      });
      return res;
    } catch (e) {
      // Roll back optimistic UI on rejection (e.g. UNSAFE_SUBSTITUTION 400);
      // offline/network failures queue instead.
      const msg = e instanceof Error ? e.message : String(e);
      if (/failed to fetch|network|offline|load failed/i.test(msg)) {
        await enqueueMutation({
          operation: "sub.apply",
          entityType: "substitution",
          entityId: `${recipeId}||${originalName}`,
          payload: { recipeId, originalName, replacementName },
        });
        return { recipeId, originalName, replacementName, safety: "unknown" } as AppliedSub;
      }
      setSubs(prev);
      throw e;
    }
  };

  const revert = async (originalName: string) => {
    if (!recipeId) return;
    const prev = subs;
    setSubs((prevSubs) => prevSubs.filter((s) => s.originalName.toLowerCase() !== originalName.toLowerCase()));
    if (!online) {
      await enqueueMutation({
        operation: "sub.revert",
        entityType: "substitution",
        entityId: `${recipeId}||${originalName}`,
        payload: { recipeId, originalName },
      });
      return;
    }
    try {
      await api.revertSub({ recipeId, originalName });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/failed to fetch|network|offline|load failed/i.test(msg)) {
        await enqueueMutation({
          operation: "sub.revert",
          entityType: "substitution",
          entityId: `${recipeId}||${originalName}`,
          payload: { recipeId, originalName },
        });
        return;
      }
      setSubs(prev);
      throw e;
    }
  };

  return { subs, loading, refresh, apply, revert };
}
