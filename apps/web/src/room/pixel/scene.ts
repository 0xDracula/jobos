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

export const BACKDROP = { x: -260, y: -40, w: 840, h: 700 };
export const WORLD = { x: -16, y: 40, w: 352, h: 620 };
export const INDOORS: [number, number, number, number] = [0, WALL_TOP, DIVIDER_X + 6, FRONT_Y - WALL_TOP + 7];

export const STANDING = {
  desk: { cx: 30, bottom: 133 },
  bed: { cx: 74.5, bottom: 150 },
  lamp: { cx: 105.5, bottom: 129 },
  bookcase: { cx: 134, bottom: 130 },
  speaker: { cx: 175, bottom: 130 },
  table: { cx: 223, bottom: 164 },
} as const;

export const HANGING = {
  window: { x: 56, y: 84 },
  second_window: { x: 94, y: 82 },
  frame: { x: 18, y: 86 },
  poster: { x: 140, y: 82 },
  shelf_plant: { x: 126, y: 86 },
} as const;

export const PICTURE = { x: 100, y: 82 };

export const DESK_TOP = 118;
export const RECORD_PLAYER = { x: 10, y: 104 };
export const SNACK = { x: 36 };
export const CASSETTE = { x: 43 };

export const TRAY = { x: 215, y: 143 };
export const PET_BED = { x: 268, y: 150 };

export const PLANTS = { x: 250, base: 130 };
export const PLANT_STAGES = [["plant_small"], ["plant_small", "plant_bush"], ["plant_bush", "plant_tree"], ["plant_tree", "plant_palm", "plant_bush"], ["plant_palm", "plant_tree", "plant_palm"]];

export const KITTEN = { awake: { x: 196, y: 92 }, asleep: { x: 270, y: 143 } };

export const LIGHTS = { x0: 157, y0: 78, x1: 310, y1: 62, sag: 16 };

export const AVATARS = {
  me: { x: 96, y: 164 },
  other: { x: 176, y: 160 },
  together: [
    { x: 11, y: 152 },
    { x: 29, y: 152 },
  ],
};

export const ANCHORS: Record<string, [number, number]> = {
  record_player: [22, 103],
  records: [134, 98],
  window: [73, 86],
  second_window: [106, 82],
  lamp: [105, 103],
  bed: [74, 121],
  plants: [260, 104],
  speaker: [175, 103],
  drawer: [30, 124],
  pet_bed: [278, 147],
  frame: [28, 85],
  cassette: [47, 111],
  pinned_record: [123, 89],
  telephone: [46, 95],
  tea: [223, 142],
};

export const HIT: Record<string, [number, number, number, number]> = {
  pinned_record: [117, 88, 11, 11],
  telephone: [42, 93, 9, 11],
  tea: [207, 141, 33, 24],
  record_player: [9, 101, 26, 17],
  records: [118, 96, 32, 34],
  window: [56, 84, 34, 26],
  second_window: [94, 82, 25, 15],
  lamp: [96, 102, 18, 28],
  bed: [54, 118, 41, 32],
  plants: [246, 96, 34, 36],
  speaker: [164, 102, 22, 30],
  drawer: [8, 121, 44, 12],
  pet_bed: [266, 146, 24, 14],
  frame: [16, 84, 25, 18],
  cassette: [41, 109, 12, 10],
};
