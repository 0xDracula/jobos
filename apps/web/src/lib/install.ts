import { create } from "zustand";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export const useInstall = create<{ prompt: InstallPrompt | null; installed: boolean }>(() => ({ prompt: null, installed: false }));

export function startInstall(): () => void {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  useInstall.setState({ installed: standalone });
  const onPrompt = (e: Event) => {
    e.preventDefault();
    useInstall.setState({ prompt: e as InstallPrompt });
  };
  const onInstalled = () => useInstall.setState({ prompt: null, installed: true });
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

export async function install(): Promise<void> {
  const prompt = useInstall.getState().prompt;
  if (!prompt) return;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  useInstall.setState({ prompt: null, installed: outcome === "accepted" });
}
