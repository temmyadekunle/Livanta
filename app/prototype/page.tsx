import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import "./prototype.css";

export const metadata: Metadata = {
  title: "Prototype & product presentation",
  description:
    "Livanta's mobile app prototype: screen captures, screen inventory, user flows, roadmap and a live demo script. Prepared by Temitope Adekunle.",
};

const SHOTS: { file: string; title: string; blurb: string }[] = [
  {
    file: "welcome",
    title: "Welcome",
    blurb:
      "First run: wordmark, language picker (English, Hausa, Yoruba, Igbo), Get Started, sign-in path, and the one-tap demo shortcut.",
  },
  {
    file: "value-prop",
    title: "Value props",
    blurb:
      "Know what needs your attention · Take action with confidence · Everything in one place.",
  },
  {
    file: "home",
    title: "Home",
    blurb:
      "Status hero, urgent / important / on-track reading, needs attention, coming soon, quick add and life areas.",
  },
  {
    file: "quick-add",
    title: "Quick add",
    blurb:
      "Capture in seconds: name, category, kind, amount, date and recurrence in one sheet.",
  },
  {
    file: "life",
    title: "Life",
    blurb:
      "The hub: five life areas with live counts, search, category and status filters, plus trusted providers.",
  },
  {
    file: "detail",
    title: "Thing detail",
    blurb:
      "The full record: amount, due date, notes, details — with mark handled, edit and delete.",
  },
  {
    file: "module-documents",
    title: "Documents module",
    blurb:
      "Drill into a single life area with its own header, list and actions.",
  },
  {
    file: "alerts",
    title: "Alerts",
    blurb:
      "Filter chips, then needs attention / coming up / completed. Dismiss or review each alert.",
  },
  {
    file: "calendar",
    title: "Calendar",
    blurb:
      "Month grid with due-day dots, day agenda and the upcoming list.",
  },
  {
    file: "profile",
    title: "Profile",
    blurb:
      "Account, security, language, notifications, reminder schedule, export, help and legal.",
  },
];

const SEED_ROWS: [string, string, string, string, string][] = [
  ["Rent", "home · rent", "1,200,000", "due in 18 days", "Pay before the 25th (Mr. Okonkwo)"],
  ["Electricity", "money · utility", "45,200", "due in 1 day", "Ikeja Electric — the urgent alert"],
  ["Internet subscription", "money · subscription", "20,000", "due in 3 days", "Spectranet 10GB + 4G router"],
  ["Netflix", "money · subscription", "8,500", "due in 6 days", "Subscription creep"],
  ["Vehicle insurance", "transport · insurance", "85,000", "due in 12 days", "Toyota Camry, ABC-123-Lagos"],
  ["School fees", "family · school fee", "150,000", "due in 14 days", "Command Primary, assigned to Partner"],
  ["Driver's licence", "documents · document", "—", "expires in 45 days", "FRSC renewal"],
  ["Passport", "documents · document", "—", "expires in 240 days", "Long-horizon item"],
  ["LG Refrigerator", "home · asset", "465,000", "warranty ends in 21 days", "12-month warranty lapsing"],
  ["Generator service", "home · maintenance", "45,000", "every 90 days, last 120 days ago", "Interval-based, overdue"],
  ["Toyota Camry oil change", "transport · maintenance", "30,000", "every 120 days, last 200 days ago", "Interval-based, overdue"],
  ["John the electrician", "services · provider", "—", "called 45 days ago", "Saved provider with rating"],
];

const FLOWS: [string, string][] = [
  [
    "First open → demo",
    "Splash “Your life, organized.” → welcome → Open with demo data → a fully populated Home in one tap.",
  ],
  [
    "Triage the morning",
    "Home says “1 thing needs attention now.” → Review → Alerts → Electricity renews in one day → open the record → Mark handled → it leaves Needs attention and the status reading updates.",
  ],
  [
    "Filter the noise",
    "Alerts → tap the Bills chip → only money alerts remain → All restores the full list. Sections stay ordered: needs attention, coming up, completed.",
  ],
  [
    "Add before you forget",
    "Any tab → + → quick add (name, category, kind, amount, date, recurrence) → it appears in Life, Calendar and — when close enough — Alerts.",
  ],
  [
    "Browse life as a hub",
    "Home → Life areas → five areas with counts → Documents → Passport detail → edit or mark handled. Back returns to where you were.",
  ],
  [
    "Call the plumber",
    "Life → Trusted providers → John the electrician → Call or WhatsApp straight from the card.",
  ],
  [
    "Plan the month",
    "Home → Coming soon → Calendar → dots on due days → tap a day → agenda → upcoming list.",
  ],
  [
    "Trust check",
    "Profile → switch language to Hausa and back → Export my data (JSON) → Delete all my data (confirmed). No tracking anywhere.",
  ],
];

