// Component-level tests for the flows the audit called untested:
// Onboarding, QuickAdd, ThingsScreen and CalendarScreen.
//
// Same harness as hooks.test.tsx: happy-dom for a DOM, the shared tsx loader
// for JSX and the "@" alias, createRoot + act for rendering. No testing
// library ΓÇö assertions read the real DOM the components produce.
import { register } from "node:module";
import test from "node:test";
import type { ReactElement } from "react";
import type { Root } from "react-dom/client";

import { assert, makeThing } from "./helpers.ts";
import type { useLivanta } from "../lib/useLivanta.ts";

register("./tsx-loader.mjs", import.meta.url);

const globals = globalThis as Record<string, unknown>;
const define = (key: string, value: unknown) =>
  Object.defineProperty(globals, key, { value, writable: true, configurable: true });

const { Window } = await import("happy-dom");
const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");

const win = new Window({ url: "https://livanta.test/" });
define("window", win);
define("document", win.document);
define("navigator", win.navigator);
define("location", win.location);
define("indexedDB", indexedDB);
define("IDBKeyRange", IDBKeyRange);
define("IS_REACT_ACT_ENVIRONMENT", true);

// React must load AFTER the globals above: a static import would hoist it to
// module init, where canUseDOM is false and React 19 never attaches its
// continuous ("input") listeners to the root.
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const { default: Onboarding } = await import("../components/Onboarding.tsx");
const { QuickAddSheet } = await import("../components/QuickAdd.tsx");
const { ThingsScreen } = await import("../components/screens/ThingsScreen.tsx");
const { CalendarScreen } = await import("../components/screens/CalendarScreen.tsx");
const { makeT } = await import("../lib/i18n.ts");
const { en } = await import("../lib/locales/en.ts");
const { daysUntil } = await import("../lib/risk.ts");

type Desk = ReturnType<typeof useLivanta>;

interface View {
  root: Root;
  /** happy-dom's element types do not match lib.dom; cast at the boundary. */
  container: Element;
  text: () => string;
  click: (selector: string) => void;
  setInput: (selector: string, value: string) => void;
  unmount: () => void;
}

