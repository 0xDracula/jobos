"use client";

import Link from "next/link";

import { Loading } from "@/components/common";
import { PastQuestion, TodayQuestion } from "@/components/question/DailyQuestion";
import { PageHero } from "@/components/sky/PageHero";
import { Empty, SectionTitle } from "@/components/ui";
import { useQuestion } from "@/lib/profiles";
import { useIsAdmin } from "@/lib/session";

export default function QuestionPage() {
  const q = useQuestion();
  const admin = useIsAdmin();
  const next = q.data ? new Date(q.data.next_at) : null;
  return (
    <div className="grid gap-8">
      <PageHero
        title="Daily question"
        meta={next ? `Next at ${next.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : undefined}
        actions={
          admin ? (
            <Link href="/admin/#content" className="rounded-full bg-panel px-4 py-2 text-sm font-bold shadow-soft">
              Questions
            </Link>
          ) : undefined
        }
      />
      {q.isPending ? (
        <Loading />
      ) : q.data?.today ? (
        <TodayQuestion key={`${q.data.today.id}-${q.data.today.mine?.updated_at ?? ""}`} q={q.data.today} />
      ) : (
        <Empty>No question today</Empty>
      )}
      {!!q.data?.history.length && (
        <section>
          <SectionTitle>Before</SectionTitle>
          <ul className="grid gap-3">
            {q.data.history.map((h) => (
              <PastQuestion key={h.id} q={h} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
