"use client";

/**
 * Mounts the native App Link listener above both the app and the confirmation
 * route. A cold launch reads `getLaunchUrl`; a warm launch arrives through the
 * `appUrlOpen` event. The hook verifies a token hash in place and replays the
 * older implicit fragment, so every entry point shares one handover.
 */

import { useNativeAuthLink } from "@/lib/useNativeAuthLink";

export default function NativeAuthLinkBridge() {
  useNativeAuthLink();
  return null;
}
