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
        Yes, and that is the normal case rather than a fallback. Livanta keeps
        your records on your own device by default, so it opens and works on a
        bad network or with data switched off entirely. If you sign in, syncing
        needs a connection; using the app does not.
      </>
    ),
  },
  {
    q: "Where is my data stored, and who can see it?",
    a: (
      <>
        On your device by default. Nothing is uploaded unless you create an
        account and sign in. If you do, your records sync to your account, and
        that sync is still being finished in the beta. You can export everything
        as a JSON file at any time from the Profile screen.
      </>
    ),
  },
  {
    q: "Do I need an account?",
    a: (
      <>
        No. Sign-in is optional and you can use Livanta without giving it an
        email address. Optional sync exists for people who want the same list on
        more than one device, but it is still being finished and the app is
        fully usable without it.
      </>
    ),
  },
  {
    q: "What happens if I lose or replace my phone?",
    a: (
      <>
        Because your data lives on the device by default, it can be lost with
        the device. That is the trade-off of the local-first design, and the
        honest version of that sentence is that you should export your data now
        and then from Profile, and keep the file. Sync is still being finished,
        so it should not be your only backup.
      </>
    ),
  },
  {
    q: "Which devices are supported?",
    a: (
      <>
        Livanta runs in any modern browser on Android, iPhone and desktop. On
        Android you can also install the APK directly. On iPhone, use Safari and
        add Livanta to your Home Screen. The Google Play and App Store listings
        are not live yet.
      </>
    ),
  },
  {
    q: "Will it remind me about service intervals, not just dates?",
    a: (
      <>
        It handles recurring schedules. Set an item to repeat weekly, monthly,
        quarterly, twice a year or yearly, and Livanta computes the next date
        from the one you entered. That covers servicing that comes back around,
        as well as rent and subscriptions.
      </>
    ),
  },
  {
    q: "Can I share a list with my family?",
    a: (
      <>
        Not yet. Livanta is a personal list today — one owner.
        Shared household accounts, member roles, and assigning an item to
        someone else are planned, but nothing ships in that direction until the
        data model and the privacy story both hold up.
      </>
    ),
  },
  {
    q: "Do you sell my data?",
    a: (
      <>
        No. Livanta has no advertising and no analytics profile, and we do not
        sell your data. If you sign in, your records are stored with your account
        so they can sync; that is not a data-sale business. Read the{" "}
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
