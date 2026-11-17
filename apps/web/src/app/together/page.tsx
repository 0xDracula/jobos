"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Loading } from "@/components/common";
import { SessionsHome } from "@/components/together/SessionsHome";
import { SessionView } from "@/components/together/SessionView";

function Together() {
  const id = useSearchParams().get("id");
  return id ? <SessionView key={id} id={id} /> : <SessionsHome />;
}

export default function TogetherPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Together />
    </Suspense>
  );
}
