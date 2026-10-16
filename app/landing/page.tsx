import type { Metadata } from "next";
import Link from "next/link";

import "./landing.css";

import { Icon, type IconName } from "@/components/Icons";
import { Logo } from "@/components/Logo";
import { LandingNav } from "@/components/landing/LandingNav";
import { DownloadButtons, StickyCta } from "@/components/landing/DownloadButtons";
import { Faq } from "@/components/landing/Faq";
import { APK_VERSION, DIRECT_APK_URL, apkSizeLabel } from "@/lib/landing/store";
import {
  PhoneFrame,
  PhoneHome,
  PhoneThings,
  PhoneCalendar,
  PhoneModule,
  PhoneAdd,
  PhoneAlerts,
  UpcomingTable,
} from "@/components/landing/PhoneFrame";

const SITE_URL = "https://livanta.folababy02.workers.dev";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Livanta — the life admin app for things you have to keep up with",
  description:
    "Livanta keeps track of your rent, bills, documents, vehicles and service schedules in one place, on your own device. Works offline. Coming soon to Google Play and the App Store.",
  alternates: { canonical: "/landing/" },
  openGraph: {
    type: "website",
    url: "/landing/",
    siteName: "Livanta",
    title: "Livanta — the life admin app for things you have to keep up with",
    description:
      "One place for rent, bills, documents, vehicles and service schedules. Works offline, keeps your data on your device.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Livanta — the life admin app for things you have to keep up with",
    description:
      "One place for rent, bills, documents, vehicles and service schedules. Works offline.",
  },
  robots: { index: true, follow: true },
};

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                  */
/* ------------------------------------------------------------------ */

function SectionHead({
  eyebrow,
  title,
  lede,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  align?: "center" | "start";
}) {
  return (
    <div className={`lp-head lp-head--${align}`}>
      <p className="lp-eyebrow">{eyebrow}</p>
      <h2 className="lp-h2">{title}</h2>
      {lede && <p className="lp-lede">{lede}</p>}
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="lp-card">
      <span className="lp-card__icon">
        <Icon name={icon} size={21} />
      </span>
      <h3 className="lp-card__title">{title}</h3>
      <p className="lp-card__body">{children}</p>
    </article>
  );
}

