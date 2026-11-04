// Renders real components and asserts on the markup, so the four
// languages are verified all the way to the DOM rather than only at the
// dictionary level. The loader that makes this possible is registered by
// --import (see register.mjs), so `npm test` stays a single command.
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import ThingEditor from "../components/ThingEditor.tsx";
import { LocalePicker } from "../components/Onboarding.tsx";
import { AuthScreen } from "../components/AuthScreen.tsx";
import { LOCALES, makeT } from "../lib/i18n.ts";
import { en } from "../lib/locales/en.ts";
import type { UseAuth } from "../lib/useAuth.ts";
import { assert } from "./helpers.ts";

const stubAuth = (overrides: Partial<UseAuth> = {}): UseAuth => ({
  enabled: true,
  status: "signed-out",
  user: null,
  error: null,
  needsEmailConfirmation: false,
  passwordResetReady: false,
  signIn: async () => true,
  signUp: async () => ({ ok: true, needsEmailConfirmation: false }),
  resetPassword: async () => true,
  updatePassword: async () => true,
  cancelPasswordReset: () => {},
  signOut: async () => {},
  clearError: () => {},
  retrySession: async () => {},
  signInWithGoogle: async () => true,
  signInWithApple: async () => true,
  ...overrides,
});

const preset = { kind: "rent", category: "home", label: "Rent" } as const;

const renderEditor = (locale: string) =>
  renderToStaticMarkup(
    <ThingEditor
      preset={preset}
      onSave={() => {}}
      onCancel={() => {}}
      t={makeT(locale as never)}
    />,
  );

/** Visible text only: drops tags, attributes and React comment markers. */
const text = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

test("ThingEditor renders every category in the active language", async (t) => {
  for (const locale of LOCALES) {
    await t.test(locale, () => {
      const shown = text(renderEditor(locale));
      const tr = makeT(locale);

      // The select options come from translated labels, so each category
      // must appear on screen in the language being asked for.
      for (const key of [
        "cat.home",
        "cat.transport",
        "cat.money",
        "cat.documents",
        "cat.family",
        "cat.services",
        "cat.tasks",
      ] as const) {
        assert.ok(shown.includes(tr(key)), `${locale} missing ${key}`);
      }
    });
  }
});

test("ThingEditor renders all 14 thing types", async (t) => {
  for (const locale of LOCALES) {
    await t.test(locale, () => {
      const shown = text(renderEditor(locale));
      const tr = makeT(locale);
      for (const key of [
        "kind.rent",
        "kind.utility",
        "kind.subscription",
        "kind.school-fee",
        "kind.service-provider",
        "kind.appointment",
      ] as const) {
        assert.ok(shown.includes(tr(key)), `${locale} missing ${key}`);
      }
    });
  }
});

test("ThingEditor renders all repeat options", async (t) => {
  for (const locale of LOCALES) {
    await t.test(locale, () => {
      const shown = text(renderEditor(locale));
      const tr = makeT(locale);
      for (const key of ["freq.none", "freq.monthly", "freq.annual"] as const) {
        assert.ok(shown.includes(tr(key)), `${locale} missing ${key}`);
      }
    });
  }
});

test("ThingEditor never leaks a raw translation key", async (t) => {
  for (const locale of LOCALES) {
    await t.test(locale, () => {
      const shown = text(renderEditor(locale));
      assert.ok(!/\b(?:cat|kind|freq|ed|app|ob|mod|btn|nav|tab|alert|status|profile|reminder|lang)\.[a-z]/i.test(shown), `${locale} rendered a raw key`);
      assert.ok(!shown.includes("{"), `${locale} rendered an unresolved placeholder`);
    });
  }
});

test("ThingEditor markup differs across languages", () => {
  const [a, b, c, d] = LOCALES.map(renderEditor);
  assert.equal(new Set([a, b, c, d]).size, 4);
});

test("ThingEditor heading follows the active language", async (t) => {
  const cases = [
    { key: "ed.newPrefix", initial: undefined },
    {
      key: "ed.editPrefix",
      initial: {
        name: "Rent",
        category: "home",
        kind: "rent",
        amount: "50000",
        dueDate: "2026-10-01",
        frequency: "none",
        notes: "",
      },
    },
  ] as const;

  for (const [index, { key, initial }] of cases.entries()) {
    await t.test(`branch ${index} (${key})`, () => {
      for (const locale of LOCALES) {
        const tr = makeT(locale);
        const shown = text(
          renderToStaticMarkup(
            <ThingEditor preset={preset} initial={initial} onSave={() => {}} onCancel={() => {}} t={tr} />,
          ),
        );
        const expected = tr(key, { label: preset.label.toLowerCase() });
        assert.ok(shown.includes(expected), `${locale} heading was not "${expected}"`);
      }
    });
  }
});