const SCRIPT: [string, string][] = [
  [
    "0:00–0:20",
    "Hook — “Everyone has a month where rent, an electricity bill and a licence renewal all land in the same week. Livanta sees that week coming.” Show the splash line.",
  ],
  [
    "0:20–0:40",
    "One-tap demo — Open with demo data. Land on Home, point at the status reading and the urgent / important / on-track stats.",
  ],
  [
    "0:40–1:40",
    "The alert loop — into Alerts: nine alerts, filter chips. Electricity renews in one day → open → Mark handled → card leaves Needs attention, counts update. “It saw it, told me, I acted, it's gone.”",
  ],
  [
    "1:40–2:40",
    "Life as a hub — five areas with live counts, search, Documents → Passport detail, providers with call and WhatsApp.",
  ],
  [
    "2:40–3:25",
    "Capture — floating + → type a name, pick category and date, save → it shows up in Calendar. “Two seconds to add, and from then on it watches it for you.”",
  ],
  [
    "3:25–4:10",
    "Calendar + Profile — month dots and upcoming; switch language to Hausa and back; mention export, delete, and that nothing is tracked.",
  ],
  [
    "4:10–4:40",
    "Close — “Local-first, offline, free, private — web, installable, signed Android APK.” Roadmap in one breath: sync next, payments later, free tier stays free. Repeat the positioning.",
  ],
];

