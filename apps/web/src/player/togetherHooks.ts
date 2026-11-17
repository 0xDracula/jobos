export type TogetherHandler = {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  next(): void;
  previous(): void;
  jumpTo(uid: string): void;
  playTracks(trackIds: string[], start: number): void;
  addToQueue(trackIds: string[]): void;
  playNext(trackIds: string[]): void;
  remove(uid: string): void;
  clear(): void;
  reorder(uids: string[]): void;
};

export const together: { handler: TogetherHandler | null } = { handler: null };
