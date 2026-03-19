export const TASTE_KEYS = [
  "Sweetness",
  "Sourness",
  "Saltiness",
  "Bitterness",
  "Savoriness",
  "Fatness",
  "Astringency",
  "Aromaticity",
  "Texture",
  "Piquancy",
] as const;

export type TasteKey = (typeof TASTE_KEYS)[number];

export const SENSE_LABELS: Record<TasteKey, string> = {
  Sweetness: "Sweet",
  Sourness: "Sour",
  Saltiness: "Salty",
  Bitterness: "Bitter",
  Savoriness: "Savory",
  Fatness: "Fatty",
  Astringency: "Astringent",
  Aromaticity: "Aromatic",
  Texture: "Texture",
  Piquancy: "Piquant",
};
