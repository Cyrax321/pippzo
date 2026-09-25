import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { brandStore } from "./brand-store";
import { scheduleStore } from "./schedule-store";
import { competitorsStore } from "./competitors-store";

export type Workspace = { id: string; name: string; owner_id: string };

type Ctx = {
  user: User | null;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string) => void;
  status: "loading" | "anonymous" | "ready";
  refreshWorkspaces: () => Promise<void>;
};

const WorkspaceContext = createContext<Ctx | null>(null);
const ACTIVE_KEY = "sm.activeWorkspace";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, _setActive] = useState<string | null>(null);
  const [status, setStatus] = useState<Ctx["status"]>("loading");

  const setActiveWorkspaceId = (id: string) => {
    _setActive(id);
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* ignore */
    }
    brandStore.setWorkspace(id);
    scheduleStore.setWorkspace(id);
    competitorsStore.setWorkspace(id);
  };

  const loadWorkspaces = async (u: User) => {
    const { data, error } = await supabase
      .from("workspaces")
      .select("id,name,owner_id")
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[workspace] load failed", error);
      return [];
    }
    const ws = data as Workspace[];
    setWorkspaces(ws);
    if (ws.length === 0) {
      // Auto-create a personal workspace if the signup trigger failed.
      const { data: created } = await supabase
        .from("workspaces")
        .insert({ name: "Personal workspace", owner_id: u.id })
        .select("id,name,owner_id")
        .single();
      if (created) {
        await supabase.from("workspace_members").insert({
          workspace_id: created.id,
          user_id: u.id,
          role: "owner",
        });
        setWorkspaces([created as Workspace]);
        return [created as Workspace];
      }
    }
    return ws;
  };

  const refreshWorkspaces = async () => {
    if (!user) return;
    await loadWorkspaces(user);
  };

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const { data } = await supabase.auth.getSession();
      const u = data.session?.user ?? null;
      setUser(u);
      if (u) {
        const ws = await loadWorkspaces(u);
        let stored: string | null = null;
        try {
          stored = localStorage.getItem(ACTIVE_KEY);
        } catch {
          /* ignore */
        }
        const active = ws.find((w) => w.id === stored)?.id ?? ws[0]?.id ?? null;
        if (active) setActiveWorkspaceId(active);
        setStatus("ready");
      } else {
        setStatus("anonymous");
      }

      const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
        const u2 = session?.user ?? null;
        setUser(u2);
        if (u2) {
          const ws = await loadWorkspaces(u2);
          let stored: string | null = null;
          try {
            stored = localStorage.getItem(ACTIVE_KEY);
          } catch {
            /* ignore */
          }
          const active = ws.find((w) => w.id === stored)?.id ?? ws[0]?.id ?? null;
          if (active) setActiveWorkspaceId(active);
          setStatus("ready");
        } else {
          _setActive(null);
          setWorkspaces([]);
          brandStore.setWorkspace(null);
          scheduleStore.setWorkspace(null);
          competitorsStore.setWorkspace(null);
          setStatus("anonymous");
        }
      });
      unsub = () => sub.subscription.unsubscribe();
    })();
    return () => unsub();
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        user,
        workspaces,
        activeWorkspaceId,
        setActiveWorkspaceId,
        status,
        refreshWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
