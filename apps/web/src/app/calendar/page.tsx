"use client";

import { Suspense } from "react";

import { Loading } from "@/components/common";
import { CalendarView } from "@/components/dates/CalendarView";

export default function CalendarPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CalendarView />
    </Suspense>
  );
}
