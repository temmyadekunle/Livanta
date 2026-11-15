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
        Version 0.2 &middot; draft &middot; 13 November 2026 &middot; applies to
        the Livanta beta
      </p>

      <div className="legal__draft">
        <strong>Draft &mdash; not yet in force</strong>
        This version has been corrected to describe how the beta actually works
        today. It has not been reviewed by a lawyer. Items marked in amber still
        need the operator&rsquo;s confirmation and must be completed before the
        service is opened more widely.
      </div>

      <h2>1. Who is responsible for your information</h2>
      <p>
        Livanta is operated by{" "}
        <span className="legal__todo">[full legal name of the operator]</span>,{" "}
        <span className="legal__todo">[registered address]</span>{" "}
        (&ldquo;we&rdquo;, &ldquo;us&rdquo; or &ldquo;our&rdquo;). For the
        account information described in this policy, we are the data
        controller. Privacy questions and requests can be sent to{" "}
        <span className="legal__todo">[privacy email address]</span>.{" "}
        <span className="legal__todo">
          [If a data protection officer is required, add their contact details
          here.]
        </span>
      </p>

      <h2>2. The short version</h2>
      <ul>
        <li>
          <strong>You need an account to use Livanta.</strong> There is no guest
          mode. Creating an account requires an email address and a password.
          Authentication is provided by Supabase.
        </li>
        <li>
          <strong>Your records stay on your device.</strong> Everything you
          enter is stored in this browser or app on this device. It is not
          uploaded to us, and there is no cloud sync, cloud backup or cloud
          restore in this beta.
        </li>
        <li>
          <strong>Local records are not separated by account.</strong> If two
          people sign in on the same browser or device, they see the same
          records. Signing out does not delete anything.
        </li>
        <li>
          <strong>No advertising, analytics or tracking.</strong> We do not sell
          your information or share it with data brokers.
        </li>
        <li>
          <strong>You are in control of the copy on your device.</strong> You
          can export or delete your records from the Profile tab.
        </li>
      </ul>

      <h2>3. What you give us and what we collect</h2>

      <h3>Account information</h3>
      <ul>
        <li>
          Your <strong>email address</strong> and a{" "}
          <strong>password</strong>. The password is sent to Supabase Auth when
          you create an account or sign in. Livanta does not keep a copy of your
          password in its local database.
        </li>
        <li>
          If email confirmation is enabled for the project, Supabase sends you
          a confirmation email and records that the address was confirmed.
        </li>
        <li>
          If you choose <strong>Google or Apple sign-in</strong>, that provider
          authenticates you and passes information such as your email address
          to Supabase. We do not receive your password for that provider.
        </li>
        <li>
          A session token is kept on your device so you do not have to sign in
          on every visit. It is refreshed while the session is active.
        </li>
      </ul>

      <h3>Records you create</h3>
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

      <h3>Profile and settings</h3>
      <p>
        You may add a display name and a profile photo, and choose a language,
        reminder lead times and notification preferences. These settings are
        stored on your device and are included when you export your data. The
        profile photo is reduced to a small image before it is stored.
      </p>

      <h3>Technical information</h3>
      <p>
        When you connect to our hosting or authentication providers, those
        providers may process standard technical information such as your IP
        address, browser or app type, and the time of the request in their
        logs.
      </p>

      <h3>What we do not ask for</h3>
      <p>
        We do not ask for a national identification number, a passport number,
        a driver&rsquo;s licence number, a bank account number, a password for
        any other service, or your location. However,{" "}
        <strong>
          the notes and details fields are free text and cannot be prevented
          from holding sensitive information
        </strong>
        . If you paste a document number, account number, or similar into them,
        Livanta will store it on your device. Please do not. Store the date a
        document expires rather than the number that identifies it.
      </p>

      <h2>4. Where your information is stored</h2>

      <h3>On your device</h3>
      <p>
        Records and settings are kept in IndexedDB, in a database named{" "}
        <code>lifedesk</code>, using object stores named <code>things</code>,{" "}
        <code>alerts</code>, <code>members</code> and <code>settings</code>.
        This database lives inside your browser profile or the app&rsquo;s
        storage on your device. We do not receive a copy, and we cannot read it.
      </p>
      <p>Your device also stores:</p>
      <ul>
        <li>
          your Supabase session token, so you do not have to sign in on every
          visit; and
        </li>
        <li>
          the small flag <code>livanta.auth.pendingConfirmation.v1</code>, which
          records only whether an email confirmation is pending.
        </li>
      </ul>
      <p>
        <strong>Signing out ends the session and removes the stored session
        token. It does not delete your records or settings.</strong> Those
        remain on the device until you delete them.
      </p>
      <p>
        An export file you import from the Profile tab is read on your device
        and written to this local database. It is not uploaded to us.
      </p>

      <h3>With Supabase, because you have an account</h3>
      <p>
        Supabase holds your email address and the authentication data needed to
        operate the account.{" "}
        <strong>
          The beta does not upload your records to Supabase.
        </strong>{" "}
        There is no server-side copy of your items, notes, amounts, dates or
        profile photo.
      </p>

      <h2>5. Cloud sync and backup are not active</h2>
      <p>
        Signing in does not move your records between devices. There is no cloud
        sync, no cloud backup and no restore from a server in this beta. An
        account is a way to sign in, not a backup of your records.
      </p>
      <p>
        You may see sync-related labels or a sync control in the Profile tab.
        In this beta they do not cause your records to be uploaded. If cloud
        sync is introduced, we will update this policy before it is switched on
        and explain what would be uploaded.
      </p>

      <h2>6. Accounts on a shared device</h2>
      <p>
        Livanta keeps one local record set for this browser or app installation,
        not one per account. There is not yet any separation between accounts on
        the same device. That means:
      </p>
      <ul>
        <li>
          anyone who can use your signed-in session, or who signs in on the same
          browser or device, can see your records;
        </li>
        <li>
          if another person signs in on the same browser or device, they will
          see the same local records;
        </li>
        <li>signing out does not hide or delete the records.</li>
      </ul>
      <p>
        Protect the device with a screen lock and a strong passcode, and use
        &ldquo;Delete all my data&rdquo; in the Profile tab before handing the
        device or browser profile to someone else. Clearing the browser&rsquo;s
        site data or uninstalling the app also removes the local records.
      </p>

      <h2>7. What we do not do</h2>
      <p>Livanta contains no advertising, analytics or tracking code.</p>
      <ul>
        <li>
          We do not sell, rent or trade personal information, and we do not
          share it with data brokers.
        </li>
        <li>
          We do not use advertising or social-network pixels, session recording
          or third-party analytics.
        </li>
        <li>
          The app does not load third-party scripts, fonts or images. Its
          Content-Security-Policy limits network connections to Livanta itself
          and, for sign-in, Supabase.
        </li>
        <li>
          Livanta does not use cookies for advertising or analytics. Your
          session is kept in browser storage on your device.
        </li>
      </ul>
      <p>
        There are three exceptions, and each happens only if you choose it:
        Google or Apple sign-in takes you to that provider; downloading the
        Android APK takes you to GitHub; and any link you follow leaves the app.
        Those services have their own privacy policies.
      </p>

      <h2>8. Notifications and device permissions</h2>
      <p>
        Reminders are calculated on your device from the dates and lead times
        you enter. The notification text is generated on your device. No push
        server is used, and reminder content is not sent to us.
      </p>
      <ul>
        <li>
          <strong>Android app:</strong> if you allow notifications, reminders
          are scheduled by the operating system and can arrive while the app is
          closed. The operating system may delay or block them because of
          battery settings or do-not-disturb.
        </li>
        <li>
          <strong>Browser:</strong> if you allow notifications, an alert can
          appear only while Livanta is open in a tab. A browser cannot wake the
          app to deliver a scheduled reminder.
        </li>
      </ul>
      <p>
        You can withdraw notification permission in the app or in your device
        settings at any time. This does not delete your records. Choosing a
        profile photo may open your device&rsquo;s photo picker or camera; you
        can decline and still use every other feature.
      </p>

      <h2>9. Who processes your information</h2>
      <p>
        We use the following providers and external services. Each handles
        information for the purpose described, under its own terms and privacy
        policy:
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> &mdash; account creation, sign-in, password
          reset and email confirmation. Supabase receives your email address and
          password when you authenticate, and holds the account record.
        </li>
        <li>
          <strong>Cloudflare</strong> &mdash; hosting, delivery and security for
          the web version, including the response headers that protect the site.
        </li>
        <li>
          <strong>Google or Apple</strong> &mdash; only if you choose that
          sign-in method. They authenticate you and pass account information to
          Supabase.
        </li>
        <li>
          <strong>GitHub</strong> &mdash; only if you download the Android APK
          from the release link. GitHub receives standard request information.
        </li>
      </ul>
      <p>
        We do not currently use a payment provider, because no paid plan is
        available.{" "}
        <span className="legal__todo">
          [Operator to confirm the data-processing agreements in place with each
          provider and add the relevant details here.]
        </span>
      </p>

      <h2>10. Servers outside Nigeria</h2>
      <p>
        Our providers operate internationally, so account information may be
        processed outside Nigeria.{" "}
        <span className="legal__todo">
          [Confirm the Supabase project region and the lawful transfer
          mechanism or safeguards used, then state them here.]
        </span>{" "}
        You can ask us where your account information is held by writing to{" "}
        <span className="legal__todo">[privacy email address]</span>.
      </p>

      <h2>11. How long we keep it</h2>
      <ul>
        <li>
          <strong>On your device:</strong> until you delete it. Marking an item
          as handled keeps it in your records until you delete it. &ldquo;Delete
          all my data&rdquo; erases the records and settings in this browser or
          app, but not your account. Clearing site data or uninstalling the app
          also erases them.
        </li>
        <li>
          <strong>With Supabase:</strong> your email address and authentication
          data are kept until you delete your account. We do not hold your
          records there.
        </li>
        <li>
          <strong>Account deletion:</strong> in-app account deletion is not
          available yet. To delete your account, write to{" "}
          <span className="legal__todo">[privacy email address]</span>. We
          remove the account information within{" "}
          <span className="legal__todo">[state the period]</span>.
        </li>
        <li>
          <strong>Provider backups:</strong> Supabase and Cloudflare may keep
          backups for a limited period.{" "}
          <span className="legal__todo">[State the actual period.]</span>
        </li>
      </ul>

      <h2>12. Your rights</h2>
      <p>
        The Nigeria Data Protection Act 2023 gives individuals rights over their
        personal data, including the right to confirmation of processing,
        access, correction, erasure, restriction, objection and withdrawal of
        consent, and the right to complain to the Nigeria Data Protection
        Commission. If you are outside Nigeria, local law may give you
        additional rights.
      </p>
      <p>Most of these you can exercise yourself without contacting us:</p>
      <ul>
        <li>
          <strong>Access and portability</strong> &mdash; use &ldquo;Export my
          data&rdquo; in the Profile tab to download your records and settings
          as JSON.
        </li>
        <li>
          <strong>Correction and erasure</strong> &mdash; edit or delete any
          item in the app, or use &ldquo;Delete all my data&rdquo;.
        </li>
        <li>
          <strong>Ending the session</strong> &mdash; sign out in the Profile
          tab. This stops the session but leaves local records in place. To
          delete the account itself, write to{" "}
          <span className="legal__todo">[privacy email address]</span>.
        </li>
      </ul>
      <p>
        For anything the app cannot do on its own, write to{" "}
        <span className="legal__todo">[privacy email address]</span>. We respond
        within <span className="legal__todo">[state the period]</span>.
      </p>

      <h2>13. Automated processing</h2>
      <p>
        Livanta calculates reminders, alerts and a short status summary from the
        dates and amounts you entered, entirely on your device. These are
        organisational prompts only. Livanta makes no automated decision that
        produces legal or similarly significant effects, and it does not build
        a profile of you for advertising.
      </p>

      <h2>14. Security</h2>
      <p>
        The web version is a static site with no application server, which
        removes a large class of attack surface. Sign-in is handled by Supabase
        over HTTPS. We apply a Content-Security-Policy, enforce HTTPS with HSTS,
        deny framing, and restrict cross-origin access on responses from our
        website.
      </p>
      <p>
        On-device data is protected by your device&rsquo;s own security &mdash;
        a screen lock, a passcode and up-to-date software. Livanta does not add
        a separate encryption layer or password to the local database. Anyone
        who can unlock your device or use your browser profile can read the
        records. No method of transmission or storage is completely secure, and
        we do not claim that ours is.
      </p>

      <h2>15. Children</h2>
      <p>
        Livanta is intended for adults managing their own affairs and is not
        directed at children. We do not knowingly collect information from
        children. If you believe a child has created an account, contact us at{" "}
        <span className="legal__todo">[privacy email address]</span> and we will
        delete the account information.
      </p>

      <h2>16. Changes to this policy</h2>
      <p>
        We will update this policy when our processing changes, and will publish
        the new version here with a new date and version number. If a change is
        material, we will take reasonable steps to bring it to your attention
        before it takes effect.
      </p>

      <h2>17. Complaints and contact</h2>
      <p>
        If you are unhappy with how we have handled your information, contact us
        first at <span className="legal__todo">[privacy email address]</span>.
        You also have the right to complain to the Nigeria Data Protection
        Commission.
      </p>
      <p>
        The rules governing your use of the app itself are set out in the{" "}
        <Link href="/terms/">terms of use</Link>.
      </p>
    </article>
  );
}