function render(node: ReactElement): View {
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  act(() => {
    root.render(node);
  });

  return {
    root,
    container: container as unknown as Element,
    text: () => container.textContent ?? "",
    click(selector: string) {
      const el = container.querySelector(selector);
      if (!el) throw new Error(`no element matches ${selector}`);
      act(() => {
        (el as unknown as HTMLElement).click();
      });
    },
    setInput(selector: string, value: string) {
      const el = container.querySelector(selector);
      if (!el) throw new Error(`no element matches ${selector}`);
      // React tracks the current value through the native setter, so a plain
      // assignment is invisible to its change-event plugin. Go around it.
      const setter = Object.getOwnPropertyDescriptor(
        win.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(el, value);
      act(() => {
        el.dispatchEvent(new win.Event("input", { bubbles: true }));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function deskWith(things: ReturnType<typeof makeThing>[]): Desk {
  return {
    things,
    t: makeT("en"),
  } as unknown as Desk;
}

const NOW = new Date(2026, 9, 3, 9, 0);

test("Onboarding", async (t) => {
  await t.test("welcome step switches language in place", () => {
    const view = render(
      <Onboarding
        locale="en"
        step={0}
        onStepChange={() => {}}
        onDone={() => {}}
        onSignIn={() => {}}
        onDemo={() => {}}
      />,
    );
    assert.equal(view.container.querySelector(".ob")?.getAttribute("lang"), "en");
    view.click('.chips button[lang="ha"]');
    assert.equal(view.container.querySelector(".ob")?.getAttribute("lang"), "ha");
    view.unmount();
  });

  await t.test("get started advances, demo hands over the chosen locale", () => {
    let demoLocale: string | null = null;
    const view = render(
      <Onboarding
        locale="yo"
        step={0}
        onStepChange={() => {}}
        onDone={() => {}}
        onSignIn={() => {}}
        onDemo={(l) => {
          demoLocale = l;
        }}
      />,
    );
    view.click("button.btn--primary");
    // The controlled step stays put without a parent, but the demo button is
    // live on this step and reports the locale picked above. It is the last
    // ghost button on the welcome screen.
    const ghosts = view.container.querySelectorAll("button.btn--ghost");
    act(() => {
      (ghosts[ghosts.length - 1] as HTMLElement).click();
    });
    assert.equal(demoLocale, "yo");
    view.unmount();
  });

  await t.test("category step blocks continue until something is picked", () => {
    let next: number | null = null;
    const view = render(
      <Onboarding
        locale="en"
        step={2}
        onStepChange={(s) => {
          next = s;
        }}
        onDone={() => {}}
        onSignIn={() => {}}
        onDemo={() => {}}
      />,
    );
    const continueBtn = view.container.querySelector<HTMLButtonElement>(
      ".quick-grid .btn--primary",
    );
    assert.ok(continueBtn?.disabled, "continue starts disabled");

    view.click(".tile");
    assert.equal(
      view.container.querySelector(".tile")?.getAttribute("aria-pressed"),
      "true",
    );
    assert.ok(!continueBtn?.disabled, "continue enables after a pick");

    view.click(".quick-grid .btn--primary");
    assert.equal(next, 3);
    view.unmount();
  });

  await t.test("first-things step stays disabled until a date is given", () => {
    let next: number | null = null;
    const view = render(
      <Onboarding
        locale="en"
        step={3}
        onStepChange={(s) => {
          next = s;
        }}
        onDone={() => {}}
        onSignIn={() => {}}
        onDemo={() => {}}
      />,
    );
    const continueBtn = view.container.querySelector<HTMLButtonElement>(
      ".quick-grid .btn--primary",
    );
    assert.ok(continueBtn?.disabled, "no dates, no continue");

    view.setInput('input[type="date"]', "2026-12-25");
    assert.ok(!continueBtn?.disabled, "one date is enough");
    view.click(".quick-grid .btn--primary");
    assert.equal(next, 4);
    view.unmount();
  });

  await t.test("not-now finishes with the picked locale and no starter things", () => {
    // Boxed: TypeScript does not track assignments made inside the callback.
    const done: {
      value: { locale: string; categories: string[]; firstThings: unknown[] } | null;
    } = { value: null };
    const view = render(
      <Onboarding
        locale="ig"
        step={4}
        onStepChange={() => {}}
        onDone={(r) => {
          done.value = r;
        }}
        onSignIn={() => {}}
        onDemo={() => {}}
      />,
    );
    view.click("button.btn--ghost");
    assert.ok(done.value, "finish fired");
    assert.equal(done.value?.locale, "ig");
    assert.deepEqual(done.value?.categories, []);
    assert.deepEqual(done.value?.firstThings, []);
    view.unmount();
  });
});

test("QuickAddSheet", async (t) => {
  await t.test("offers every quick type, then opens the editor for the pick", () => {
    const view = render(
      <QuickAddSheet t={makeT("en")} onClose={() => {}} onSave={() => {}} />,
    );
    assert.equal(view.container.querySelectorAll(".tile").length, 10);
    view.click(".tile");
    // The sheet title becomes the picked type's label.
    assert.ok(view.text().includes(en["qa.home"]));
    view.unmount();
  });

  await t.test("narrowing to a category shows only that category", () => {
    const view = render(
      <QuickAddSheet
        t={makeT("en")}
        onClose={() => {}}
        onSave={() => {}}
        initialCategory="money"
      />,
    );
    const tiles = [...view.container.querySelectorAll(".tile__label")].map(
      (n) => n.textContent,
    );
    assert.deepEqual(tiles, [en["qa.bill"], en["qa.subscription"]]);
    view.unmount();
  });

  await t.test("a preset skips the picker and lands on the form", () => {
    const view = render(
      <QuickAddSheet
        t={makeT("en")}
        onClose={() => {}}
        onSave={() => {}}
        initial={{ label: "Birthday", kind: "birthday", category: "family" }}
      />,
    );
    assert.ok(view.text().includes(en["qa.family"]));
    assert.equal(view.container.querySelector(".tile"), null, "no picker grid");
    view.unmount();
  });
});

test("ThingsScreen", async (t) => {
  const overdue = makeThing({ id: "late", name: "Late rent", dueDate: "2026-10-01" });
  const today = makeThing({ id: "now", name: "Power bill", dueDate: "2026-10-03" });
  const done = makeThing({
    id: "done",
    name: "Finished task",
    status: "completed",
    dueDate: null,
  });
  const desk = deskWith([overdue, today, done]);

  const props = {
    desk,
    onOpenThing: () => {},
    onAdd: () => {},
    now: NOW,
    dayDiff: daysUntil,
  };

  await t.test("active things show, completed ones stay hidden", () => {
    const view = render(<ThingsScreen {...props} />);
    assert.ok(view.text().includes("Late rent"));
    assert.ok(view.text().includes("Power bill"));
    assert.ok(!view.text().includes("Finished task"));
    view.unmount();
  });

  await t.test("the completed filter reveals what was hidden", () => {
    const view = render(<ThingsScreen {...props} />);
    const chips = [...view.container.querySelectorAll(".chip--quiet")];
    const completed = chips.find((c) => c.textContent?.includes("completed"));
    assert.ok(completed, "a completed chip exists");
    act(() => {
      (completed as HTMLElement).click();
    });
    assert.ok(view.text().includes("Finished task"));
    assert.ok(!view.text().includes("Late rent"));
    view.unmount();
  });

  await t.test("search narrows by name and the clear button resets it", () => {
    const view = render(<ThingsScreen {...props} />);
    view.setInput("#t-search", "power");
    assert.ok(view.text().includes("Power bill"));
    assert.ok(!view.text().includes("Late rent"));
    view.click(".searchbar__clear");
    assert.ok(view.text().includes("Late rent"));
    view.unmount();
  });

  await t.test("a category chip filters the list", () => {
    // Both fixtures default to the money category; move one to make the
    // filter observable.
    const mixed = deskWith([
      makeThing({ id: "a", name: "Money thing", category: "money", dueDate: "2026-10-02" }),
      makeThing({ id: "b", name: "Home thing", category: "home", dueDate: "2026-10-02" }),
    ]);
    const view = render(<ThingsScreen {...props} desk={mixed} />);
    const homeChip = [...view.container.querySelectorAll(".chip")].find((c) =>
      c.textContent?.includes("Home"),
    );
    assert.ok(homeChip);
    act(() => {
      (homeChip as HTMLElement).click();
    });
    assert.ok(view.text().includes("Home thing"));
    assert.ok(!view.text().includes("Money thing"));
    view.unmount();
  });
});

test("CalendarScreen", async (t) => {
  const thing = makeThing({ id: "xmas", name: "Christmas list", dueDate: "2026-12-25" });
  const desk = deskWith([thing]);

  const props = {
    desk,
    onOpenThing: () => {},
    onAdd: () => {},
    now: NOW,
    dayDiff: daysUntil,
  };

  await t.test("renders a full 42-cell month grid", () => {
    const view = render(<CalendarScreen {...props} />);
    assert.equal(view.container.querySelectorAll(".month__grid .day").length, 42);
    view.unmount();
  });

  await t.test("clicking the due day lists the thing", () => {
    const view = render(<CalendarScreen {...props} />);
    // December is two months ahead of the real clock; step forward twice.
    view.click('button[aria-label="Next month"]');
    view.click('button[aria-label="Next month"]');
    const dueDay = view.container.querySelector('.day[aria-label*="item"]');
    assert.ok(dueDay, "December's due day advertises its item count");
    act(() => {
      (dueDay as HTMLElement).click();
    });
    assert.ok(view.text().includes("Christmas list"));
    view.unmount();
  });

  await t.test("prev and next change the month title", () => {
    const view = render(<CalendarScreen {...props} />);
    const title = () => view.container.querySelector(".month__title")?.textContent;
    const before = title();
    view.click('button[aria-label="Previous month"]');
    assert.notEqual(title(), before);
    view.click('button[aria-label="Next month"]');
    assert.equal(title(), before);
    view.unmount();
  });

  await t.test("an empty day offers the empty state with an add action", () => {
    const view = render(<CalendarScreen {...props} />);
    // The cursor opens on today (October), which has no items in this desk.
    assert.ok(view.text().includes(en["cal.emptyTitle"]));
    view.unmount();
  });
});
