"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Loading } from "@/components/common";
import { AlbumList, AlbumView } from "@/components/memories/Albums";

function Albums() {
  const params = useSearchParams();
  const id = params.get("id");
  if (id) return <AlbumView key={id} id={id} autoplay={params.get("slideshow") === "1"} />;
  return <AlbumList />;
}

export default function AlbumsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Albums />
    </Suspense>
  );
}
