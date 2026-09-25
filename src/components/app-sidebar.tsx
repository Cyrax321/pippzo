import { APP_NAME } from "@/lib/app-config";
import { useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useScheduledPosts } from "@/lib/schedule-store";
import { useWorkspace } from "@/lib/workspace";
import { supabase } from "@/integrations/supabase/client";
import {
  LogOut,
  Bot,
  CalendarDays,
  BarChart3,
  Palette,
  Settings2,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

type Child = { title: string; url: string };
type Section = {
  n: string;
  title: string;
  url: string;
  icon: LucideIcon;
  primary?: boolean;
  children?: Child[];
};

const sections: Section[] = [
  {
    n: "01",
    title: "Agent",
    url: "/chat",
    icon: Bot,
    primary: true,
    children: [
      { title: "Chat", url: "/chat" },
      { title: "Create post", url: "/crear" },
      { title: "Inbox", url: "/inbox" },
    ],
  },
  {
    n: "02",
    title: "Calendar",
    url: "/calendario",
    icon: CalendarDays,
    children: [
      { title: "Calendar", url: "/calendario" },
      { title: "Approvals", url: "/approvals" },
    ],
  },
  {
    n: "03",
    title: "Reports",
    url: "/reports",
    icon: BarChart3,
    children: [
      { title: "Performance", url: "/reports" },
      { title: "Activity log", url: "/logs" },
    ],
  },
  {
    n: "04",
    title: "Brand",
    url: "/marca",
    icon: Palette,
    children: [
      { title: "Brand profile", url: "/marca" },
      { title: "Guide", url: "/guia" },
      { title: "Competitors", url: "/competidores" },
      { title: "Library", url: "/library" },
    ],
  },
  {
    n: "05",
    title: "Settings",
    url: "/conexiones",
    icon: Settings2,
    children: [
      { title: "Connections", url: "/conexiones" },
      { title: "Automations", url: "/automations" },
    ],
  },
];

function weekRange() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - dow);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return [start.getTime(), end.getTime()] as const;
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const scheduled = useScheduledPosts();
  const { user, workspaces, activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);
  const [s, e] = weekRange();
  const weekCount = scheduled.filter(
    (p) =>
      p.status === "scheduled" && p.scheduledAt !== null && p.scheduledAt >= s && p.scheduledAt < e,
  ).length;

  const sectionOf = (path: string) =>
    sections.find((sec) => sec.url === path || sec.children?.some((c) => c.url === path));
  const activeSection = sectionOf(pathname);
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  const isOpen = (sec: Section) => manualOpen[sec.url] ?? activeSection?.url === sec.url;

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader
        className={`border-b border-sidebar-border ${collapsed ? "px-0 py-3" : "px-5 py-6"}`}
      >
        <Link
          to="/"
          className={`flex items-center gap-3 group overflow-hidden ${collapsed ? "justify-center" : ""}`}
        >
          <div className="h-9 w-9 shrink-0 border border-foreground grid place-items-center font-serif text-2xl leading-none">
            <span className="-mt-0.5">R</span>
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-none gap-1 min-w-0">
              <span className="font-serif text-xl truncate">{APP_NAME}</span>
              <span className="label-eyebrow !text-[0.625rem] truncate">Content · Studio</span>
            </div>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent className={collapsed ? "px-0 py-3" : "px-2 py-4"}>
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="label-eyebrow !px-3 mb-2">Index</SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {sections.map((sec) => {
                const sectionActive = activeSection?.url === sec.url;
                const exactActive = pathname === sec.url;
                const showBadge = sec.url === "/calendario" && weekCount > 0;
                const open = isOpen(sec);
                const Icon = sec.icon;
                return (
                  <SidebarMenuItem key={sec.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={sec.children ? exactActive : sectionActive}
                      tooltip={sec.title}
                      className={`h-9 rounded-none ${sec.primary ? "bg-foreground text-background hover:bg-foreground/90 hover:text-background data-[active=true]:bg-foreground data-[active=true]:text-background" : ""}`}
                    >
                      <Link
                        to={sec.url}
                        onClick={() => setManualOpen((m) => ({ ...m, [sec.url]: true }))}
                        className={`flex items-center gap-3 group overflow-hidden ${collapsed ? "justify-center px-0" : "px-3"}`}
                      >
                        {collapsed ? (
                          <Icon className="h-4 w-4 shrink-0" />
                        ) : (
                          <span
                            className={`font-mono text-[10px] tabular-nums shrink-0 ${sec.primary ? "text-background/60" : sectionActive ? "text-foreground" : "text-muted-foreground"}`}
                          >
                            {sec.n}
                          </span>
                        )}
                        {!collapsed && (
                          <>
                            <span
                              className={`flex-1 text-sm truncate ${sectionActive || sec.primary ? "font-medium" : ""}`}
                            >
                              {sec.title}
                            </span>
                            {showBadge && (
                              <span className="font-mono text-[10px] tabular-nums border border-border px-1.5 py-0.5 shrink-0">
                                {weekCount}
                              </span>
                            )}
                            {sec.children && (
                              <button
                                type="button"
                                aria-label={open ? `Collapse ${sec.title}` : `Expand ${sec.title}`}
                                onClick={(ev) => {
                                  ev.preventDefault();
                                  ev.stopPropagation();
                                  setManualOpen((m) => ({ ...m, [sec.url]: !open }));
                                }}
                                className="shrink-0 opacity-60 hover:opacity-100"
                              >
                                <ChevronRight
                                  className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
                                />
                              </button>
                            )}
                            {!sec.children && sectionActive && (
                              <span className="h-px w-3 bg-foreground shrink-0" />
                            )}
                          </>
                        )}
                      </Link>
                    </SidebarMenuButton>

                    {!collapsed && sec.children && open && (
                      <SidebarMenuSub className="mt-0.5 mr-0 border-l border-sidebar-border">
                        {sec.children.map((c) => (
                          <SidebarMenuSubItem key={c.url}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={pathname === c.url}
                              className="rounded-none"
                            >
                              <Link to={c.url} className="text-xs">
                                <span className="truncate">{c.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {!collapsed && (
        <div className="mt-auto border-t border-sidebar-border overflow-hidden">
          {user && (
            <div className="px-5 py-3 border-b border-sidebar-border">
              <p className="label-eyebrow !text-[0.625rem] truncate">
                {activeWs?.name ?? "Workspace"}
              </p>
              <div className="mt-1 flex items-center justify-between gap-2 min-w-0">
                <p className="text-xs truncate">{user.email}</p>
                <button
                  onClick={signOut}
                  title="Sign out"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
          <div className="px-5 py-4">
            <p className="label-eyebrow !text-[0.625rem]">Edition {new Date().getFullYear()}</p>
            <p className="mt-1 font-serif text-sm italic text-muted-foreground">
              «AI is only valuable when people trust it, use it, and can measure its impact.»
            </p>
          </div>
        </div>
      )}
    </Sidebar>
  );
}
