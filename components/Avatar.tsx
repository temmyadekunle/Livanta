import { isAvatarDataUrl } from "@/lib/avatar";

import { Icon } from "./Icons";
import { initials } from "./labels";

/**
 * The user's picture, or their initials when there isn't one.
 *
 * Two things worth knowing about the markup:
 *
 * - The image is `alt=""`. The name is always rendered right next to it, so a
 *   labelled image would make a screen reader announce "photo of Temmy, Temmy".
 *   The picture here is decoration for a name that is already present.
 * - A stored value that fails `isAvatarDataUrl` falls back to initials instead of
 *   rendering. Settings can arrive from an export or a sync, and a broken image
 *   icon in the one place a person looks to confirm who they are is worse than
 *   no picture at all.
 */
export function Avatar({
  name,
  src,
  large = false,
}: {
  name: string;
  src?: string;
  large?: boolean;
}) {
  const usable = isAvatarDataUrl(src) ? src : null;
  const letters = initials(name);

  return (
    <span className={large ? "avatar avatar--lg" : "avatar"}>
      {/* A plain img, not next/image: the source is a data URL built at runtime
          from the photo the user just picked, so there is no build-time asset to
          optimise and no server for the image optimiser to fetch it through.
          readAvatar has already done the only optimisation that applies here --
          it is a 256px square webp before it ever reaches this line. */}
      {usable ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={usable} alt="" />
      ) : letters ? (
        letters
      ) : (
        /* A neutral silhouette, not the product name, so an account without
           a photo or a name is never labelled as "Livanta". */
        <Icon name="user" size={large ? 26 : 18} />
      )}
    </span>
  );
}
