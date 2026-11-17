import type { Metadata } from "next";
import Link from "next/link";

import "./landing.css";

import { Icon, type IconName } from "@/components/Icons";
import { Logo } from "@/components/Logo";
import { LandingNav } from "@/components/landing/LandingNav";
import { DownloadSection, StickyCta } from "@/components/landing/DownloadButtons";
import { Faq } from "@/components/landing/Faq";
import {
  PhoneFrame,
  PhoneHome,
  PhoneCalendar,
  PhoneAdd,
  PhoneAlerts,
} from "@/components/landing/PhoneFrame";

const SITE_URL = "https://livanta.folababy02.workers.dev";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Livanta — the life admin app for things you have to keep up with",
  description:
    "Livanta keeps track of your rent, bills, documents, vehicles and service schedules in one place. Sign in, then use it in your browser or install the Android APK.",
  alternates: { canonical: "/landing/" },
  openGraph: {
    type: "website",
    url: "/landing/",
    siteName: "Livanta",
    title: "Livanta — the life admin app for things you have to keep up with",
    description:
      "One place for rent, bills, documents, vehicles and service schedules. Sign-in is required, and your records stay on your device.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Livanta — the life admin app for things you have to keep up with",
    description:
      "One place for rent, bills, documents, vehicles and service schedules. Records stay on your device.",
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
        {/* ---------------- Product introduction ---------------- */}
        <section className="lp-hero" id="product">
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
                servicing every few months. Livanta keeps the list and the dates
                in one place, so you do not have to hold it all in your head.
              </p>

              <div className="lp-hero__cta">
                <a className="btn btn--primary btn--lg" href="#download">
                  <Icon name="download" size={18} />
                  Get the app
                </a>
                <Link className="btn btn--ghost btn--lg" href="/">
                  Open the web app
                </Link>
              </div>

              <ul className="lp-promises">
                <li>
                  <Icon name="lock" size={15} />
                  Sign-in required
                </li>
                <li>
                  <Icon name="check" size={15} />
                  Records stay on your device
                </li>
                <li>
                  <Icon name="check" size={15} />
                  Offline once signed in
                </li>
              </ul>

              <p className="lp-hero__note">
                No cloud sync or cloud backup yet: what you enter stays in this
                browser or on this device.{" "}
                <a href="#availability">See what is available today</a>.
              </p>
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

        {/* ---------------- Features ---------------- */}
        <section className="lp-section lp-section--tint" id="features">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="Features"
              title="One list for the whole of life admin"
              lede="Bills, documents, vehicles, family dates and the upkeep in between, held in one list instead of twelve places."
            />
            <div className="lp-grid-3">
              <FeatureCard icon="home" title="Home and bills">
                Rent, electricity, water, internet, subscriptions. Recurring
                charges keep the due dates you set, and you can see what is
                coming next.
              </FeatureCard>
              <FeatureCard icon="file" title="Documents and dates">
                Passports, driving licences, visas, certificates. Track their
                expiry dates so you are warned in the month before, not on the
                day.
              </FeatureCard>
              <FeatureCard icon="car" title="Vehicles">
                Insurance, servicing and renewal dates, each tracked as its own
                item rather than buried in a vehicle record.
              </FeatureCard>
              <FeatureCard icon="users" title="Family and school">
                School fees, birthdays and recurring family dates, all in the
                same list as everything else.
              </FeatureCard>
              <FeatureCard icon="wrench" title="Assets and servicing">
                Generators, refrigerators, air conditioners and the servicing
                they need. Service intervals are date-based: you enter the next
                date, and there is no mileage or odometer tracking.
              </FeatureCard>
              <FeatureCard icon="bell" title="Reminders by platform">
                In the Android app, reminders are scheduled by the phone and can
                arrive with the app closed. In a browser, an alert can only
                appear while Livanta is open in a tab. Both need notification
                permission.
              </FeatureCard>
            </div>

            <p className="lp-note">
              Service schedules are date-based, not mileage-based. Set the next
              date or a repeat, and Livanta calculates the following date from
              the one you entered. It does not read an odometer.
            </p>
          </div>
        </section>

        {/* ---------------- How it works ---------------- */}
        <section className="lp-section" id="how-it-works">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="How it works"
              title="Three steps, then it keeps the dates"
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
                  Give it a due date, and say how often it comes back: weekly,
                  monthly, quarterly, twice a year or yearly. Livanta works out
                  the next date from the one you entered.
                </p>
              </li>
              <li className="lp-step">
                <span className="lp-step__num">3</span>
                <h3>Get told early enough to act</h3>
                <p>
                  Reminders fire at the lead times you choose. In the Android app
                  they are scheduled by the phone; in a browser they appear only
                  while the page is open.
                </p>
              </li>
            </ol>
          </div>
        </section>

        {/* ---------------- Screens ---------------- */}
        <section className="lp-section lp-section--tint" id="screens">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="Screens"
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
                another. Both lists live in the same app, and both stay on this
                device.
              </FeatureCard>
              <FeatureCard icon="users" title="You are the family organiser">
                School fees, birthdays, renewals, all in one place. Livanta makes
                the list legible, so nothing depends on one person remembering
                it.
              </FeatureCard>
            </div>
          </div>
        </section>

        {/* ---------------- Current availability ---------------- */}
        {/*
          This is the current-state split. The forward-looking roadmap that
          follows carries explicit status badges. Every line under "Available
          today" maps to shipped code:
          add/edit/remove/complete in useLivanta, derivePriority in risk.ts, the
          alerts and calendar screens, the service worker, and the Profile
          screen's export and import. The middle card states the storage limits
          in the same terms as the FAQ and the download section, including that
          records are stored per account on the device and that clearing site
          data removes them. The last card names no date for a store listing or
          sharing, because there is none.
        */}
        <section className="lp-section lp-section--tint" id="availability">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="Current availability"
              title="What works today, and what does not"
              lede="Livanta is pre-release. This is the honest split, with no dates or prices attached to the missing parts."
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
                      Categories with search and filters, so the list stays
                      usable as it grows.
                    </span>
                  </li>
                  <li>
                    <Icon name="check" size={16} />
                    <span>Using the app offline once you are signed in.</span>
                  </li>
                  <li>
                    <Icon name="check" size={16} />
                    <span>
                      Exporting your data to a JSON file, and importing it back,
                      from the Profile tab.
                    </span>
                  </li>
                </ul>
              </article>

              <article className="lp-card">
                <p className="lp-roadmap__status">Not available yet</p>
                <h3 className="lp-card__title">Cloud sync and backup</h3>
                <p className="lp-card__body">
                  Syncing one list across devices is switched off, and there is
                  no cloud backup or restore. Your records stay in this
                  browser&apos;s or this device&apos;s local storage, kept
                  separately for the account signed in there. Signing in does
                  not upload them, and each device keeps its own copy. Export
                  from the Profile tab if you need a copy; clearing this
                  browser&apos;s site data or uninstalling the app deletes the
                  local records.
                </p>
              </article>

              <article className="lp-card">
                <p className="lp-roadmap__status">Also not live</p>
                <h3 className="lp-card__title">Stores and sharing</h3>
                <p className="lp-card__body">
                  The Google Play and App Store listings are not live yet;
                  Android installs come from the APK on this page. Household
                  sharing, member roles and assigning an item to someone else are
                  not available.
                </p>
              </article>
            </div>

            <p className="lp-note">
              Livanta is built in Nigeria and is free during the beta, with no
              subscription and nothing to cancel.
            </p>
          </div>
        </section>

        {/* ---------------- Roadmap ---------------- */}
        {/*
          Forward-looking section. Only Livanta Core is presented as available;
          every other generation carries a PLANNED badge, and the wider
          community ideas carry COMING LATER. No dates, prices or availability
          promises appear here, because none exist.
        */}
        <section className="lp-section" id="roadmap">
          <div className="lp-wrap">
            <SectionHead
              eyebrow="Roadmap"
              title="The Livanta Roadmap"
              lede="Livanta is growing with you. From organising everyday responsibilities to accessing intelligent assistance, secure cloud services and meaningful opportunities, we're building a platform to help you manage more of life in one place."
            />

            <div className="lp-road__flow" aria-hidden="true">
              <span data-current="true">01 Core</span>
              <span className="lp-road__arrow">&rarr;</span>
              <span>02 Intelligence</span>
              <span className="lp-road__arrow">&rarr;</span>
              <span>03 Cloud</span>
              <span className="lp-road__arrow">&rarr;</span>
              <span>04 Connected</span>
            </div>

            <ul className="lp-legend" aria-label="How roadmap status labels work">
              <li>
                <span className="lp-stage__badge lp-stage__badge--now">
                  AVAILABLE NOW
                </span>
                <span>Shipped and working today.</span>
              </li>
              <li>
                <span className="lp-stage__badge lp-stage__badge--dev">
                  IN DEVELOPMENT
                </span>
                <span>
                  Work has actually started. Nothing on this roadmap carries this
                  label yet.
                </span>
              </li>
              <li>
                <span className="lp-stage__badge lp-stage__badge--planned">
                  PLANNED
                </span>
                <span>Approved direction, not built.</span>
              </li>
              <li>
                <span className="lp-stage__badge lp-stage__badge--later">
                  COMING LATER
                </span>
                <span>
                  A longer-term possibility, dependent on architecture, security,
                  cost and validation.
                </span>
              </li>
            </ul>

            <p className="lp-road__note">
              Only Livanta Core is available today. Nothing after it on this
              roadmap can be used yet, and no release dates are promised.{" "}
              <a href="#availability">
                Check exactly what works today.
              </a>
            </p>

            <ol className="lp-road">
              <li className="lp-road__item">
                <article className="lp-stage lp-stage--core">
                  <div className="lp-stage__top">
                    <span className="lp-stage__icon">
                      <Icon name="layers" size={21} />
                    </span>
                    <span className="lp-stage__gen">Generation 01</span>
                    <span className="lp-stage__badge lp-stage__badge--now">
                      AVAILABLE NOW
                    </span>
                  </div>
                  <h3 className="lp-stage__title">Livanta Core</h3>
                  <p className="lp-stage__lede">
                    The life-management app you can use today: one list for the
                    bills, dates and upkeep you already track.
                  </p>
                  <ul className="lp-stage__list">
                    <li>
                      Personal and household life admin &mdash; bills, rent,
                      school fees, family dates and everyday responsibilities in
                      one list.
                    </li>
                    <li>
                      Bills, payments and recurring obligations, with due dates
                      and repeats.
                    </li>
                    <li>
                      Vehicle and asset service schedules, including insurance
                      and renewals. Service dates are date-based, with no mileage
                      or odometer tracking.
                    </li>
                    <li>
                      Document expiry tracking &mdash; names and expiry dates
                      only. Livanta does not store document files or attachments.
                    </li>
                    <li>
                      Alerts, reminders and a month calendar. Android reminders
                      can arrive with the app closed; browser alerts appear only
                      while Livanta is open in a tab.
                    </li>
                    <li>
                      A personal overview of what needs attention, plus search,
                      filters and categories.
                    </li>
                    <li>
                      Export and import of your records as a JSON file, from the
                      Profile tab.
                    </li>
                    <li>English, Hausa, Yoruba and Igbo.</li>
                    <li>
                      Works offline once you are signed in. Sign-in and session
                      checks still apply, and records stay on this device.
                    </li>
                  </ul>
                  <p className="lp-stage__fine">
                    Cloud sync and cloud backup are not part of Core today.
                  </p>
                </article>
              </li>

              <li className="lp-road__item">
                <article className="lp-stage lp-stage--intelligence">
                  <div className="lp-stage__top">
                    <span className="lp-stage__icon">
                      <Icon name="sparkles" size={21} />
                    </span>
                    <span className="lp-stage__gen">Generation 02</span>
                    <span className="lp-stage__badge lp-stage__badge--planned">
                      PLANNED
                    </span>
                  </div>
                  <h3 className="lp-stage__title">Livanta Intelligence</h3>
                  <p className="lp-stage__lede">
                    An AI personal assistant for the work around the work. This is
                    a direction we are planning, not a feature you can use.
                  </p>
                  <ul className="lp-stage__list">
                    <li>
                      A personal assistant that helps organise and prioritise
                      what is on your plate.
                    </li>
                    <li>
                      Help with tasks and appointments, diary and planning,
                      contextual reminders and recommendations.
                    </li>
                    <li>
                      Email organisation: identifying important messages,
                      drafting and organising replies, and follow-up reminders.
                    </li>
                    <li>
                      Meeting preparation notes and summaries, hotel and flight
                      research, travel planning and itinerary organisation.
                    </li>
                    <li>
                      Job-search organisation, CV and application help, interview
                      preparation, application follow-up and tracking, and career
                      development guidance.
                    </li>
                    <li>
                      Help organising personal information and important records,
                      including document assistance once secure document storage
                      exists.
                    </li>
                  </ul>
                  <p className="lp-stage__fine">
                    No AI assistant, email integration, travel service or career
                    tool has been built. Nothing in this generation is available
                    today.
                  </p>
                </article>
              </li>

              <li className="lp-road__item">
                <article className="lp-stage lp-stage--cloud">
                  <div className="lp-stage__top">
                    <span className="lp-stage__icon">
                      <Icon name="cloud" size={21} />
                    </span>
                    <span className="lp-stage__gen">Generation 03</span>
                    <span className="lp-stage__badge lp-stage__badge--planned">
                      PLANNED
                    </span>
                  </div>
                  <h3 className="lp-stage__title">Livanta Cloud</h3>
                  <p className="lp-stage__lede">
                    Secure cloud services for people who use more than one device.
                    None of it is switched on.
                  </p>
                  <ul className="lp-stage__list">
                    <li>
                      Secure cloud synchronisation, so the same records appear on
                      every device you sign in to.
                    </li>
                    <li>
                      Cloud backup and restore, including recovery if a device is
                      lost or replaced.
                    </li>
                    <li>
                      Cross-device access with account-based storage management.
                    </li>
                    <li>
                      Secure document uploads and attachments, with personal
                      cloud document storage.
                    </li>
                  </ul>
                  <p className="lp-stage__fine">
                    Sync and backup are switched off today, and records stay on
                    the device where you entered them. Architecture, security,
                    ownership, privacy and cost reviews come before any of this
                    is built. No storage plans or prices are announced.
                  </p>
                </article>
              </li>

              <li className="lp-road__item lp-road__item--wide">
                <article className="lp-stage lp-stage--connected">
                  <div className="lp-stage__top">
                    <span className="lp-stage__icon">
                      <Icon name="users" size={21} />
                    </span>
                    <span className="lp-stage__gen">Generation 04</span>
                    <span className="lp-stage__badge lp-stage__badge--planned">
                      PLANNED
                    </span>
                  </div>
                  <h3 className="lp-stage__title">Livanta Connected</h3>
                  <p className="lp-stage__lede">
                    A community layer around your working life, with Livanta
                    Community and Jobs &amp; Career Opportunities at its centre.
                    It is planned, not live.
                  </p>

                  <div className="lp-stage__panels">
                    <section className="lp-substage">
                      <h4>
                        <Icon name="users" size={18} />
                        Livanta Community
                      </h4>
                      <p className="lp-substage__lede">
                        A feed where members can learn from each other and take
                        part.
                      </p>
                      <ul className="lp-stage__list">
                        <li>
                          Discussions, announcements and knowledge sharing.
                        </li>
                        <li>
                          Helpful posts and conversations, with opportunities to
                          contribute.
                        </li>
                      </ul>
                    </section>

                    <section className="lp-substage lp-substage--jobs">
                      <h4>
                        <Icon name="trendingUp" size={18} />
                        Jobs &amp; Career Opportunities
                      </h4>
                      <p className="lp-substage__lede">
                        Verified companies, CEOs, founders, HR managers,
                        recruiters and authorised employers would eventually be
                        able to publish opportunities.
                      </p>
                      <p className="lp-stage__label">Opportunity types</p>
                      <ul className="lp-tags">
                        <li>Full-time</li>
                        <li>Part-time</li>
                        <li>Remote</li>
                        <li>Hybrid / onsite</li>
                        <li>Internships</li>
                        <li>Graduate trainee</li>
                        <li>NYSC</li>
                        <li>Freelance contracts</li>
                        <li>Volunteer</li>
                        <li>Temporary / contract</li>
                      </ul>
                      <p className="lp-stage__label">Each listing would include</p>
                      <p className="lp-substage__copy">
                        Job title, company name and logo, description,
                        responsibilities, qualifications and experience,
                        location, work arrangement, employment type, salary or
                        compensation where disclosed, deadline, and application
                        instructions or an external link.
                      </p>
                    </section>
                  </div>

                  <div className="lp-stage__panels lp-stage__panels--three">
                    <section className="lp-substage">
                      <h4>
                        <Icon name="star" size={18} />
                        Employer profiles
                      </h4>
                      <ul className="lp-stage__list">
                        <li>
                          Company, employer and recruiter profiles, with
                          organisation verification.
                        </li>
                        <li>
                          Verified badges only after a real check. No automatic
                          badges and no implied endorsement.
                        </li>
                        <li>
                          An employer dashboard for publishing, editing and
                          closing opportunities.
                        </li>
                      </ul>
                    </section>

                    <section className="lp-substage">
                      <div className="lp-substage__head">
                        <h4>
                          <Icon name="clipboard" size={18} />
                          More community features
                        </h4>
                        <span className="lp-stage__badge lp-stage__badge--later">
                          COMING LATER
                        </span>
                      </div>
                      <p className="lp-substage__copy">
                        Longer-term ideas for community and career development.
                        These depend on the architecture, safety work and cost of
                        the earlier features.
                      </p>
                      <ul className="lp-tags">
                        <li>Q&amp;A</li>
                        <li>Professional networking</li>
                        <li>Interest groups</li>
                        <li>Learning resources</li>
                        <li>Career discussions</li>
                        <li>Mentorship</li>
                        <li>Events and webinars</li>
                        <li>Saved jobs</li>
                        <li>Job alerts</li>
                        <li>Application tracking</li>
                      </ul>
                    </section>

                    <section className="lp-substage">
                      <h4>
                        <Icon name="shieldCheck" size={18} />
                        Community safety
                      </h4>
                      <ul className="lp-stage__list">
                        <li>
                          Reporting, blocking, moderation, spam prevention and
                          community guidelines.
                        </li>
                        <li>
                          Detection and removal of fraudulent job postings, with
                          organisation verification.
                        </li>
                        <li>
                          Privacy controls that keep public community content
                          separate from private Livanta records.
                        </li>
                      </ul>
                    </section>
                  </div>

                  <p className="lp-stage__fine">
                    Livanta Community and job posting do not exist yet. There are
                    no feeds, listings, employer accounts, verified badges,
                    dashboards or moderation tools live.
                  </p>
                </article>
              </li>
            </ol>

            <p className="lp-road__note lp-road__note--closing">
              A feature moves to <strong>IN DEVELOPMENT</strong> only when work has
              actually started, and to <strong>AVAILABLE NOW</strong> only when it
              works. We will not describe a planned generation as available before
              it is.
            </p>
          </div>
        </section>

        {/* ---------------- FAQ ---------------- */}
        <section className="lp-section" id="faq">
          <div className="lp-wrap lp-wrap--narrow">
            <SectionHead eyebrow="FAQ" title="The things people actually ask" />
            <Faq />
          </div>
        </section>

        {/* ---------------- Download ---------------- */}
        <section className="lp-section lp-final" id="download">
          <div className="lp-wrap lp-final__inner">
            <h2 className="lp-h2">Stop keeping it all in your head</h2>
            <p className="lp-lede">
              Rent, documents, vehicles, servicing. One list, in your browser or
              on your Android phone, working offline once you are signed in.
              Store listings are not live yet, and there is no cloud sync or
              backup.
            </p>

            <DownloadSection />

            <div className="lp-final__trust">
              <span>
                <Icon name="lock" size={14} />
                Sign-in required
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
              <a href="#product">Overview</a>
              <a href="#features">Features</a>
              <a href="#how-it-works">How it works</a>
              <a href="#screens">Screens</a>
              <a href="#roadmap">Roadmap</a>
            </div>
            <div>
              <p className="lp-footer__label">More</p>
              <a href="#who">Who it is for</a>
              <a href="#availability">Availability</a>
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
