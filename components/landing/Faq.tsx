"use client";

/**
 * The FAQ.
 *
 * Deliberately built on native <details>/<summary> rather than a JavaScript
 * accordion. That choice buys a lot for free: every question is in the HTML, so
 * search engines can read it and the answers work with zero JavaScript, and the
 * disclosure semantics, keyboard handling and screen reader announcements come
 * from the platform instead of from a component we would have to get right.
 *
 * The answers state what the product actually does today. Where something is not
 * shipped yet, it says so. An FAQ that quietly promises a feature the app does
 * not have is worse than no FAQ, because it converts on a lie.
 */
export interface FaqItem {
  q: string;
  a: React.ReactNode;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "Is Livanta free?",
    a: (
      <>
        Yes, during the beta. There is no subscription, no trial to start and
        nothing to cancel today. If paid plans arrive later, the terms will say
        so before anything is charged.
      </>
    ),
  },
  {
    q: "Does it work without internet?",
    a: (
      <>
        Once you are signed in, yes. The app shell and your records are stored on
        this device, so Livanta opens and works with data switched off. Signing
        in needs a connection, and so does signing back in if your session has
        expired. Until you can reconnect, the app cannot get you past the
        sign-in screen.
      </>
    ),
  },
  {
    q: "Where is my data stored, and who can see it?",
    a: (
      <>
        In this browser&apos;s or this device&apos;s local storage, kept
        separately for the account signed in there. Your records are not
        uploaded to a sync service, because cloud sync is not active, and there
        is no cloud backup. Signing out hides them; signing back in to the same
        account on this device shows them again. Anyone who can use this browser
        profile or device while your account is signed in could open them.
        Clearing this browser&apos;s site data or uninstalling the app deletes
        them, so export a copy from the Profile screen if you need one.
      </>
    ),
  },
  {
    q: "Do I need an account?",
    a: (
      <>
        Yes. Livanta requires an account, and there is no guest or anonymous
        mode. Signing in does not sync your records across devices or back them
        up today.
      </>
    ),
  },
  {
    q: "What happens if I lose or replace my phone?",
    a: (
      <>
        Because your data lives on this device, it can be lost with the device.
        Cloud sync and cloud backup are not available, so there is no way to
        restore your records on a new phone. Export your data from Profile now
        and then, and keep the file somewhere safe.
      </>
    ),
  },
  {
    q: "Which devices are supported?",
    a: (
      <>
        Livanta runs in any modern browser on Android, iPhone and desktop. On
        Android you can also install the APK directly. On iPhone or iPad, use
        Safari and add Livanta to your Home Screen. The Google Play and App Store
        listings are not live yet.
      </>
    ),
  },
  {
    q: "Will it remind me about service intervals, not just dates?",
    a: (
      <>
        It handles recurring schedules, and they are date-based. Set an item to
        repeat weekly, monthly, quarterly, twice a year or yearly, and Livanta
        computes the next date from the one you entered. There is no mileage or
        odometer tracking: the date is the trigger, not distance travelled.
      </>
    ),
  },
  {
    q: "Do reminders work when the app is closed?",
    a: (
      <>
        In the Android app, yes. Reminders are scheduled with Android&apos;s
        notification system and can arrive while Livanta is closed, if you grant
        notification permission. In a browser, no: an alert can only appear
        while Livanta is open in a tab, because a web page cannot schedule a
        notification for later. If notifications are blocked, neither delivery
        method will show one.
      </>
    ),
  },
  {
    q: "Can I share a list with my family?",
    a: (
      <>
        Not yet. Livanta is a personal list today — one owner. Shared household
        accounts, member roles, and assigning an item to someone else are
        planned, but nothing ships in that direction until the data model and
        the privacy story both hold up.
      </>
    ),
  },
  {
    q: "Do you sell my data?",
    a: (
      <>
        No. Livanta has no advertising and no analytics profile, and we do not
        sell your data. Your records stay in this browser&apos;s or this
        device&apos;s local storage; they are not sent to a data broker. Read the{" "}
        <a href="/privacy/">privacy policy (draft)</a> for the detail.
      </>
    ),
  },
];

export function Faq() {
  return (
    <div className="lp-faq">
      {FAQ_ITEMS.map((item) => (
        <details key={item.q} className="lp-faq__item" name="landing-faq">
          <summary className="lp-faq__q">
            <span>{item.q}</span>
            <svg
              className="lp-faq__chev"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M6 9.5l6 6 6-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </summary>
          <div className="lp-faq__a">
            <p>{item.a}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
