"use client";

import { HeartOff, MessageCircleHeart } from "lucide-react";
import { useRouter } from "next/navigation";

import { MenuItem } from "@/components/ui";
import { memoriesApi, memoryKeys, useCollections } from "@/lib/memories";
import { queryClient } from "@/lib/queries";
import { useMe } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

export function MemoryMenuItems({ track }: { track: Track }) {
  const me = useMe().data;
  const collections = useCollections();
  const router = useRouter();
  const mine = collections.data?.find((i) => i.user_id === me?.id && i.track_id === track.id);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: memoryKeys.collections });
  if (mine) {
    return (
      <MenuItem
        icon={<HeartOff />}
        onSelect={async () => {
          try {
            await memoriesApi.removeFromCollection(mine.id);
            refresh();
            toast("Removed from Reminds me of you");
          } catch {
            toast("Not removed");
          }
        }}
      >
        Remove from Reminds me of you
      </MenuItem>
    );
  }
  return (
    <MenuItem
      icon={<MessageCircleHeart />}
      onSelect={async () => {
        try {
          await memoriesApi.addToCollection(track.id);
          refresh();
          toast("Added to Reminds me of you", { label: "Open", run: () => router.push("/reminds/") });
        } catch {
          toast("Not added");
        }
      }}
    >
      Reminds me of you
    </MenuItem>
  );
}
