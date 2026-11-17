"use client";

import { Suspense } from "react";

import { Loading } from "@/components/common";
import { RecapsView } from "@/components/dates/RecapsView";

export default function RecapsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RecapsView />
    </Suspense>
  );
}
