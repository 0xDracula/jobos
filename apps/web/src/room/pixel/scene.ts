export const SCENE_W = 320;
export const BASE_BOTTOM = 180;
export const HORIZON = 116;
export const WALL_TOP = 76;
export const FLOOR_Y = 124;
export const FRONT_Y = 172;
export const PARAPET_Y = 106;
export const ROOM_X0 = 6;
export const DIVIDER_X = 154;
export const ROOF_X0 = 160;
export const ROOF_X1 = 314;
export const DOOR_Y0 = 132;
export const DOOR_Y1 = 158;

export type Placed = { sprite: string; x: number; y: number };

export const FURNITURE: Record<string, Placed> = {
  dresser: { sprite: "dresser", x: 14, y: 112 },
  window: { sprite: "window_curtains", x: 56, y: 84 },
  bed: { sprite: "bed_teal", x: 54, y: 118 },
  lamp: { sprite: "lamp_cream", x: 98, y: 104 },
  bookcase: { sprite: "bookcase", x: 118, y: 98 },
  frame: { sprite: "frame_cat", x: 18, y: 86 },
  flowers: { sprite: "frame_flowers", x: 140, y: 82 },
  second_window: { sprite: "window_small", x: 94, y: 82 },
  plant_shelf: { sprite: "plant_small", x: 126, y: 86 },
  tank: { sprite: "water_tank", x: 284, y: 90 },
  dish: { sprite: "satellite_dish", x: 262, y: 92 },
  speaker: { sprite: "speaker", x: 166, y: 104 },
  table: { sprite: "table_low", x: 208, y: 146 },
  tray: { sprite: "tea_tray", x: 215, y: 143 },
  pet_bed: { sprite: "pet_bed", x: 268, y: 150 },
};

export const RECORD_PLAYER = { x: 20, y: 103 };
export const PLANTS = { x: 250, base: 130 };
export const PLANT_STAGES = [["plant_small"], ["plant_small", "plant_bush"], ["plant_bush", "plant_tree"], ["plant_tree", "plant_palm", "plant_bush"], ["plant_palm", "plant_tree", "plant_palm"]];

export const KITTEN = { awake: { x: 196, y: 92 }, asleep: { x: 270, y: 143 } };

export const LIGHTS = { x0: 157, y0: 78, x1: 310, y1: 62, sag: 16 };

export const ANCHORS: Record<string, [number, number]> = {
  record_player: [30, 101],
  records: [134, 98],
  window: [73, 86],
  second_window: [106, 82],
  lamp: [105, 103],
  bed: [74, 121],
  plants: [260, 104],
  speaker: [175, 103],
  drawer: [30, 118],
  pet_bed: [278, 147],
  frame: [28, 85],
};

export const HIT: Record<string, [number, number, number, number]> = {
  record_player: [16, 98, 28, 14],
  records: [118, 96, 32, 34],
  window: [56, 84, 34, 26],
  second_window: [94, 82, 25, 15],
  lamp: [96, 102, 18, 28],
  bed: [54, 118, 41, 32],
  plants: [246, 96, 34, 36],
  speaker: [164, 102, 22, 30],
  drawer: [14, 114, 32, 20],
  pet_bed: [266, 146, 24, 14],
  frame: [16, 84, 25, 18],
};
