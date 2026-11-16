import test from "node:test";
import {
  DEFAULT_LOCALE,
  DICTIONARIES,
  LOCALES,
  LOCALE_NAMES,
  formatNaira,
  isLocale,
  makeT,
} from "../lib/i18n.ts";
import { en, type TKey } from "../lib/locales/en.ts";
import { buildAlerts } from "../lib/risk.ts";
import { computeLifeStatus } from "../lib/status.ts";
import { reminderCopy } from "../lib/notifications.ts";
import { assert, iso, makeAlert, makeThing, NOW } from "./helpers.ts";

const KEYS = Object.keys(en) as TKey[];
const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
}

test("catalogue integrity", async (t) => {
  await t.test("English has keys", () => {
    assert.ok(KEYS.length > 200, `expected a large catalogue, got ${KEYS.length}`);
  });

  await t.test("English keys are unique", () => {
    assert.equal(new Set(KEYS).size, KEYS.length);
  });

  await t.test("no English value is blank", () => {
    for (const key of KEYS) {
      assert.ok(en[key].trim().length > 0, `"${key}" is empty`);
    }
  });

  await t.test("every _one has a matching _many and vice versa", () => {
    const ones = KEYS.filter((k) => k.endsWith("_one")).map((k) => k.slice(0, -4));
    const manies = new Set(KEYS.filter((k) => k.endsWith("_many")).map((k) => k.slice(0, -5)));
    for (const base of ones) {
      assert.ok(manies.has(base), `"${base}" has _one but no _many`);
    }
    assert.equal(manies.size, ones.length);
  });
});

test("locale completeness", async (t) => {
  for (const locale of LOCALES) {
    await t.test(`${locale} defines every key`, () => {
      const dict = DICTIONARIES[locale] as Record<string, string>;
      for (const key of KEYS) {
        assert.ok(key in dict, `${locale} is missing "${key}"`);
      }
    });

    await t.test(`${locale} defines no extra keys`, () => {
      const dict = DICTIONARIES[locale] as Record<string, string>;
      const extras = Object.keys(dict).filter((k) => !KEYS.includes(k as TKey));
      assert.deepEqual(extras, [], `${locale} has unknown keys`);
    });

    await t.test(`${locale} has no blank values`, () => {
      const dict = DICTIONARIES[locale] as Record<string, string>;
      for (const key of KEYS) {
        assert.ok(dict[key].trim().length > 0, `${locale} "${key}" is empty`);
      }
    });

    await t.test(`${locale} preserves every placeholder`, () => {
      const dict = DICTIONARIES[locale] as Record<string, string>;
      for (const key of KEYS) {
        assert.deepEqual(
          placeholders(dict[key]),
          placeholders(en[key]),
          `${locale} "${key}" changed the placeholders`,
        );
      }
    });

    await t.test(`${locale} differs from English somewhere`, () => {
      const dict = DICTIONARIES[locale] as Record<string, string>;
      if (locale === DEFAULT_LOCALE) return;
      const identical = KEYS.filter((k) => dict[k] === en[k]);
      assert.ok(
        identical.length < KEYS.length * 0.5,
        `${locale} looks untranslated: ${identical.length}/${KEYS.length} identical`,
      );
    });
  }
});

test("failed link copy", async (t) => {
  // otp_expired and invalid links are shared with password recovery, so this
  // copy cannot tell a failed sign-up from a failed reset.
  const BODIES = [
    "auth.confirmLinkExpiredBody",
    "auth.confirmLinkInvalidBody",
  ] as const;

  // Each catalogue's wording for the sign-up form, which this copy used to
  // send failed links back to.
  const SIGNUP_FORM: Record<string, string> = {
    en: "sign-up",
    ha: "rijista",
    ig: "ndebanye aha",
    yo: "ìforúkọsílẹ̀",
  };

  await t.test("English points back to sign-in in both cases", () => {
    for (const key of BODIES) {
      const body = en[key].toLowerCase();
      assert.ok(!body.includes("sign-up") && !body.includes("sign up"), `${key} mentions sign-up`);
      assert.ok(body.includes("sign in"), `${key} does not point at sign-in`);
    }
  });

  await t.test("no locale sends a failed link to the sign-up form", () => {
    for (const locale of LOCALES) {
      const dict = DICTIONARIES[locale] as Record<string, string>;
      for (const key of BODIES) {
        const body = dict[key].toLowerCase();
        assert.ok(
          !body.includes(SIGNUP_FORM[locale].toLowerCase()) &&
            !body.includes(dict["auth.signUpTitle"].toLowerCase()),
          `${locale} ${key} directs the user to sign up`,
        );
      }
    }
  });
});

