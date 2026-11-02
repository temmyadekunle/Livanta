import type { Metadata } from "next";
import Link from "next/link";

import "../legal.css";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What Livanta stores, where it stores it, and what it does not collect.",
  // Legal pages must never appear in a search index. They are beta drafts
  // pending review, and an indexed draft is worse than no draft at all.
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  return (
    <article className="legal">
      <Link className="legal__back" href="/">
        &larr; Back to Livanta
      </Link>

      <h1>Privacy policy</h1>
      <p className="legal__meta">
        Version 0.1 &middot; draft &middot; 5 October 2026 &middot; applies to the
        Livanta beta
      </p>

      <div className="legal__draft">
        <strong>Draft &mdash; not yet in force</strong>
        This document is a working draft prepared for review. It has not been
        reviewed by a lawyer and the beta is pre-release. Placeholders marked
        below must be filled in before the service is opened more widely.
      </div>

      <h2>1. Who is responsible for your data</h2>
      <p>
        Livanta is operated by{" "}
        <span className="legal__todo">[full legal name of the operator]</span>,{" "}
        <span className="legal__todo">[registered address]</span> (the
        &ldquo;operator&rdquo;). The operator is the data controller for personal
        data processed through Livanta. Contact us at{" "}
        <span className="legal__todo">[privacy email address]</span>.
      </p>

      <h2>2. The short version</h2>
      <p>
        Livanta is designed so that your information stays on your own device by
        default. Records you create are written to your browser&rsquo;s local
        database. Nothing is sent to us unless you create an account and sign in.
        Signing in enables sync, which uploads the records on that device to your
        account; sync is still being completed in the beta. There is no
        advertising, no analytics and no third-party tracking in the app.
      </p>

      <h2>3. What you enter</h2>
      <p>
        Livanta is a tool for keeping track of personal responsibilities: what
        you own, what is due, and when. To do that it stores whatever you type
        into it. For each item this may include:
      </p>
      <ul>
        <li>a name or label you choose, such as &ldquo;Passport&rdquo;;</li>
        <li>a category and type;</li>
        <li>
          an amount in Nigerian naira (<code>NGN</code>), a due date, and how
          often the item repeats;
        </li>
        <li>a status, a priority, and the date you last handled it;</li>
        <li>
          free-text notes and details fields, which accept anything you type.
        </li>
      </ul>
      <p>
        We do not ask for a national identification number, a passport number,
        a driver&rsquo;s licence number, a bank account number, a password for
        any other service, or your location. However,{" "}
        <strong>
          the notes and details fields are free text and cannot be prevented
          from holding sensitive information
        </strong>
        . If you paste a document number, account number, or similar into
        them, Livanta will store it. Please do not. Store the date a document
        expires rather than the number that identifies it.
      </p>

      <h2>4. Where it is stored</h2>
      <h3>On your device</h3>
      <p>
        Records are kept in IndexedDB, in a database named{" "}
        <code>lifedesk</code>, using object stores named <code>things</code>,{" "}
        <code>alerts</code>, <code>members</code> and <code>settings</code>.
        This database lives
        inside your browser profile. We cannot read it, and we have no access
        to it.
      </p>
      <p>
        Your subscription state is kept separately in{" "}
        <code>localStorage</code> under the key{" "}
        <code>livanta.entitlement.v1</code>. It holds only your plan, the date
        the period ends, and whether you are in a trial. It contains no personal
        information.
      </p>

      <h3>On our servers, only if you sign in</h3>
      <p>
        If you create an account, we store your email address. While you are
        signed in, Livanta syncs the records described above to our database host
        so they can follow you between devices. Signing in is optional and
        Livanta is fully usable with no account. Sync is still being completed
        in the beta and has not been verified end to end.
      </p>

      <h2>5. What we do not collect</h2>
      <p>Livanta contains no analytics, advertising or tracking code of any kind.</p>
      <ul>
        <li>No cookies are set by the application.</li>
        <li>No analytics or session-recording service is embedded.</li>
        <li>No advertising or social-network pixels or tags are loaded.</li>
        <li>
          No third-party scripts, fonts or images are loaded. The app enforces
          this with a Content-Security-Policy that blocks connections to any
          origin other than Livanta itself and, if you sign in, the database
          host.
        </li>
        <li>
          We do not sell, rent or trade personal data, and we do not share it
          with data brokers.
        </li>
      </ul>

      <h2>6. Notifications</h2>
      <p>
        If you allow browser notifications, reminders are scheduled on your own
        device using the browser Notifications API. The reminder text is
        generated on your device. Reminder content is not sent to us by the
        notification system. You can withdraw notification permission at any
        time in your browser settings without affecting your data.
      </p>

      <h2>7. Who processes your data</h2>
      <p>
        We use a small number of suppliers, each under a written agreement
        limiting them to acting on our instructions:
      </p>
      <ul>
        <li>
          <strong>Cloudflare</strong> &mdash; hosts the app, delivers its files
          and enforces access controls.
        </li>
        <li>
          <strong>Supabase</strong> &mdash; provides the account and database
          service, used only if you create an account.
        </li>
        <li>
          <strong>Paystack</strong> &mdash; a payment provider.{" "}
          <span className="legal__todo">
            [not enabled in the beta; state the position before any paid plan
            is sold]
          </span>
        </li>
      </ul>

      <h2>8. Servers outside Nigeria</h2>
      <p>
        Our suppliers may store or process data on servers outside Nigeria,
        including in the United States and the European Union. Where your data
        is transferred this way we rely on the operator&rsquo;s standard
        contractual protections.{" "}
        <span className="legal__todo">
          [confirm which Supabase region the project uses and name it here]
        </span>
        . You may{" "}
        <a href="mailto:[privacy email address]">
          ask us where your data is physically held
        </a>
        .
      </p>

      <h2>9. How long we keep it</h2>
      <ul>
        <li>
          <strong>On your device:</strong> until you delete it. You can delete
          one item, or everything at once, from the Profile tab. Removing an
          item from the list marks it complete; it is erased when you delete it
          or use &ldquo;Delete all my data&rdquo;.
        </li>
        <li>
          <strong>On our servers:</strong> from the moment you sign in, until
          you ask us to delete your account and its synced records. In-app
          account deletion is not available yet, so a deletion request has to be
          made by email at <span className="legal__todo">[privacy email address]</span>.
          We remove the records within{" "}
          <span className="legal__todo">[state the period, e.g. 30 days]</span>.
        </li>
        <li>
          <strong>Backups:</strong> retained for a limited period for
          disaster recovery, then overwritten.{" "}
          <span className="legal__todo">[state the period]</span>
        </li>
      </ul>

      <h2>10. Your rights</h2>
      <p>
        Under the Nigeria Data Protection Act 2023 you have the right to
        confirmation of processing, access to your data, correction of
        inaccurate data, erasure, restriction of processing, and to object to
        or withdraw consent for processing. You also have the right to lodge a
        complaint with the Nigeria Data Protection Commission.
      </p>
      <p>
        Most of these you can exercise yourself without contacting us:
      </p>
      <ul>
        <li>
          <strong>Access and portability</strong> &mdash; use &ldquo;Export my
          data&rdquo; in the Profile tab to download a copy of your records as
          JSON.
        </li>
        <li>
          <strong>Correction and erasure</strong> &mdash; edit or delete any
          item in the app, or use &ldquo;Delete all my data&rdquo;.
        </li>
        <li>
          <strong>Withdraw</strong> &mdash; sign out in the Profile tab to stop
          syncing on that device. In-app account deletion is not available yet;
          to have your account and its synced records deleted, write to{" "}
          <span className="legal__todo">[privacy email address]</span>. On-device
          data can be deleted without an account.
        </li>
      </ul>
      <p>
        For anything the app cannot do on its own, write to{" "}
        <span className="legal__todo">[privacy email address]</span>. We
        respond within <span className="legal__todo">[state the period]</span>.
      </p>

      <h2>11. Automated processing</h2>
      <p>
        Livanta calculates reminders, alerts and a short status summary from the
        dates and amounts you entered, entirely on your device. These are
        organisational prompts only. Livanta makes no automated decision that
        produces legal or similarly significant effects, and it does not build
        a profile of you for advertising.
      </p>

      <h2>12. Security</h2>
      <p>
        Livanta is a static site with no application server, which removes a
        large class of attack surface: there is no database to breach on our
        side unless you have an account. On-device data is protected only by
        your device&rsquo;s own security &mdash; a screen lock, a passcode and
        up-to-date software. We apply a Content-Security-Policy, restrict
        framing, and control cross-origin data access on every response. No
        method of transmission or storage is completely secure, and we do not
        claim that ours is.
      </p>

      <h2>13. Children</h2>
      <p>
        Livanta is intended for adults managing their own affairs and is not
        directed at children. It is not a service for storing a child&rsquo;s
        personal records. If you believe a child has provided us with personal
        data, contact us and we will delete it.
      </p>

      <h2>14. Changes to this policy</h2>
      <p>
        We will update this policy when our processing changes, and will
        publish the new version here with a new date and version number.
        Material changes will be announced in the app before they take effect.
      </p>

      <h2>15. Complaints</h2>
      <p>
        If you are unhappy with how we have handled your data, contact us
        first. You also have the right to complain to the Nigeria Data
        Protection Commission.
      </p>
      <p>
        The rules governing your use of the app itself are set out in the{" "}
        <Link href="/terms/">terms of use</Link>.
      </p>
    </article>
  );
}
