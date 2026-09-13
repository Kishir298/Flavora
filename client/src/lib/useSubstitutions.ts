import { useCallback, useEffect, useState } from "react";
import { api, type AppliedSub } from "./api";

/** Applied substitutions per recipe — persisted server-side, mirrored locally. */
export function useSubstitutions(recipeId: string | undefined) {
  const [subs, setSubs] = useState<AppliedSub[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!recipeId) return;
    setLoading(true);
    try { setSubs(await api.listSubs(recipeId)); } catch { /* offline — keep local */ }
    finally { setLoading(false); }
  }, [recipeId]);

  useEffect(() => { refresh(); }, [refresh]);

  const apply = async (originalName: string, replacementName: string) => {
    if (!recipeId) return;
    const res = await api.applySub({ recipeId, originalName, replacementName });
    setSubs((prev) => {
      const rest = prev.filter((s) => s.originalName.toLowerCase() !== originalName.toLowerCase());
      return [...rest, res];
    });
    return res;
  };

  const revert = async (originalName: string) => {
    if (!recipeId) return;
    await api.revertSub({ recipeId, originalName });
    setSubs((prev) => prev.filter((s) => s.originalName.toLowerCase() !== originalName.toLowerCase()));
  };

  return { subs, loading, refresh, apply, revert };
}
