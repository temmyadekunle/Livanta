import type { Metadata } from "next";
import Link from "next/link";

import "./landing.css";

import { Icon, type IconName } from "@/components/Icons";
import { Logo } from "@/components/Logo";
import { LandingNav } from "@/components/landing/LandingNav";
import { DownloadButtons, FinalDownloadCta, StickyCta } from "@/components/landing/DownloadButtons";
import { Faq } from "@/components/landing/Faq";
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
    "Livanta keeps track of your rent, bills, documents, vehicles and service schedules in one place. Works offline. Use it in your browser or install the Android APK.",
  alternates: { canonical: "/landing/" },
  openGraph: {
    type: "website",
    url: "/landing/",
    siteName: "Livanta",
    title: "Livanta — the life admin app for things you have to keep up with",
    description:
      "One place for rent, bills, documents, vehicles and service schedules. Works offline, local-first by default.",
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
  align = "start",
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
                  In beta &middot; web app and Android APK
                </span>
              </p>
              <h1 className="lp-h1">
                The things you have to keep up with,
                <span className="lp-h1__accent"> all in one place.</span>
              </h1>
              <p className="lp-hero__sub">
                Rent, school fees, licences, insurance, the generator that needs
                servicing every few months. Livanta remembers what is coming so you
                do not have to hold it all in your head.
              </p>

              <div className="lp-hero__cta">
                <a className="btn btn--primary btn--lg" href="#download">
                  <Icon name="download" size={18} />
                  Get the app
                </a>
                <Link className="btn btn--ghost btn--lg" href="/">
                  Try it in your browser
                </Link>
              </div>

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
                  Stored on your device by default
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
                <span>Generator service due next month</span>
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
                    date once and the next one is calculated from it when the
                    item repeats.
                  </span>
                </li>
              </ul>
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
                <h3>Set the date or the repeat</h3>
                <p>
                  Give it a due date, and say how often it comes back:
                  weekly, monthly, quarterly, twice a year or yearly. Livanta
                  works out the next one by itself.
                </p>
              </li>
              <li className="lp-step">
                <span className="lp-step__num">3</span>
                <h3>Get told early enough to act</h3>
                <p>
                  Reminders fire at the lead times you choose, and alerts
                  surface as the date approaches, so renewing a licence is a
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
                label="A Livanta category list showing household and vehicle items and their dates."
              >
                <PhoneModule moduleId="assets" now={BUILD_NOW} />
              </PhoneFrame>
            </div>
            <div className="lp-split__copy">
              <SectionHead
                align="start"
                eyebrow="The part that matters most"
                title="It handles upkeep, not just one-off dates"
                lede="Most people can manage a date in a calendar app. What actually slips is maintenance, because it has no fixed date at all."
              />
              <div className="lp-killer__body">
                <p>
                  Add the generator service as a repeating item and Livanta puts
                  the next date in your list and alerts you as it approaches.
                  Same for oil changes, tyres, AC servicing and anything else
                  that comes back around.
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
              lede="Bills, documents, vehicles, family dates and the upkeep in between, held in one list."
            />
            <div className="lp-grid-3">
              <FeatureCard icon="home" title="Home and bills">
                Rent, electricity, water, internet, subscriptions. Recurring
                charges handled on their own schedule, with the running total of
                what the next 30 days will cost.
              </FeatureCard>
              <FeatureCard icon="file" title="Documents and dates">
                Passports, driving licences, visas, certificates. Track their
                expiry dates so you are warned in the month before, not on the
                day.
              </FeatureCard>
              <FeatureCard icon="car" title="Vehicles">
                Insurance, servicing, fuel and renewal dates, each tracked as
                its own item rather than buried in a vehicle record.
              </FeatureCard>
              <FeatureCard icon="users" title="Family and school">
                School fees, birthdays and recurring family dates, all in the
                same list as everything else.
              </FeatureCard>
              <FeatureCard icon="wrench" title="Assets and servicing">
                Generators, refrigerators, air conditioners and the servicing
                they need, tracked alongside the rest of the household.
              </FeatureCard>
              <FeatureCard icon="bell" title="Alerts that respect you">
                Choose what you are notified about, how far ahead reminders fire,
                and whether background sync may use data.
              </FeatureCard>
            </div>
          </div>
        </section>

        {/* ---------------- Roadmap ---------------- */}
        {/*
          The only place on this page that talks about the future, and it is
          deliberately narrow: three states, no dates, no prices, no numbers.
          Every line under "Available today" maps to shipped code — add/edit/
          remove/complete in useLivanta, derivePriority in risk.ts, the alerts
          and calendar screens, the service worker, and the Profile screen's
          export and import. The middle card repeats what the FAQ and privacy
          policy already say about sync, in the same terms. The last card names
          no feature on purpose: a named feature on a roadmap reads as a promise.
        */}
        <section className="lp-section" id="roadmap">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="Where this is going"
              title="Built in the open, one step at a time"
              lede="Livanta is early. Here is the honest split between what works today, what is still being finished, and what is only a direction."
            />

            <div className="lp-grid-3">
              <article className="lp-card">
                <p className="lp-roadmap__status lp-roadmap__status--now">
                  Available today
                </p>
                <h3 className="lp-card__title">What works now</h3>
                <ul className="lp-checks">
                  <li>
                    <Icon name="check" size={16} />
                    <span>
                      Adding, editing and completing dated responsibilities.
                    </span>
                  </li>
                  <li>
                    <Icon name="check" size={16} />
                    <span>
                      Repeating items that move to their next date when you mark
                      them handled.
                    </span>
                  </li>
                  <li>
                    <Icon name="check" size={16} />
                    <span>
                      Due dates with derived urgency, so the nearest ones surface
                      first.
                    </span>
                  </li>
                  <li>
                    <Icon name="check" size={16} />
                    <span>Alerts and a month calendar built from your entries.</span>
                  </li>
                  <li>
                    <Icon name="check" size={16} />
                    <span>
                      Records grouped into the categories the app supports, with
                      search and filters.
                    </span>
                  </li>
                  <li>
                    <Icon name="check" size={16} />
                    <span>
                      Using the app offline, because your list lives on your
                      device.
                    </span>
                  </li>
                  <li>
                    <Icon name="check" size={16} />
                    <span>
                      Exporting your data to a JSON file, and importing it back.
                    </span>
                  </li>
                </ul>
              </article>

              <article className="lp-card">
                <p className="lp-roadmap__status">In progress</p>
                <h3 className="lp-card__title">Optional account sync</h3>
                <p className="lp-card__body">
                  Syncing the same list across devices is built into the app and
                  still being finished. It has not been verified end to end, so
                  treat it as something under test rather than as a backup. An
                  account stays optional, and the app works fully without one.
                </p>
              </article>

              <article className="lp-card">
                <p className="lp-roadmap__status">Exploring</p>
                <h3 className="lp-card__title">A direction, not a feature list</h3>
                <p className="lp-card__body">
                  Livanta starts with personal and household admin: the dated,
                  repeating responsibilities that are easiest to lose track of.
                  We are exploring whether the same approach can help with work
                  responsibilities too. That thinking is early and nothing from
                  it has been committed to the product, so no schedule or price
                  is attached to it.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* ---------------- Real screens ---------------- */}
        <section className="lp-section" id="screens">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="The app"
              title="The screens you will use most"
              lede="These are recreated from the app's own screens and listing logic, running on sample data."
            />

            <div
              className="lp-screens"
              role="group"
              aria-label="App screens"
              tabIndex={0}
            >
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
                lede="A sample list, built by the app from sample data and sorted by deadline. It shows the shape of the real thing, not records belonging to a person."
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
                School fees, birthdays, renewals, all in one place. Livanta
                makes the list legible, so the handoffs are a conversation
                instead of a chase.
              </FeatureCard>
            </div>
          </div>
        </section>

        {/* ---------------- Why Livanta ---------------- */}
        <section className="lp-section lp-why" id="why">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="Why it is built this way"
              title="Offline, private, and free during the beta"
              lede="These are product decisions, not marketing lines."
            />
            <div className="lp-grid-3">
              <FeatureCard icon="cloudOff" title="Local-first, not cloud-first">
                Your list is read from your own device. No connection is needed
                for the app to do its job, and no account is needed to start.
                Signing in is optional and enables account sync.
              </FeatureCard>
              <FeatureCard icon="lock" title="Not for sale">
                There is no advertising and no analytics profile. If you sign
                in, your records are stored with your account; they are not
                sold. Read the{" "}
                <a href="/privacy/">privacy policy (draft)</a>.
              </FeatureCard>
              <FeatureCard icon="wallet" title="Free during the beta">
                No subscription, no trial countdown, nothing to cancel while
                the beta runs.
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
                  The web app and the Android build are available. The Google
                  Play and App Store listings are not live yet, and some parts
                  of the product are still being finished.
                </p>
              </article>
              <article className="lp-card lp-card--quote">
                <p className="lp-quote__label">Built in Nigeria</p>
                <p className="lp-card__body">
                  Naira amounts, licence and document renewals, utility bills,
                  school fees and generators are built in rather than bolted on
                  for other markets.
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
              Want to try it before the store listings are live?{" "}
              <Link href="/">Open the web app</Link> and use your browser&apos;s
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
              working offline. Use it in your browser today, or install the
              Android build directly on an Android phone. Store listings are
              not live yet.
            </p>

            <div className="lp-final__cta">
              <FinalDownloadCta />
            </div>

            <DownloadButtons size="lg" align="center" showApk={false} />

            <div className="lp-final__trust">
              <span>
                <Icon name="lock" size={14} />
                No account required
              </span>
              <span>
                <Icon name="wallet" size={14} />
                Free during beta
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
              <a href="/privacy/">Privacy policy (draft)</a>
              <a href="/terms/">Terms (draft)</a>
            </div>
            <div>
              <p className="lp-footer__label">Your data</p>
              {/* These controls live in the app's Profile tab. There are no
                  /#profile-style deep links, so the footer explains where to
                  find them instead of three identical links to the app root. */}
              <p className="lp-footer__tag">
                Export, import and delete live in the app&apos;s Profile tab.
              </p>
            </div>
          </nav>
        </div>

        <div className="lp-wrap lp-footer__base">
          <p>&copy; {BUILD_NOW.getUTCFullYear()} Livanta. Built in Nigeria.</p>
          <p className="lp-footer__fine">
            Store listings are not live yet. Use the web app, or install the
            Android APK on an Android phone.
          </p>
        </div>
      </footer>

      <StickyCta />
    </div>
  );
}