test("locales", async (t) => {
  await t.test("supports exactly four locales", () => {
    assert.deepEqual([...LOCALES], ["en", "ha", "yo", "ig"]);
  });

  await t.test("names each language endonymically", () => {
    assert.deepEqual(LOCALE_NAMES, {
      en: "English",
      ha: "Hausa",
      yo: "Yoruba",
      ig: "Igbo",
    });
  });

  await t.test("defaults to English", () => {
    assert.equal(DEFAULT_LOCALE, "en");
  });

  await t.test("isLocale accepts supported locales", () => {
    for (const locale of LOCALES) assert.equal(isLocale(locale), true);
  });

  await t.test("isLocale rejects anything else", () => {
    assert.equal(isLocale("fr"), false);
    assert.equal(isLocale(""), false);
    assert.equal(isLocale(undefined), false);
    assert.equal(isLocale(7), false);
  });
});

test("interpolation", async (t) => {
  await t.test("substitutes a named placeholder", () => {
    assert.equal(makeT("en")("alert.overdue.title", { name: "Rent" }), "Rent is overdue");
  });

  await t.test("substitutes several placeholders", () => {
    assert.equal(
      makeT("en")("mod.totalValue", { amount: "₦500,000" }),
      "Total value ₦500,000",
    );
  });

  await t.test("substitutes numbers as well as strings", () => {
    assert.equal(makeT("en")("things.count_one", { n: 1 }), "1 thing");
  });

  await t.test("leaves the template untouched when no params are given", () => {
    assert.equal(makeT("en")("alert.overdue.title"), "{name} is overdue");
  });

  await t.test("leaves unknown placeholders alone rather than blanking them", () => {
    assert.equal(makeT("en")("alert.overdue.title", { other: "x" }), "{name} is overdue");
  });

  await t.test("works in every locale", () => {
    for (const locale of LOCALES) {
      const out = makeT(locale)("alert.overdue.title", { name: "Rent" });
      assert.ok(!out.includes("{name}"), `${locale} left the placeholder in place`);
      assert.ok(out.length > 0);
    }
  });
});

test("pluralisation", async (t) => {
  await t.test("picks singular for one", () => {
    assert.equal(makeT("en").n("things.count", 1), "1 thing");
  });

  await t.test("picks plural for zero", () => {
    assert.equal(makeT("en").n("things.count", 0), "0 things");
  });

  await t.test("picks plural for two", () => {
    assert.equal(makeT("en").n("things.count", 2), "2 things");
  });

  await t.test("picks plural for many", () => {
    assert.equal(makeT("en").n("things.count", 42), "42 things");
  });

  await t.test("passes the count through as {n}", () => {
    assert.ok(makeT("en").n("row.overdue", 3).includes("3"));
  });

  await t.test("merges extra params", () => {
    assert.equal(
      makeT("en").n("alerts.count", 4, { status: "Stable" }),
      "4 alerts · Stable",
    );
  });

  await t.test("merges extra params for singular too", () => {
    assert.equal(
      makeT("en").n("alerts.count", 1, { status: "Stable" }),
      "1 alert · Stable",
    );
  });

  await t.test("works in every locale", () => {
    for (const locale of LOCALES) {
      const one = makeT(locale).n("row.overdue", 1);
      const many = makeT(locale).n("row.overdue", 5);
      assert.ok(one.includes("1"), `${locale} singular lost the count`);
      assert.ok(many.includes("5"), `${locale} plural lost the count`);
    }
  });
});

