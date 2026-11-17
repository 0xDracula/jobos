import type { Keepsake } from "@/components/Shelf";

import { DATE_KEEPSAKES } from "./dates";
import { LETTER_KEEPSAKES } from "./letters";
import { MEMORY_KEEPSAKES } from "./memories";

export const KEEPSAKE_GROUPS: { title: string; items: Keepsake[] }[] = [
  { title: "Letters and notes", items: LETTER_KEEPSAKES },
  { title: "Memories", items: MEMORY_KEEPSAKES },
  { title: "Dates", items: DATE_KEEPSAKES },
];
