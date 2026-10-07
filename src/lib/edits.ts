// Non-destructive edits. A recipe is stored next to a photo/video (locally and
// in the cloud); the original file is never modified. Mirrors
// modules/lens-camera/ios/Imaging/EditRecipe.swift.

export type Adjustments = {
  exposure?: number; // EV -2…2
  contrast?: number; // -1…1
  highlights?: number; // -1…1
  shadows?: number; // -1…1
  warmth?: number; // -1…1
  tint?: number; // -1…1
  saturation?: number; // -1…1
  vibrance?: number; // -1…1
  sharpness?: number; // 0…1
  vignette?: number; // 0…1
  grain?: number; // 0…1
};

export type Crop = {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotate?: number; // quarter turns clockwise
  straighten?: number; // degrees -45…45
  flip?: boolean;
};

export type EditRecipe = {
  v?: 1;
  look?: string;
  intensity?: number; // 0…1
  auto?: boolean;
  adjust?: Adjustments;
  crop?: Crop;
  portrait?: { aperture?: number };
};

export const LOOKS: { id: string; name: string; description: string }[] = [
  { id: 'natural', name: 'Natural+', description: 'True-to-life colour with a gentle lift' },
  { id: 'vivid', name: 'Vivid', description: 'Punchy colour and contrast' },
  { id: 'warm', name: 'Warm', description: 'Golden, cosy tones' },
  { id: 'cool', name: 'Cool', description: 'Crisp, blue-leaning tones' },
  { id: 'golden', name: 'Golden hour', description: 'Rich sunset warmth' },
  { id: 'cinematic', name: 'Cinematic', description: 'Teal shadows, orange highlights' },
  { id: 'film', name: 'Film', description: 'Soft film stock with lifted blacks' },
  { id: 'moody', name: 'Moody', description: 'Dark, muted and dramatic' },
  { id: 'fade', name: 'Fade', description: 'Low contrast, matte finish' },
  { id: 'bw', name: 'B&W', description: 'Clean black and white' },
  { id: 'noir', name: 'Noir', description: 'High-contrast black and white' },
  { id: 'vintage', name: 'Vintage', description: 'Instant-film colours' },
  { id: 'chrome', name: 'Chrome', description: 'Saturated, glossy colour' },
];

export type AdjustmentSpec = {
  key: keyof Adjustments;
  label: string;
  min: number;
  max: number;
  step: number;
};

export const ADJUSTMENTS: AdjustmentSpec[] = [
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.1 },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.05 },
  { key: 'highlights', label: 'Highlights', min: -1, max: 1, step: 0.05 },
  { key: 'shadows', label: 'Shadows', min: -1, max: 1, step: 0.05 },
  { key: 'warmth', label: 'Warmth', min: -1, max: 1, step: 0.05 },
  { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.05 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.05 },
  { key: 'vibrance', label: 'Vibrance', min: -1, max: 1, step: 0.05 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 1, step: 0.05 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05 },
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.05 },
];

export const CROP_ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'original', label: 'Original', ratio: null },
  { id: '1:1', label: 'Square', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

/** Centered crop rect (normalised) for an aspect ratio on an image of w×h. */
export function centeredCrop(ratio: number | null, width: number, height: number): Pick<Crop, 'x' | 'y' | 'w' | 'h'> {
  if (!ratio || !width || !height) return { x: undefined, y: undefined, w: undefined, h: undefined };
  const imageRatio = width / height;
  if (ratio > imageRatio) {
    const h = imageRatio / ratio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = ratio / imageRatio;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

/** True when the recipe changes nothing. */
export function isNeutral(recipe?: EditRecipe | null): boolean {
  if (!recipe) return true;
  if (recipe.look && (recipe.intensity ?? 1) > 0) return false;
  if (recipe.auto) return false;
  if (recipe.portrait?.aperture) return false;
  if (recipe.adjust && Object.values(recipe.adjust).some((v) => typeof v === 'number' && Math.abs(v) > 1e-3)) return false;
  const c = recipe.crop;
  if (c && ((c.rotate ?? 0) % 4 !== 0 || c.flip || Math.abs(c.straighten ?? 0) > 0.01 || (c.w !== undefined && c.w < 1) || (c.h !== undefined && c.h < 1))) {
    return false;
  }
  return true;
}

/** Removes neutral values so stored recipes stay small. */
export function compact(recipe: EditRecipe): EditRecipe | null {
  if (isNeutral(recipe)) return null;
  const out: EditRecipe = { v: 1 };
  if (recipe.look && (recipe.intensity ?? 1) > 0) {
    out.look = recipe.look;
    if ((recipe.intensity ?? 1) < 1) out.intensity = Math.round((recipe.intensity ?? 1) * 100) / 100;
  }
  if (recipe.auto) out.auto = true;
  if (recipe.portrait?.aperture) out.portrait = { aperture: recipe.portrait.aperture };
  const adjust: Adjustments = {};
  for (const [k, v] of Object.entries(recipe.adjust ?? {})) {
    if (typeof v === 'number' && Math.abs(v) > 1e-3) adjust[k as keyof Adjustments] = Math.round(v * 100) / 100;
  }
  if (Object.keys(adjust).length) out.adjust = adjust;
  if (recipe.crop && !isNeutral({ crop: recipe.crop })) out.crop = recipe.crop;
  return out;
}

/** What "Paste edit" copies to other photos: everything except crop. */
export function forPaste(recipe: EditRecipe): EditRecipe {
  const { crop: _crop, portrait: _portrait, ...rest } = recipe;
  return rest;
}
