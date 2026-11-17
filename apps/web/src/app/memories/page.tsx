"use client";

import { Suspense } from "react";

import { Loading } from "@/components/common";
import { Corkboard } from "@/components/memories/Corkboard";

export default function MemoriesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Corkboard />
    </Suspense>
  );
}
