"use client";

import { Suspense } from "react";

import { Loading } from "@/components/common";
import { Places } from "@/components/memories/Places";

export default function PlacesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Places />
    </Suspense>
  );
}
