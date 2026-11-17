/**
 * Profile picture handling.
 *
 * A photo straight off a phone camera is 3-8 MB. Storing that as-is would mean
 * a settings record big enough to make the whole local database sluggish, and a
 * settings row large enough to be an unpleasant thing to sync on a metered
 * connection -- for a 44px circle. So the picture is decoded once, cropped to a
 * square, scaled down and re-encoded before it is ever stored.
 *
 * The crop and scale maths is kept separate and pure so it can be tested without
 * a canvas; only `readAvatar` touches the DOM.
 */

/** Longest edge kept. An avatar is a circle under 64px; 256 leaves room for a
    high-density screen without storing pixels nobody will ever see. */
export const AVATAR_MAX_EDGE = 256;

/** Ceiling on the stored string. webp at this size lands far below it, so
    hitting it means something unexpected got through and should be refused
    rather than written to disk and uploaded. */
export const AVATAR_MAX_CHARS = 400_000;

/** Largest file accepted for decoding, before any resizing. Guards against
    picking a 60MB video by accident and locking the tab up decoding it. */
export const AVATAR_MAX_INPUT_BYTES = 20 * 1024 * 1024;

const ACCEPTED = ["image/webp", "image/png", "image/jpeg"] as const;

export type AvatarError = "too-large" | "not-an-image" | "could-not-read";

export class AvatarProblem extends Error {
  readonly reason: AvatarError;
  constructor(reason: AvatarError) {
    super(reason);
    this.name = "AvatarProblem";
    this.reason = reason;
  }
}

/**
 * The square region to take from a `w` x `h` image, and the edge to draw it
 * at.
 *
 * `side` is the largest square that fits inside the image, centred on the
 * short axis so equal bands come off each side. `edge` is that square scaled
 * down to the cap: the whole selected area is kept and shrunk as one piece, so
 * a 1024px photo still shows the portrait its owner framed rather than the
 * middle 256px of it. Never upscales: an image already smaller than the cap is
 * left at its own size.
 */
export function avatarCrop(
  w: number,
  h: number,
  maxEdge: number = AVATAR_MAX_EDGE,
): { sx: number; sy: number; side: number; edge: number } {
  /* The largest square that fits *inside* the image, so the crop can never
     start outside it. Using the longer edge instead -- min(max(w, h), cap) --
     would pick a side wider than the image on its short axis and send sy or sx
     negative, which silently draws the wrong region rather than failing. */
  const side = Math.min(w, h);
  const edge = Math.min(side, maxEdge);
  return {
    sx: Math.round((w - side) / 2),
    sy: Math.round((h - side) / 2),
    side,
    edge,
  };
}

/**
 * Whether a stored value is safe to put in an `<img src>`.
 *
 * Anything read back from storage or arrived by sync has to be treated as
 * untrusted: it is a string in a database that a row-level-security mistake
 * could put there, and it is also the only guard against a malformed record
 * taking the profile screen down with it.
 */
export function isAvatarDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= AVATAR_MAX_CHARS &&
    ACCEPTED.some((type) => value.startsWith(`data:${type};base64,`))
  );
}

/**
 * Decode a picked file into a small square data URL.
 *
 * Throws `AvatarProblem` with a reason the UI can turn into a sentence, so a
 * failure here never surfaces as an unhandled rejection or a blank avatar with
 * no explanation.
 */
export async function readAvatar(file: File | Blob): Promise<string> {
  if (file.size > AVATAR_MAX_INPUT_BYTES) throw new AvatarProblem("too-large");
  if (!file.type.startsWith("image/")) throw new AvatarProblem("not-an-image");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AvatarProblem("could-not-read");
  }

  try {
    const { sx, sy, side, edge } = avatarCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AvatarProblem("could-not-read");
    /* Square source into a square canvas: a proportional reduction of exactly
       what the crop sheet showed. Drawing the same `side` at both ends would
       sample a cap-sized window instead of resizing the picture. */
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, edge, edge);

    // webp first, jpeg as the fallback. Safari gained webp encoding only
    // recently, and toDataURL silently returns a png when it cannot honour the
    // requested type, so the type has to be checked rather than assumed.
    const webp = canvas.toDataURL("image/webp", 0.82);
    if (isAvatarDataUrl(webp) && webp.length <= AVATAR_MAX_CHARS) return webp;

    const jpeg = canvas.toDataURL("image/jpeg", 0.85);
    if (isAvatarDataUrl(jpeg) && jpeg.length <= AVATAR_MAX_CHARS) return jpeg;

    throw new AvatarProblem("too-large");
  } finally {
    bitmap.close();
  }
}
