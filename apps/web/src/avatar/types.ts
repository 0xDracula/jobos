export type { AvatarLook, AvatarStyle } from "./look";

export type AvatarPose = "idle" | "listening" | "together";

export type AvatarFrames = {
  stand: HTMLCanvasElement[];
  standPhones: HTMLCanvasElement[];
  sitRight: HTMLCanvasElement[];
  sitLeft: HTMLCanvasElement[];
};
