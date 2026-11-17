"use client";

import { Suspense } from "react";

import { Loading } from "@/components/common";
import { StoryBook } from "@/components/memories/StoryBook";

export default function StoryPage() {
  return (
    <Suspense fallback={<Loading />}>
      <StoryBook />
    </Suspense>
  );
}
