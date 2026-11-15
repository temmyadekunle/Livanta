"use client";

/**
 * Landing page header.
 *
 * A client component because the mobile menu is interactive. It stays small on
 * purpose: the menu is a disclosure button plus a conditional block, and the
 * open state is the only reason JavaScript ships here at all.
 *
 * Accessibility notes worth not undoing:
 * - The toggle carries aria-expanded and aria-controls, so the state is
 *   announced rather than only visible.
 * - Escape closes the menu and puts focus back on the toggle, and the links
 *   inside are real anchors, so the page works with the keyboard and stays
 *   crawlable.
 * - Resizing to the desktop breakpoint closes the menu, so the body scroll
 *   lock cannot outlive the panel that needed it.
 * - Scrolling to a section is native anchor behaviour, not a JS smooth-scroll,
 *   so a failed script degrades to a plain jump instead of nothing.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { Logo } from "@/components/Logo";

export const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#screens", label: "Screens" },
  { href: "#availability", label: "Availability" },
  { href: "#roadmap", label: "Roadmap" },
  { href: "#faq", label: "FAQ" },
] as const;

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Escape closes the menu. Bound on the document rather than the panel so it
  // works wherever focus happens to be, and focus returns to the control that
  // opened it instead of being lost with the hidden links.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // The desktop layout hides the panel at 1024px. Closing on that change keeps
  // the body scroll lock from surviving into a viewport with no menu.
  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, [open]);

  // Lock the page behind the overlay so a scroll gesture does not move the
  // content out from under the open menu.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="lp-nav">
      <div className="lp-nav__inner">
        <a className="lp-nav__brand" href="#top" aria-label="Livanta home">
          {/* alt is empty because the wordmark sits right beside it; announcing
              "Livanta" twice would just be noise for a screen reader. */}
          <Logo variant="mark" alt="" priority />
          <span className="lp-nav__word">Livanta</span>
        </a>

        <nav className="lp-nav__links" aria-label="Sections">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="lp-nav__actions">
          {/* The real app stays reachable from the marketing page. */}
          <Link className="btn btn--ghost btn--sm lp-nav__app" href="/">
            Open the app
          </Link>
          <a className="btn btn--primary btn--sm" href="#download">
            Download
          </a>
        </div>

        <button
          ref={toggleRef}
          type="button"
          className="lp-nav__toggle"
          aria-expanded={open}
          aria-controls="lp-mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          <Icon name={open ? "x" : "menu"} size={22} />
        </button>
      </div>

      <div
        id="lp-mobile-menu"
        className={`lp-menu${open ? " is-open" : ""}`}
        // Hidden rather than merely collapsed, so the links are not focusable
        // while the menu is shut. React wants a real boolean here; the empty
        // string that older code used is now a warning, not a no-op.
        {...(open ? {} : { inert: true })}
      >
        <nav className="lp-menu__links" aria-label="Sections">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="lp-menu__actions">
          <Link className="btn btn--ghost" href="/" onClick={() => setOpen(false)}>
            Open the app
          </Link>
          <a className="btn btn--primary" href="#download" onClick={() => setOpen(false)}>
            Download the app
          </a>
        </div>
      </div>
    </header>
  );
}