test("English is the default when no translator is supplied", () => {
  // Guards the fallback path: a missing translator must never blank the form.
  const html = renderToStaticMarkup(
    <ThingEditor preset={preset} onSave={() => {}} onCancel={() => {}} t={makeT("en")} />,
  );
  const shown = text(html);
  assert.ok(shown.includes(en["kind.rent"]));
  assert.ok(shown.includes(en["cat.home"]));
});
test("LocalePicker offers all four languages by endonym", () => {
  const html = renderToStaticMarkup(
    <LocalePicker locale="en" onChange={() => {}} t={makeT("en")} />,
  );
  const shown = text(html);
  for (const label of ["English", "Hausa", "Yoruba", "Igbo"]) {
    assert.ok(shown.includes(label), `picker missing ${label}`);
  }
});

test("LocalePicker names the languages identically in every locale", async (t) => {
  // Language names are endonyms on purpose: a Hausa speaker looking at the
  // Yoruba option should see "Yoruba", not an English gloss of it.
  for (const locale of LOCALES) {
    await t.test(locale, () => {
      const shown = text(
        renderToStaticMarkup(
          <LocalePicker locale={locale} onChange={() => {}} t={makeT(locale)} />,
        ),
      );
      for (const label of ["English", "Hausa", "Yoruba", "Igbo"]) {
        assert.ok(shown.includes(label), `${locale} picker missing ${label}`);
      }
    });
  }
});

