/**
 * next/link for tests that mount a screen outside a Next runtime.
 *
 * The real component needs router context, which a plain React tree does not
 * have. These tests only check where a link points and what it contains, so an
 * anchor with the same props is enough.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";

export default function Link({
  href,
  children,
  ...rest
}: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
