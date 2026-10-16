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
        Yes. Everything described on this page works for free, and there is no
        trial to start and nothing to cancel. Livanta does not charge for the
        features that matter: the thing itself, the reminders, and the dates.
      </>
    ),
  },
  {
    q: "Does it work without internet?",
    a: (
      <>
        Yes, and that is the normal case rather than a fallback. Livanta keeps
        everything on your own device, so it opens and works on a bad network or
        with data switched off entirely. You are not waiting on a server to see
        your own records.
      </>
    ),
  },
  {
    q: "Where is my data stored, and who can see it?",
    a: (
      <>
        On your device. Livanta does not upload your list, and there is no
        analytics profile being built about what you own or when it is due. You
        can export everything as a file at any time from the Profile screen.
      </>
    ),
  },
  {
    q: "Do I need an account?",
    a: (
      <>
        No. Sign-in is entirely optional. You can add fifty things over three
        years without ever giving Livanta an email address. Optional sync across
        devices is on the roadmap, but the app is complete and useful without it.
      </>
    ),
  },
  {
    q: "What happens if I lose or replace my phone?",
    a: (
      <>
        Because your data lives on the device, it lives and dies with the device.
        That is the trade-off of the local-first design, and the honest version of
        that sentence is that you should export your data now and then from
        Profile, and keep the file. Backup and restore arrive with sync.
      </>
    ),
  },
  {
    q: "Which devices are supported?",
    a: (
      <>
        Android and iPhone. Both store versions are in final testing now. In the
        meantime the app runs in any modern browser and can be added to your home
        screen, which gives you the app icon and full-screen use today.
      </>
    ),
  },
  {
    q: "Will it remind me about service intervals, not just dates?",
    a: (
      <>
        Yes. A generator serviced every 90 days or a car oil change every four
        months is a different problem from a bill with a due date, and Livanta
        tracks both. It also handles repeating things like rent or subscriptions
        on their own schedule.
      </>
    ),
  },
  {
    q: "Can I share a list with my family?",
    a: (
      <>
        Not yet. Livanta is a personal list today — one device, one owner.
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
        No. Livanta has nothing to sell because your list never leaves your
        device. Read the{" "}
        <a href="/privacy/">privacy policy</a> for the detail, including the
        short version: we are not an advertising company and we do not build a
        profile of you.
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