test("makeT", async (t) => {
  await t.test("exposes the active locale", () => {
    assert.equal(makeT("ha").locale, "ha");
    assert.equal(makeT("ig").locale, "ig");
  });

  await t.test("returns different strings per locale", () => {
    const en = makeT("en")("tab.profile");
    const ha = makeT("ha")("tab.profile");
    const yo = makeT("yo")("tab.profile");
    const ig = makeT("ig")("tab.profile");
    assert.equal(new Set([en, ha, yo, ig]).size, 4);
  });

  await t.test("falls back to English for an unknown locale", () => {
    const t2 = makeT("zz" as never);
    assert.equal(t2("tab.profile"), en["tab.profile"]);
  });
});

test("formatNaira", () => {
  assert.equal(formatNaira(1_200_000), "\u20A61,200,000");
});

test("generated copy follows the locale", async (t) => {
  const overdue = makeThing({ name: "Rent", kind: "rent", dueDate: iso(-2) });

  await t.test("alerts default to English when no translator is given", () => {
    const [alert] = buildAlerts([overdue], NOW);
    assert.equal(alert.title, "Rent is overdue");
  });

  await t.test("alerts render in the supplied locale", () => {
    for (const locale of ["ha", "yo", "ig"] as const) {
      const [alert] = buildAlerts([overdue], NOW, makeT(locale));
      assert.notEqual(alert.title, "Rent is overdue");
      assert.ok(!alert.title.includes("{"), `${locale} left a placeholder`);
    }
  });

  await t.test("alert titles differ across all four locales", () => {
    const titles = (["en", "ha", "yo", "ig"] as const).map(
      (locale) => buildAlerts([overdue], NOW, makeT(locale))[0].title,
    );
    assert.equal(new Set(titles).size, 4);
  });

  await t.test("status label and headline are localised", () => {
    const alerts = buildAlerts([overdue], NOW);
    assert.equal(computeLifeStatus([overdue], alerts, NOW).label, "Immediate attention");
    for (const locale of ["ha", "yo", "ig"] as const) {
      const status = computeLifeStatus([overdue], alerts, NOW, makeT(locale));
      assert.equal(status.level, "immediate");
      assert.notEqual(status.label, "Immediate attention");
      assert.notEqual(status.headline, "1 thing needs attention now.");
      assert.ok(!status.label.includes("{"), `${locale} left a placeholder`);
    }
  });

  await t.test("status headline uses the right plural form per locale", () => {
    const important = [makeAlert({ id: "1", priority: "important" })];
    const two = [makeAlert({ id: "1", priority: "important" }), makeAlert({ id: "2", priority: "important" })];
    for (const locale of ["en", "ha", "yo", "ig"] as const) {
      const tr = makeT(locale);
      const one = computeLifeStatus([], important, NOW, tr).headline;
      const many = computeLifeStatus([], two, NOW, tr).headline;
      assert.ok(one.includes("1"), `${locale} singular headline lost the count`);
      assert.ok(many.includes("2"), `${locale} plural headline lost the count`);
      assert.notEqual(one, many);
    }
  });

  await t.test("reminder copy is localised", () => {
    const doc = makeThing({ name: "Passport", kind: "document" });
    for (const locale of ["ha", "yo", "ig"] as const) {
      assert.notEqual(reminderCopy(doc, 14, makeT(locale)).title, "Passport expires in 14 days");
    }
  });

  await t.test("reminder copy interpolates the thing name in every locale", () => {
    const doc = makeThing({ name: "Passport", kind: "document" });
    for (const locale of LOCALES) {
      const copy = reminderCopy(doc, 14, makeT(locale));
      assert.ok(copy.title.includes("Passport"), `${locale} dropped the name`);
    }
  });
});