test("LocalePicker marks exactly one language as selected", async (t) => {
  for (const locale of LOCALES) {
    await t.test(locale, () => {
      const html = renderToStaticMarkup(
        <LocalePicker locale={locale} onChange={() => {}} t={makeT(locale)} />,
      );

      assert.equal(
        (html.match(/aria-pressed="true"/g) ?? []).length,
        1,
        `${locale} did not have exactly one selected option`,
      );
      assert.equal(
        (html.match(/class="chip chip--on"/g) ?? []).length,
        1,
        `${locale} did not highlight exactly one chip`,
      );

      // Each chip declares its own language, so a screen reader announces
      // "Hausa" in the Hausa voice rather than reading English text.
      const selected = html.match(/<button[^>]*aria-pressed="true"[^>]*>/)?.[0];
      assert.ok(selected, `${locale} selected button not found`);
      assert.ok(
        selected.includes(`lang="${locale}"`),
        `${locale} selected chip was missing lang="${locale}"`,
      );

      // Every chip must carry a lang attribute, not just the selected one.
      assert.equal(
        (html.match(/<button[^>]*lang="/g) ?? []).length,
        LOCALES.length,
        `${locale} chips were missing lang attributes`,
      );
    });
  }
});

test("LocalePicker group label is translated", async (t) => {
  for (const locale of LOCALES) {
    await t.test(locale, () => {
      const html = renderToStaticMarkup(
        <LocalePicker locale={locale} onChange={() => {}} t={makeT(locale)} />,
      );
      assert.ok(
        html.includes(`aria-label="${makeT(locale)("ob.language")}"`),
        `${locale} group label was not translated`,
      );
      assert.ok(html.includes('role="group"'), `${locale} lost role="group"`);
    });
  }
});

test("translation proof page lists every key in all four languages", async () => {
  const TranslationsPage = (await import("../app/translations/page.tsx")).default;
  const html = renderToStaticMarkup(<TranslationsPage />);

  // Header row plus one row per key, plus the grouped section tables.
  const rows = html.match(/<tr[ >]/g) ?? [];
  assert.ok(
    rows.length >= Object.keys(en).length,
    `expected at least ${Object.keys(en).length} rows, got ${rows.length}`,
  );

  for (const locale of LOCALES) {
    assert.ok(html.includes(`lang="${locale}"`), `proof page missing lang="${locale}"`);
  }
});

test("translation proof page reports no placeholder mismatches", async () => {
  const TranslationsPage = (await import("../app/translations/page.tsx")).default;
  const html = renderToStaticMarkup(<TranslationsPage />);

  const count = Number(
    html.match(/<strong>(\d+)<\/strong> placeholder mismatches/)?.[1] ?? "-1",
  );
  assert.equal(count, 0, `proof page reported ${count} placeholder mismatches`);

  // The warning block must stay absent while the count is zero, otherwise
  // reviewers open the page to an alarming banner about nothing.
  assert.ok(!html.includes("proof-warn"), "mismatch warning rendered despite zero mismatches");
});

test("translation proof page marks plural variants", async () => {
  const TranslationsPage = (await import("../app/translations/page.tsx")).default;
  const html = renderToStaticMarkup(<TranslationsPage />);

  const pluralKeys = Object.keys(en).filter(
    (k) => k.endsWith("_one") || k.endsWith("_many"),
  );
  assert.ok(pluralKeys.length > 0, "expected plural keys to exist");
  for (const key of pluralKeys) {
    assert.ok(html.includes(`<code>${key}</code>`), `proof page missing ${key}`);
  }
});

test("AuthScreen welcome mode offers only create account and sign in", () => {
  const html = renderToStaticMarkup(
    <AuthScreen
      t={makeT("en")}
      auth={stubAuth()}
      initialMode="welcome"
      onClose={() => {}}
      onDone={() => {}}
    />,
  );
  const shown = text(html);
  assert.ok(shown.includes(en["auth.welcomeTitle"]));
  assert.ok(shown.includes(en["auth.welcomeBlurb"]));
  assert.ok(shown.includes(en["auth.signUpTitle"]));
  assert.ok(shown.includes(en["auth.signInTitle"]));
  assert.ok(
    !/continue without an account/i.test(shown),
    "compulsory auth must not offer an offline escape",
  );
  assert.ok(!shown.includes("name@example.com"), "welcome must not show form fields");
});

test("AuthScreen welcome mode cannot be closed when no close handler is wired", () => {
  const html = renderToStaticMarkup(
    <AuthScreen
      t={makeT("en")}
      auth={stubAuth()}
      initialMode="welcome"
      onDone={() => {}}
    />,
  );
  assert.ok(!text(html).includes(en["app.back"]));
});

test("AuthScreen welcome heading is translated in every language", async (t) => {
  for (const locale of LOCALES) {
    await t.test(locale, () => {
      const shown = text(
        renderToStaticMarkup(
          <AuthScreen
            t={makeT(locale)}
            auth={stubAuth()}
            initialMode="welcome"
            onClose={() => {}}
            onDone={() => {}}
          />,
        ),
      );
      assert.ok(shown.includes(makeT(locale)("auth.welcomeTitle")));
    });
  }
});

test("AuthScreen keeps the email-confirmation notice visible until acted on", () => {
  for (const initialMode of ["welcome", "sign-up", "sign-in"] as const) {
    const shown = text(
      renderToStaticMarkup(
        <AuthScreen
          t={makeT("en")}
          auth={stubAuth({ needsEmailConfirmation: true })}
          initialMode={initialMode}
          onClose={() => {}}
          onDone={() => {}}
        />,
      ),
    );
    assert.ok(
      shown.includes(en["auth.checkEmailTitle"]),
      `${initialMode} hid the confirmation notice`,
    );
    assert.ok(shown.includes(en["auth.checkEmailBody"]));
  }
});

test("AuthScreen surfaces a credentials error without leaking the raw message", () => {
  const html = renderToStaticMarkup(
    <AuthScreen
      t={makeT("en")}
      auth={stubAuth({
        error: { code: "invalid-credentials", message: "Email or password is incorrect" },
      })}
      onClose={() => {}}
      onDone={() => {}}
    />,
  );
  const shown = text(html);
  assert.ok(shown.includes(en["auth.invalid"]));
  assert.ok(!shown.includes("Email or password is incorrect"));
});

test("a failed sign-out is reported instead of implying success", () => {
  const shown = text(
    renderToStaticMarkup(
      <AuthScreen
        t={makeT("en")}
        auth={stubAuth({
          status: "signed-in",
          user: { email: "a@b.co" } as UseAuth["user"],
          error: { code: "sign-out-failed", message: "network down" },
        })}
        onClose={() => {}}
        onDone={() => {}}
      />,
    ),
  );
  assert.ok(shown.includes(en["auth.signOutFailed"]));
  assert.ok(!shown.includes("network down"));
});
