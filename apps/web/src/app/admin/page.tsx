"use client";

import { useEffect, useState } from "react";

import { Content, RoomAdmin } from "@/components/admin/Content";
import { GiftAdmin } from "@/components/admin/Gift";
import { Library } from "@/components/admin/Library";
import { People } from "@/components/admin/People";
import { Sources } from "@/components/admin/Sources";
import { PageHero } from "@/components/sky/PageHero";
import { Empty } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useIsAdmin, useMe } from "@/lib/session";

const TABS = [
  ["people", "People"],
  ["library", "Library"],
  ["sources", "Sources"],
  ["content", "Content"],
  ["room", "Room"],
  ["gift", "Gift"],
] as const;

type Tab = (typeof TABS)[number][0];

const isTab = (s: string): s is Tab => TABS.some(([t]) => t === s);

export default function AdminPage() {
  const me = useMe();
  const admin = useIsAdmin();
  const [tab, setTab] = useState<Tab>("people");
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (isTab(h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const pick = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };
  if (me.isPending) return null;
  if (!admin) return <Empty>Admin only</Empty>;
  return (
    <>
      <PageHero title="Admin">
      <nav aria-label="Admin sections" className="no-scrollbar -mx-4 overflow-x-auto px-4">
        <div role="tablist" className="inline-flex gap-1 rounded-full border border-panel-line bg-panel p-1 shadow-soft">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => pick(t)}
              className={cn(
                "min-h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors",
                tab === t ? "bg-accent-strong text-on-accent" : "text-ink hover:bg-accent-soft/60",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      </PageHero>
      <div role="tabpanel">
        {tab === "people" && <People />}
        {tab === "library" && <Library />}
        {tab === "sources" && <Sources />}
        {tab === "content" && <Content />}
        {tab === "room" && <RoomAdmin />}
        {tab === "gift" && <GiftAdmin />}
      </div>
    </>
  );
}