export default function PrototypePage() {
  return (
    <main className="proto">
      <Link className="proto__back" href="/landing/">
        &larr; Back to Livanta
      </Link>

      <header className="proto__hero">
        <p className="proto__eyebrow">Mobile app prototype &amp; product presentation</p>
        <h1>Livanta — your life, organized. Your problems, anticipated.</h1>
        <p className="proto__tagline">
          A local-first app that keeps a household&apos;s rent, bills, documents,
          vehicles and schedules in one place — and warns you before each one
          becomes an emergency.
        </p>
        <p className="proto__meta">
          Prepared by Temitope Adekunle &middot; v0.1.0 (versionCode 3) &middot; 9
          October 2026 &middot; web, installable PWA, signed Android APK
        </p>
        <div className="proto__actions">
          <Link className="proto__btn" href="/">
            Open the live app
          </Link>
          <Link className="proto__btn proto__btn--ghost" href="/landing/">
            Marketing site
          </Link>
          <a
            className="proto__btn proto__btn--ghost"
            href="https://github.com/temmyadekunle/Livanta/releases"
          >
            Download the APK
          </a>
        </div>
        <div className="proto__stats">
          <div className="proto__stat">
            <b>5 tabs</b>
            <span>Home &middot; Life &middot; Alerts &middot; Calendar &middot; Profile</span>
          </div>
          <div className="proto__stat">
            <b>4 languages</b>
            <span>English &middot; Hausa &middot; Yoruba &middot; Igbo</span>
          </div>
          <div className="proto__stat">
            <b>12 seeded</b>
            <span>things in the demo household</span>
          </div>
          <div className="proto__stat">
            <b>9 alerts</b>
            <span>derived at demo seed time</span>
          </div>
          <div className="proto__stat">
            <b>368 tests</b>
            <span>+ smoke, CSP and responsive QA</span>
          </div>
          <div className="proto__stat">
            <b>0 trackers</b>
            <span>no cookies, no analytics, CSP-enforced</span>
          </div>
        </div>
      </header>

      <ul className="proto__toc">
        <li>
          <a href="#screens">Ten screens</a>
        </li>
        <li>
          <a href="#architecture">Architecture</a>
        </li>
        <li>
          <a href="#onboarding">Onboarding</a>
        </li>
        <li>
          <a href="#demo-data">Demo data</a>
        </li>
        <li>
          <a href="#flows">User flows</a>
        </li>
        <li>
          <a href="#platform">Platform</a>
        </li>
        <li>
          <a href="#roadmap">MVP &amp; roadmap</a>
        </li>
        <li>
          <a href="#script">Demo script</a>
        </li>
        <li>
          <a href="#run">Run it yourself</a>
        </li>
      </ul>

      <section id="screens">
        <h2>The app in ten screens</h2>
        <p>
          Captured from this build at 390&times;844 (@2x) with the demo
          household loaded. Tap any capture for the full-size image. Onboarding
          steps 3–5, the sign-in sheet and every empty state are reachable in
          the app but not captured here.
        </p>
        <div className="proto__shots">
          {SHOTS.map((s) => (
            <figure className="proto__shot" key={s.file}>
              <a href={`/prototype/${s.file}.png`} target="_blank" rel="noreferrer">
                <Image
                  src={`/prototype/${s.file}.png`}
                  alt={`Livanta screen — ${s.title}`}
                  width={780}
                  height={1688}
                  loading="lazy"
                />
              </a>
              <figcaption>
                <b>{s.title}</b>
                <span>{s.blurb}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section id="architecture">
        <h2>Information architecture</h2>
        <pre>
          <code>{`Splash "Your life, organized."
 └ Onboarding (first run) ── or ── "Open with demo data"
    └ App shell
       ├ Home      — status, attention, coming soon, quick add, life areas
       ├ Life      — areas → modules · thing list · providers
       ├ Alerts    — filters · needs attention · coming up · completed
       ├ Calendar  — month grid · day agenda · upcoming
       └ Profile   — account, language, notifications, data, help, legal
          Stack:  module drill-in · sign-in
          Sheets: quick add · thing detail · thing editor`}</code>
        </pre>
        <p className="proto__note">
          The original Things list became the <strong>Life</strong> hub;
          providers moved into Life under their own section; the standalone
          notifications screen became the <strong>Alerts</strong> tab so triage
          is one tap from anywhere. The app bar carries each screen&apos;s
          title, count and status — there is no second in-content heading
          competing with it.
        </p>
      </section>

      <section id="onboarding">
        <h2>Onboarding walkthrough</h2>
        <ol className="proto-steps">
          <li>
            <strong>Welcome</strong> — wordmark, lead copy, language picker,
            Get Started, a quiet sign-in path, and{" "}
            <strong>Open with demo data</strong> (the presentation route).
          </li>
          <li>
            <strong>Value props</strong> — “Stay ahead of everyday life” with
            three cards: know what needs your attention, take action with
            confidence, everything in one place.
          </li>
          <li>
            <strong>Choose what to manage</strong> — Home, Transport, Money,
            Documents, Family, Tasks, Services. Skippable.
          </li>
          <li>
            <strong>First thing</strong> — “Let&apos;s help you prevent
            problems,” with example chips (Vehicle insurance, Electricity bill,
            Passport). Skippable.
          </li>
          <li>
            <strong>Notifications</strong> — “Never miss an important date” →
            Allow or Not Now. Permission stays optional and revocable.
          </li>
        </ol>
        <p>
          Every step is translated, resumable, and never blocks the demo path.
        </p>
      </section>

      <section id="demo-data">
        <h2>Demo data</h2>
        <p>
          One household seeded on first run of the demo. Dates are relative to
          the day the demo opens, so the story always reads correctly. Currency
          is NGN throughout; household owner: Temmy Adekunle.
        </p>
        <div className="proto__tblwrap">
          <table>
            <thead>
              <tr>
                <th>Thing</th>
                <th>Category · kind</th>
                <th>Amount (₦)</th>
                <th>Timing</th>
                <th>Story beat</th>
              </tr>
            </thead>
            <tbody>
              {SEED_ROWS.map((r) => (
                <tr key={r[0]}>
                  <th>{r[0]}</th>
                  <td>{r[1]}</td>
                  <td className="num">{r[2]}</td>
                  <td>{r[3]}</td>
                  <td>{r[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="flows">
        <h2>Primary user flows</h2>
        <dl className="proto__flows">
          {FLOWS.map(([name, body]) => (
            <div className="proto__flow" key={name}>
              <dt>{name}</dt>
              <dd>{body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="platform">
        <h2>Platform &amp; architecture</h2>
        <pre>
          <code>{`Next.js (App Router, output: "export")
 ├─ app/            landing, privacy, terms, translations, prototype
 ├─ components/     shell + screens + sheets
 ├─ lib/            things, risk engine, alerts, IndexedDB (lifedesk), locales
 └─ public/         sw.js, manifest, offline.html, prototype/*.png
        │ npm run build  →  out/
        ▼
Cloudflare Workers (wrangler deploy)  — site, PWA, CSP headers
Android WebView wrapper (build-android.ps1) — signed APK → GitHub Release`}</code>
        </pre>
        <ul>
          <li>
            <strong>Storage:</strong> IndexedDB <code>lifedesk</code> (things,
            alerts, members, settings); no server round-trip in the core loop.
          </li>
          <li>
            <strong>Offline:</strong> service worker caches the shell; every
            feature works with the network off.
          </li>
          <li>
            <strong>Code-split:</strong> home and shell load eagerly; the other
            tabs fetch on navigation, then cache.
          </li>
          <li>
            <strong>Gates:</strong> typecheck, lint, 368 tests, browser smoke
            (0 page errors), CSP check, 5-viewport responsive QA (0 findings).
          </li>
          <li>
            <strong>Distribution:</strong> Workers site · installable PWA ·{" "}
            <code>livanta-0.1.0-release.apk</code> (versionCode 3) on GitHub
            Releases.
          </li>
        </ul>
      </section>

      <section id="roadmap">
        <h2>MVP, next &amp; future</h2>
        <div className="proto__grid">
          <div className="proto__lane proto__lane--now">
            <span className="proto__badge">MVP — shipped</span>
            <h3>v0.1 (this prototype)</h3>
            <ul>
              <li>Local-first things, alerts, calendar, life hub</li>
              <li>Quick add, detail, edit, derived priorities</li>
              <li>Five-tab shell with splash and five-step onboarding</li>
              <li>Demo mode with seeded Nigerian household</li>
              <li>Four languages, providers with call/WhatsApp</li>
              <li>JSON export &amp; import, delete-all, PWA offline, signed APK</li>
              <li>Calendar-correct recurrence; local Android reminders (APK)</li>
              <li>No tracking, CSP enforced</li>
            </ul>
          </div>
          <div className="proto__lane">
            <span className="proto__badge">Next</span>
            <h3>v0.2–0.3</h3>
            <ul>
              <li>Optional accounts &amp; sync (Supabase, fail-open cache built)</li>
              <li>Household members shared (data model ready)</li>
              <li>Push / email reminder channels</li>
              <li>Play Store &amp; App Store listings</li>
              <li>Alert snooze and custom rules</li>
            </ul>
          </div>
          <div className="proto__lane">
            <span className="proto__badge">Future</span>
            <h3>v1.x</h3>
            <ul>
              <li>Payment rails (Paystack ready, not enabled in beta)</li>
              <li>Predictive anticipation of household costs</li>
              <li>OS widgets for today&apos;s due items</li>
              <li>Document photos (dates only — never ID numbers)</li>
              <li>iOS build; richer provider ratings</li>
            </ul>
          </div>
        </div>
        <p className="proto__note">
          Sequencing principle: ship trust first (local, private, exportable),
          sync second (opt-in only), money third — never by carving up the free
          tier after people depend on it.
        </p>
      </section>

      <section id="script">
        <h2>Live demo script (3–5 minutes)</h2>
        <p>
          Start at the splash of{" "}
          <Link href="/">livanta.folababy02.workers.dev</Link>. If the network
          fails, the ten captures above show every flow.
        </p>
        <ol className="proto__script">
          {SCRIPT.map(([time, body]) => (
            <li key={time}>
              <b>{time}</b>
              <span>{body}</span>
            </li>
          ))}
        </ol>
      </section>

      <section id="run">
        <h2>Run it yourself</h2>
        <h3>Local development</h3>
        <pre>
          <code>{`npm install
npm run dev          # http://localhost:3100`}</code>
        </pre>
        <p>
          In the app, tap <strong>Open with demo data</strong> on the welcome
          screen (or clear site data for a fresh first run).
        </p>
        <h3>Full verification</h3>
        <pre>
          <code>{`npm run typecheck
npm run lint
npm test                     # 368 tests
npm run smoke                # builds + walks every tab in a real browser
npm run check:csp            # builds + verifies the Content-Security-Policy
npm run qa:responsive        # builds + 5 viewports, 0 findings`}</code>
        </pre>
        <h3>Regenerate these captures</h3>
        <pre>
          <code>{`npm run build
node scripts/capture-prototype.mjs   # writes public/prototype/*.png`}</code>
        </pre>
        <p>
          The script serves the export, opens the demo and walks the ten
          states. This page reads the images at request time, so a re-capture
          refreshes the presentation without a code change.
        </p>
        <h3>Ship</h3>
        <pre>
          <code>{`npm run build
npx wrangler deploy                 # live site (run twice if the first errors)
.\\build-android.ps1 -SkipWeb        # signs with android/keystore/release.keystore
gh release upload v0.1.0 out\\livanta-0.1.0-release.apk --repo temmyadekunle/Livanta --clobber`}</code>
        </pre>
        <p>
          The full write-up lives in <code>docs/prototype.md</code> in the
          repository.
        </p>
      </section>

      <footer className="proto__foot">
        Prepared by Temitope Adekunle &middot; Livanta v0.1.0 &middot; beta,
        invite-only &middot; this presentation accompanies the working
        prototype. See also: <Link href="/privacy/">privacy policy</Link> &middot;{" "}
        <Link href="/terms/">terms of use</Link>.
      </footer>
    </main>
  );
}
