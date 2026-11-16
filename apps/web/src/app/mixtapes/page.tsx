"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Loading } from "@/components/common";
import { MixtapeEditor, MixtapeList, MixtapeView } from "@/components/mixtapes/Mixtapes";

function Mixtapes() {
  const params = useSearchParams();
  const id = params.get("id");
  const edit = params.get("edit");
  if (edit) return <MixtapeEditor id={edit === "new" ? null : edit} />;
  if (id) return <MixtapeView id={id} />;
  return <MixtapeList />;
}

export default function MixtapesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Mixtapes />
    </Suspense>
  );
}
