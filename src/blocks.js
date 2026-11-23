// Block registry. All names are original to Hollowstone (see the originality rules on the dev hub).
// tiles: atlas tile index for [top, side, bottom].

export const AIR = 0;

export const B = {
  AIR: 0,
  TURF: 1,
  LOAM: 2,
  SLATE: 3,
  SILTSAND: 4,
  WATER: 5,
  BARKWOOD: 6,
  CANOPY: 7,
  TIMBER: 8,
  RUBBLE: 9,
  BASALT: 10,
  EMBERORE: 11,
  LUMEN: 12,
  CLAYBRICK: 13,
  GLASS: 14,
  SNOWPACK: 15,
  DEEPCORE: 16,
  FROSTTURF: 17,
  DUSKWOOD: 18,
  DUSKCANOPY: 19,
};

// Tile indices in the generated atlas (see textures.js for how each is painted).
export const T = {
  TURF_TOP: 0, TURF_SIDE: 1, LOAM: 2, SLATE: 3, SILTSAND: 4, WATER: 5,
  BARK: 6, RINGS: 7, CANOPY: 8, TIMBER: 9, RUBBLE: 10, BASALT: 11,
  EMBERORE: 12, LUMEN: 13, CLAYBRICK: 14, GLASS: 15, SNOWPACK: 16, DEEPCORE: 17,
  FROST_SIDE: 18, DUSKBARK: 19, DUSKRINGS: 20, DUSKCANOPY: 21,
};

// kind: "solid" (opaque cube), "cutout" (alpha-tested, see-through gaps), "liquid" (translucent, not solid)
const defs = [
  { id: B.AIR, name: "Air", kind: "air" },
  { id: B.TURF, name: "Turf", kind: "solid", tiles: [T.TURF_TOP, T.TURF_SIDE, T.LOAM] },
  { id: B.LOAM, name: "Loam", kind: "solid", tiles: [T.LOAM, T.LOAM, T.LOAM] },
  { id: B.SLATE, name: "Slate", kind: "solid", tiles: [T.SLATE, T.SLATE, T.SLATE] },
  { id: B.SILTSAND, name: "Siltsand", kind: "solid", tiles: [T.SILTSAND, T.SILTSAND, T.SILTSAND] },
  { id: B.WATER, name: "Water", kind: "liquid", tiles: [T.WATER, T.WATER, T.WATER], breakable: false },
  { id: B.BARKWOOD, name: "Barkwood", kind: "solid", tiles: [T.RINGS, T.BARK, T.RINGS] },
  { id: B.CANOPY, name: "Canopy", kind: "cutout", tiles: [T.CANOPY, T.CANOPY, T.CANOPY] },
  { id: B.TIMBER, name: "Timber", kind: "solid", tiles: [T.TIMBER, T.TIMBER, T.TIMBER] },
  { id: B.RUBBLE, name: "Rubble", kind: "solid", tiles: [T.RUBBLE, T.RUBBLE, T.RUBBLE] },
  { id: B.BASALT, name: "Basalt", kind: "solid", tiles: [T.BASALT, T.BASALT, T.BASALT] },
  { id: B.EMBERORE, name: "Emberore", kind: "solid", tiles: [T.EMBERORE, T.EMBERORE, T.EMBERORE] },
  { id: B.LUMEN, name: "Lumen", kind: "solid", tiles: [T.LUMEN, T.LUMEN, T.LUMEN], glow: true },
  { id: B.CLAYBRICK, name: "Claybrick", kind: "solid", tiles: [T.CLAYBRICK, T.CLAYBRICK, T.CLAYBRICK] },
  { id: B.GLASS, name: "Glass", kind: "cutout", tiles: [T.GLASS, T.GLASS, T.GLASS] },
  { id: B.SNOWPACK, name: "Snowpack", kind: "solid", tiles: [T.SNOWPACK, T.SNOWPACK, T.SNOWPACK] },
  { id: B.DEEPCORE, name: "Deepcore", kind: "solid", tiles: [T.DEEPCORE, T.DEEPCORE, T.DEEPCORE], breakable: false },
  { id: B.FROSTTURF, name: "Frostturf", kind: "solid", tiles: [T.SNOWPACK, T.FROST_SIDE, T.LOAM] },
  { id: B.DUSKWOOD, name: "Duskwood", kind: "solid", tiles: [T.DUSKRINGS, T.DUSKBARK, T.DUSKRINGS] },
  { id: B.DUSKCANOPY, name: "Duskcanopy", kind: "cutout", tiles: [T.DUSKCANOPY, T.DUSKCANOPY, T.DUSKCANOPY] },
];

export const BLOCKS = [];
for (const d of defs) BLOCKS[d.id] = Object.assign({ breakable: true, glow: false }, d);

// Fast lookup tables
export const SOLID = new Uint8Array(256);      // collides with the player
export const OPAQUE = new Uint8Array(256);     // fully hides neighbouring faces
export const KIND = new Uint8Array(256);       // 0 air, 1 solid, 2 cutout, 3 liquid
for (const b of BLOCKS) {
  if (!b) continue;
  KIND[b.id] = { air: 0, solid: 1, cutout: 2, liquid: 3 }[b.kind];
  SOLID[b.id] = b.kind === "solid" || b.kind === "cutout" ? 1 : 0;
  OPAQUE[b.id] = b.kind === "solid" ? 1 : 0;
}

// Blocks the player can pick in the hotbar, in order.
export const HOTBAR = [B.TURF, B.LOAM, B.SLATE, B.RUBBLE, B.TIMBER, B.BARKWOOD, B.CLAYBRICK, B.GLASS, B.LUMEN,
  B.SILTSAND, B.CANOPY, B.BASALT, B.SNOWPACK, B.EMBERORE, B.DUSKWOOD, B.DUSKCANOPY];