/** A screenshot with a caption. */
function Screen({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="lp-screen">
      {children}
      <figcaption className="lp-screen__cap">{caption}</figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function LandingPage() {
  // One instant, captured at build time and passed to every mockup. The mockups
  // reuse the real app screens, and those compute due-date text while
  // rendering; without a shared clock the build would write one answer into
  // the HTML and the reader's browser would compute another, which React
  // treats as a hydration mismatch. See lib/landing/showcase.ts.
  const BUILD_NOW = new Date();
  return (
    <div className="lp" id="top">
      <LandingNav />

      <main id="main">
        {/* ---------------- Hero ---------------- */}
        <section className="lp-hero">
          <div className="lp-hero__glow" aria-hidden="true" />
          <div className="lp-wrap lp-hero__grid">
            <div className="lp-hero__copy">
              <p className="lp-eyebrow">
                <span className="lp-pill">
                  <span className="lp-pill__dot" aria-hidden="true" />
                  Coming soon to Google Play &amp; the App Store
                </span>
              </p>
              <h1 className="lp-h1">
                The things you have to keep up with,
                <span className="lp-h1__accent"> all in one place.</span>
              </h1>
              <p className="lp-hero__sub">
                Rent, school fees, licences, insurance, the generator that needs
                servicing every 90 days. Livanta remembers what is coming so you do
                not have to hold it all in your head.
              </p>

              <div className="lp-hero__cta">
                <a className="btn btn--primary btn--lg" href="#download">
                  <Icon name="download" size={18} />
                  Download the App
                </a>
                <Link className="btn btn--ghost btn--lg" href="/">
                  Try it in your browser
                </Link>
              </div>

              <DownloadButtons size="md" align="start" />

              <ul className="lp-promises">
                <li>
                  <Icon name="check" size={15} />
                  Works offline
                </li>
                <li>
                  <Icon name="check" size={15} />
                  No account needed
                </li>
                <li>
                  <Icon name="check" size={15} />
                  Your data stays on your device
                </li>
              </ul>
            </div>

            <div className="lp-hero__art">
              <div className="lp-hero__phone">
                <PhoneFrame
                  tab="home"
                  label="Livanta's home screen: a greeting, a count of what needs attention, and the next few due dates."
                >
                  <PhoneHome now={BUILD_NOW} />
                </PhoneFrame>
              </div>
              <div className="lp-hero__chip lp-hero__chip--a">
                <Icon name="bell" size={15} />
                <span>Electricity due in 2 days</span>
              </div>
              <div className="lp-hero__chip lp-hero__chip--b">
                <Icon name="wrench" size={15} />
                <span>Generator service overdue</span>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- Problem ---------------- */}
        <section className="lp-section" id="problem">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="The problem"
              title="Adulting is mostly paperwork you forgot you had"
              lede="Nobody sets out to forget their passport expires in eight months. It just happens, between the rent, the school fees, and the car that needs servicing."
            />

            <div className="lp-grid-3">
              <FeatureCard icon="inbox" title="Everything is scattered">
                A text message here, a photo of a receipt there, a memory that
                something is due soon. None of it is in one place, so none of it
                counts as being managed.
              </FeatureCard>
              <FeatureCard icon="calendar" title="Deadlines arrive quietly">
                A lapsed licence or a missed insurance renewal does not announce
                itself. You find out at the worst possible moment, usually at a
                FRSC office or a police station.
              </FeatureCard>
              <FeatureCard icon="repeat" title="Repeats are the worst part">
                Rent, subscriptions, servicing intervals. Same thing, over and
                over, and impossible to hold reliably in your head.
              </FeatureCard>
            </div>
          </div>
        </section>

        {/* ---------------- Solution ---------------- */}
        <section className="lp-section lp-section--tint" id="solution">
          <div className="lp-wrap lp-split">
            <div className="lp-split__copy">
              <SectionHead
                align="start"
                eyebrow="The solution"
                title="Give everything a place and a date"
                lede="Add the thing once. Livanta keeps it, knows how often it comes back around, and tells you when it needs you."
              />
              <ul className="lp-checks">
                <li>
                  <Icon name="checkCircle" size={18} />
                  <span>
                    <strong>One list, not twelve apps.</strong> Bills,
                    documents, vehicles, assets and services in a single view.
                  </span>
                </li>
                <li>
                  <Icon name="checkCircle" size={18} />
                  <span>
                    <strong>Dates it can actually compute.</strong> Enter a due
                    date once and every related thing is counted from there.
                  </span>
                </li>
                <li>
                  <Icon name="checkCircle" size={18} />
                  <span>
                      <strong>Nothing leaves your phone.</strong> No account,
                      no server holding your family&apos;s details.
                  </span>
                </li>
              </ul>
              <div className="lp-split__cta">
                <a className="btn btn--primary" href="#download">
                  Download the App
                </a>
                <Link className="btn btn--ghost" href="/">
                  Open the web app
                </Link>
              </div>
            </div>
            <div className="lp-split__art">
              <PhoneFrame
                tab="life"
                label="Livanta's Life screen: every item, searchable, with filters."
              >
                <PhoneThings now={BUILD_NOW} />
              </PhoneFrame>
            </div>
          </div>
        </section>

        {/* ---------------- How it works ---------------- */}
        <section className="lp-section" id="how-it-works">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="How it works"
              title="Three steps, then it runs itself"
            />
            <ol className="lp-steps">
              <li className="lp-step">
                <span className="lp-step__num">1</span>
                <h3>Add what you own and owe</h3>
                <p>
                  Rent, a passport, a generator, the car. It takes under a minute
                  per thing, and nothing is mandatory beyond a name.
                </p>
              </li>
              <li className="lp-step">
                <span className="lp-step__num">2</span>
                <h3>Set the date or the interval</h3>
                <p>
                  Give it a due date, or say it repeats every 30, 90 or 180 days.
                  Livanta works out the next one by itself.
                </p>
              </li>
              <li className="lp-step">
                <span className="lp-step__num">3</span>
                <h3>Get told early enough to act</h3>
                <p>
                  Alerts arrive with time to spare, so renewing a licence is a
                  Tuesday errand rather than a crisis.
                </p>
              </li>
            </ol>
          </div>
        </section>

        {/* ---------------- Killer feature ---------------- */}
        <section className="lp-section lp-killer" id="service-intervals">
          <div className="lp-wrap lp-split lp-split--reverse">
            <div className="lp-split__art">
              <PhoneFrame
                tab="life"
                label="Livanta's assets screen, showing tracked items and their service state."
              >
                <PhoneModule moduleId="assets" now={BUILD_NOW} />
              </PhoneFrame>
            </div>
            <div className="lp-split__copy">
              <SectionHead
                align="start"
                eyebrow="The part that matters most"
                title="It tracks service, not just dates"
                lede="Most people can manage a date in a calendar app. What actually slips is maintenance, because it has no fixed date at all."
              />
              <div className="lp-killer__body">
                <p>
                  Tell Livanta the generator was serviced 120 days ago and it
                  comes back every 90. Same for oil changes, tyres, AC servicing
                  and anything else that decays rather than expires.
                </p>
                <p>
                  An asset can also carry its purchase date and warranty length,
                  so the app tells you the warranty is about to run out before
                  you would have thought to check.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- Core features ---------------- */}
        <section className="lp-section lp-section--tint" id="features">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="What is inside"
              title="Built for the whole list, not one niche"
              lede="Five life areas, and the parts of running a household that fall between them."
            />
            <div className="lp-grid-3">
              <FeatureCard icon="home" title="Home and bills">
                Rent, electricity, water, internet, subscriptions. Recurring
                charges handled on their own schedule, with the running total of
                what the next 30 days will cost.
              </FeatureCard>
              <FeatureCard icon="file" title="Documents and dates">
                Passports, driving licences, visas, certificates. Stored with
                their expiry dates so you are warned months ahead, not on the day.
              </FeatureCard>
              <FeatureCard icon="car" title="Vehicles">
                Insurance, MOT, fuel, servicing. Multiple vehicles, each with its
                own history and its own intervals.
              </FeatureCard>
              <FeatureCard icon="users" title="Family and school">
                School fees, birthdays, assignments to a partner. Delegate what
                you do not want to be the only one tracking.
              </FeatureCard>
              <FeatureCard icon="wrench" title="Assets and servicing">
                Generators, refrigerators, air conditioners. Purchase date,
                warranty and the service interval that keeps them running.
              </FeatureCard>
              <FeatureCard icon="bell" title="Alerts that respect you">
                Choose how far ahead to be warned, turn notifications on or off,
                and keep low-data mode on if you are on a metered connection.
              </FeatureCard>
            </div>
          </div>
        </section>

        {/* ---------------- Real screens ---------------- */}
        <section className="lp-section" id="screens">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="The app"
              title="Every screen you will actually use"
              lede="These are the real screens, running on real sample data. Not concept art and not a redesign you will never receive."
            />

            <div className="lp-screens">
              <Screen caption="Home tells you what needs you today, not what you own.">
                <PhoneFrame
                  tab="home"
                  label="Livanta's home screen, showing what needs attention and what is coming up."
                >
                  <PhoneHome now={BUILD_NOW} />
                </PhoneFrame>
              </Screen>
              <Screen caption="A month view with your due dates marked.">
                <PhoneFrame
                  tab="calendar"
                  label="Livanta's calendar screen, with due dates marked on the month grid."
                >
                  <PhoneCalendar now={BUILD_NOW} />
                </PhoneFrame>
              </Screen>
              <Screen caption="Adding something is a name, an amount and a date.">
                <PhoneFrame
                  tab="life"
                  label="Livanta's add screen: pick a type, then a name, amount and due date."
                >
                  <PhoneAdd />
                </PhoneFrame>
              </Screen>
              <Screen caption="Alerts, grouped by how much trouble they are in.">
                <PhoneFrame
                  tab="alerts"
                  label="Livanta's alerts screen, listing alerts by urgency."
                >
                  <PhoneAlerts now={BUILD_NOW} />
                </PhoneFrame>
              </Screen>
            </div>
          </div>
        </section>

        {/* ---------------- What is coming ---------------- */}
        <section className="lp-section lp-section--tint" id="upcoming">
          <div className="lp-wrap lp-split">
            <div className="lp-split__copy">
              <SectionHead
                align="start"
                eyebrow="What it is about to catch"
                title="The next thing to become a problem"
                lede="This is the real list from the app, sorted by deadline. Nothing here is a hypothetical."
              />
            </div>
            <div className="lp-split__art lp-split__art--flat">
              <UpcomingTable now={BUILD_NOW} />
            </div>
          </div>
        </section>

        {/* ---------------- Audience ---------------- */}
        <section className="lp-section" id="who">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="Who it is for"
              title="If any of this sounds familiar"
            />
            <div className="lp-grid-2">
              <FeatureCard icon="user" title="You run a household">
                Bills arrive from several places on different days, and somebody
                has to keep the dates. That somebody is now you, by default.
              </FeatureCard>
              <FeatureCard icon="car" title="You own things that need servicing">
                A vehicle, a generator, equipment for a small business. You know
                it needs attention. You just do not track when.
              </FeatureCard>
              <FeatureCard icon="globe" title="You are diaspora managing two homes">
                Bills and documents in one country, family and property in
                another. Both lists live in the same app, offline.
              </FeatureCard>
              <FeatureCard icon="users" title="You are the family organiser">
                School fees, birthdays, renewals, all shared informally. Livanta
                makes the whole list legible in one place, so the handoffs are a
                conversation instead of a chase.
              </FeatureCard>
            </div>
          </div>
        </section>

        {/* ---------------- Why Livanta ---------------- */}
        <section className="lp-section lp-why" id="why">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="Why it is built this way"
              title="Offline, private, and free"
              lede="These are product decisions, not marketing lines. Each one costs us something, which is how you can tell they are real."
            />
            <div className="lp-grid-3">
              <FeatureCard icon="cloudOff" title="No server in the middle">
                Your list is read from your own device. There is no backend to be
                slow, no account to lose, and no connection required for the app
                to do its job.
              </FeatureCard>
              <FeatureCard icon="lock" title="Nothing to sell">
                Because your data never leaves the phone, there is nothing to sell
                and no incentive to sell it later. Read the{" "}
                <a href="/privacy/">privacy policy</a>.
              </FeatureCard>
              <FeatureCard icon="wallet" title="Free, with no catch">
                No subscription, no trial countdown, no feature held hostage. The
                whole app is the free tier.
              </FeatureCard>
            </div>
          </div>
        </section>

        {/* ---------------- Social proof ---------------- */}
        <section className="lp-section lp-section--tint" id="early-access">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="Early access"
              title="Still early, and honestly so"
              lede="Livanta is pre-release. Rather than fill this page with invented quotes from invented people, here is the actual state of the project."
            />

            <div className="lp-grid-3">
              <article className="lp-card lp-card--quote">
                <p className="lp-quote__label">Beta</p>
                <p className="lp-card__body">
                  The app is feature-complete and in testing with the people
                  building it. Both store submissions are the remaining step.
                </p>
              </article>
              <article className="lp-card lp-card--quote">
                <p className="lp-quote__label">Built in Nigeria</p>
                <p className="lp-card__body">
                  Naira amounts, FRSC licence renewals, Ikeja Electric, school
                  fees and generators are first-class in the design rather than
                  bolted on for other markets.
                </p>
              </article>
              <article className="lp-card lp-card--quote">
                <p className="lp-quote__label">No user numbers yet</p>
                <p className="lp-card__body">
                  We would rather show you a real count later than a flattering
                  one now. Nothing on this page is a statistic until it is true.
                </p>
              </article>
            </div>

            <p className="lp-note">
              Want to try it before the store release?{" "}
              <Link href="/">Open the web app</Link> and tap the browser&apos;s
              add-to-home-screen option. You get the app icon, the full screen and
              the offline support today.
            </p>
          </div>
        </section>

        {/* ---------------- FAQ ---------------- */}
        <section className="lp-section" id="faq">
          <div className="lp-wrap lp-wrap--narrow">
            <SectionHead
              eyebrow="Questions"
              title="The things people actually ask"
            />
            <Faq />
          </div>
        </section>

        {/* ---------------- Final CTA ---------------- */}
        <section className="lp-section lp-final" id="download">
          <div className="lp-wrap lp-final__inner">
            <h2 className="lp-h2">Stop keeping it all in your head</h2>
            <p className="lp-lede">
              Rent, documents, vehicles, servicing. One list, on your phone,
              working offline, free. Install the Android build directly today;
              Google Play and the App Store listings are on the way.
            </p>

            <div className="lp-final__cta">
              <a
                className="btn btn--primary btn--lg"
                href={DIRECT_APK_URL}
                rel="noopener noreferrer"
                download
              >
                <Icon name="download" size={18} />
                {`Download for Android (APK · v${APK_VERSION} · ${apkSizeLabel()})`}
              </a>
              <Link className="btn btn--ghost btn--lg" href="/">
                Try it in your browser
              </Link>
            </div>

            <DownloadButtons size="lg" align="center" />

            <div className="lp-final__trust">
              <span>
                <Icon name="lock" size={14} />
                No account required
              </span>
              <span>
                <Icon name="cloudOff" size={14} />
                Works offline
              </span>
              <span>
                <Icon name="wallet" size={14} />
                Free
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* ---------------- Footer ---------------- */}
      <footer className="lp-footer">
        <div className="lp-wrap lp-footer__inner">
          <div className="lp-footer__brand">
            <Logo variant="mark" alt="" />
            <div>
              <p className="lp-footer__name">Livanta</p>
              <p className="lp-footer__tag">
                One place to manage the things that keep your life running.
              </p>
            </div>
          </div>

          <nav className="lp-footer__nav" aria-label="Footer">
            <div>
              <p className="lp-footer__label">Product</p>
              <a href="#features">Features</a>
              <a href="#screens">Screens</a>
              <a href="#faq">FAQ</a>
              <Link href="/">Open the app</Link>
            </div>
            <div>
              <p className="lp-footer__label">Legal</p>
              <a href="/privacy/">Privacy policy</a>
              <a href="/terms/">Terms of use</a>
            </div>
            <div>
              <p className="lp-footer__label">Your data</p>
              {/* These actions live in the app's Profile tab. The SPA has no
                  /#profile-style deep links, so the honest destination is the
                  app root — anything else would be a fragment that resolves to
                  nothing. */}
              <Link href="/">Manage your data</Link>
              <Link href="/">Export your data</Link>
              <Link href="/">Sync account</Link>
            </div>
          </nav>
        </div>

        <div className="lp-wrap lp-footer__base">
          <p>&copy; {BUILD_NOW.getUTCFullYear()} Livanta. Built in Nigeria.</p>
          <p className="lp-footer__fine">
            Store listings are not live yet. Use the web app, or install the
            Android APK directly.
          </p>
        </div>
      </footer>

      <StickyCta />
    </div>
  );
}
