"use client";

import { useQuery } from "@tanstack/react-query";

import { json, request } from "./api";
import { queryClient } from "./queries";
import { on } from "./realtime";
import type { Track } from "./types";

export type MoodKey = "happy" | "calm" | "tired" | "sad" | "stressed" | "excited" | "missing_you" | "sick";

export const MOODS: { key: MoodKey; label: string; emoji: string; color: string }[] = [
  { key: "happy", label: "Happy", emoji: "😊", color: "#ffd23f" },
  { key: "calm", label: "Calm", emoji: "😌", color: "#7fc4b8" },
  { key: "excited", label: "Excited", emoji: "🤩", color: "#f06a8a" },
  { key: "missing_you", label: "Missing you", emoji: "🥺", color: "#e0475a" },
  { key: "tired", label: "Tired", emoji: "😴", color: "#9b8ec4" },
  { key: "stressed", label: "Stressed", emoji: "😣", color: "#e8924a" },
  { key: "sad", label: "Sad", emoji: "😢", color: "#7fa7d9" },
  { key: "sick", label: "Sick", emoji: "🤒", color: "#8fc47f" },
];

export const moodOf = (key: string | undefined | null) => MOODS.find((m) => m.key === key) ?? null;

export type Mood = { user_id: string; mood: MoodKey; note: string; set_at: string; expires_at: string };

export type Profile = {
  user_id: string;
  nickname: string;
  favorite_track_id: string | null;
  favorite_track: Track | null;
  obsession: string;
  mood: Mood | null;
};

export type ProfileInput = { nickname: string; favorite_track_id: string | null; obsession: string };

export type DailyAnswer = { question_id: string; user_id: string; body: string; track_id: string | null; track: Track | null; created_at: string; updated_at: string };

export type DailyQuestion = {
  id: string;
  author_id: string;
  body: string;
  kind: "text" | "song";
  position: number;
  asked_on: string | null;
  created_at: string;
  updated_at: string;
};

export type AnsweredQuestion = DailyQuestion & { mine: DailyAnswer | null; theirs: DailyAnswer | null; they_answered: boolean };

export type QuestionView = { day: string; today: AnsweredQuestion | null; history: AnsweredQuestion[]; next_at: string };

export const profilesApi = {
  profiles: async () => (await request<{ profiles: Profile[] }>("/api/profiles")).profiles,
  setProfile: (p: ProfileInput) => request<null>("/api/profile", json("PUT", p)),
  setMood: (mood: MoodKey, note: string) => request<Mood>("/api/mood", json("PUT", { mood, note })),
  clearMood: () => request<null>("/api/mood", { method: "DELETE" }),
  question: () => request<QuestionView>("/api/question"),
  answer: (id: string, body: string, trackId: string | null) => request<null>(`/api/question/${id}/answer`, json("PUT", { body, track_id: trackId })),
  adminQuestions: async () => (await request<{ questions: DailyQuestion[] }>("/api/admin/questions")).questions,
  createQuestion: (body: string, kind: "text" | "song") => request<DailyQuestion>("/api/admin/questions", json("POST", { body, kind })),
  updateQuestion: (id: string, body: string, kind: "text" | "song") => request<null>(`/api/admin/questions/${id}`, json("PUT", { body, kind })),
  deleteQuestion: (id: string) => request<null>(`/api/admin/questions/${id}`, { method: "DELETE" }),
  orderQuestions: (ids: string[]) => request<null>("/api/admin/questions/order", json("PUT", { ids })),
};

export const profileKeys = { profiles: ["profiles"] as const, question: ["question"] as const, adminQuestions: ["admin", "questions"] as const };

export const useProfiles = () => useQuery({ queryKey: profileKeys.profiles, queryFn: profilesApi.profiles, staleTime: 5 * 60_000 });
export const useProfile = (userId: string | undefined) => {
  const q = useProfiles();
  return q.data?.find((p) => p.user_id === userId) ?? null;
};
export const useQuestion = () => useQuery({ queryKey: profileKeys.question, queryFn: profilesApi.question, staleTime: 5 * 60_000 });

let wired = false;

export function startProfiles() {
  if (wired) return;
  wired = true;
  on("profile.update", () => void queryClient.invalidateQueries({ queryKey: profileKeys.profiles }));
  on("question.update", () => {
    void queryClient.invalidateQueries({ queryKey: profileKeys.question });
    void queryClient.invalidateQueries({ queryKey: profileKeys.adminQuestions });
  });
  on("realtime.open", () => void queryClient.invalidateQueries({ queryKey: profileKeys.profiles }));
}
