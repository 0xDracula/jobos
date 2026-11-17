"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Loading } from "@/components/common";
import { LetterEditor, LetterList, LetterView } from "@/components/letters/Letters";

function Letters() {
  const params = useSearchParams();
  const id = params.get("id");
  const edit = params.get("edit");
  if (edit) return <LetterEditor key={edit} id={edit === "new" ? null : edit} kind={params.get("kind")} />;
  if (id) return <LetterView id={id} />;
  return <LetterList initialTab={params.get("tab") === "written" ? "written" : null} />;
}

export default function LettersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Letters />
    </Suspense>
  );
}
