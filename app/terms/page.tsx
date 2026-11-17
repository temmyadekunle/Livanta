import type { Metadata } from "next";
import Link from "next/link";

import "../legal.css";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms on which the Livanta beta is made available.",
  robots: { index: false, follow: false },
};

export default function TermsPage() {
  return (
    <article className="legal">
      <Link className="legal__back" href="/">
        &larr; Back to Livanta
      </Link>

      <h1>Terms of use</h1>
      <p className="legal__meta">
        Version 0.3 &middot; draft &middot; 17 November 2026 &middot; applies to
        the Livanta beta
      </p>

      <div className="legal__draft">
        <strong>Draft &mdash; not yet in force</strong>
        This version has been corrected to describe how the beta actually works
        today. It has not been reviewed by a lawyer. Items marked in amber still
        need the operator&rsquo;s confirmation and must be completed before the
        service is opened more widely.
      </div>

      <h2>1. Agreement</h2>
      <p>
        These terms govern your use of Livanta, the personal life-admin app
        operated by{" "}
        <span className="legal__todo">[full legal name of the operator]</span>,{" "}
        <span className="legal__todo">[registered address]</span> (the
        &ldquo;operator&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo; or
        &ldquo;our&rdquo;). By creating an account or using Livanta you accept
        these terms. If you do not accept them, do not use the app.
      </p>

      <h2>2. The service is a beta</h2>
      <p>
        Livanta is <strong>pre-release and under development</strong>. It is
        provided to you free of charge to test, for as long as the operator
        chooses to operate it. We may change, suspend or withdraw any part of
        it, or end the beta and remove the app, at any time and without notice.
        Features described on the website or in the app may change before
        release.
      </p>
      <p>
        Your records are stored on your own device, not on our servers. If the
        beta ends, that does not itself delete them, but we may close accounts
        and delete the account information we hold. Keep your own export: use
        &ldquo;Export my data&rdquo; in the Profile tab.
      </p>

      <h2>3. What Livanta is, and is not</h2>
      <p>
        Livanta helps you remember dates, amounts and recurring responsibilities.
        It is an organisational tool. It is{" "}
        <strong>
          not a professional adviser and gives no legal, financial, tax,
          medical or insurance advice
        </strong>
        . Nothing in Livanta, including any alert, reminder, summary or status
        label, should be relied on as advice or as a statement of fact. If a
        deadline matters, confirm it with the institution concerned.
      </p>
      <p>
        Reminders are computed from information you enter. The app cannot verify
        that what you entered is correct, that a deadline is real, or that a
        reminder was delivered. A reminder you did not receive is not a defence
        for a missed obligation.
      </p>

      <h2>4. Your account</h2>
      <p>
        <strong>You need an account to use Livanta.</strong> There is no guest
        mode. Creating an account requires an email address and a password.
        Sign-in is provided by Supabase, and you may also be offered Google or
        Apple sign-in. You are responsible for keeping your sign-in credentials
        confidential and for activity that occurs under your account. Tell us
        promptly at{" "}
        <span className="legal__todo">[support email address]</span> if you
        believe someone else has accessed it.
      </p>
      <p>
        You must be at least 18 years old to create an account. We do not verify
        your age. Accounts are personal to you and may not be shared.
      </p>
      <p>
        <strong>
          Signing out ends your session but does not delete the records stored
          on the device.
        </strong>{" "}
        Records on a device are kept per account: if another person signs in on
        the same browser or app installation, they get their own local records
        and do not see yours. Use &ldquo;Delete all my data&rdquo; before
        handing over a shared device, and see section 9.
      </p>

      <h2>5. Your content and our intellectual property</h2>
      <p>
        You keep all ownership of the information you enter into Livanta. We do
        not currently host or back up that information, so we do not take a
        licence to do so. We process your email address to operate your account
        as described in the{" "}
        <Link href="/privacy/">privacy policy</Link>. If cloud sync is
        introduced, we will update these terms before it is switched on.
      </p>
      <p>
        The app, its software, its name and its branding belong to the operator
        and are protected by intellectual-property laws. These terms do not give
        you any right to copy, modify or redistribute the app except as allowed
        by law.
      </p>
      <p>
        <strong>
          Do not enter identity document numbers, bank account numbers,
          passwords or other authentication secrets
        </strong>
        . Livanta does not ask for them and cannot protect them; the notes and
        details fields accept anything, and that content is stored as you typed
        it.
      </p>

      <h2>6. Acceptable use</h2>
      <p>You agree not to use Livanta to:</p>
      <ul>
        <li>break the law, or infringe anyone else&rsquo;s rights;</li>
        <li>
          attempt to gain unauthorised access to the app, the service behind
          it, or another user&rsquo;s account;
        </li>
        <li>
          probe, scan or test the vulnerability of our systems except with our
          written permission;
        </li>
        <li>
          interfere with the service, including by introducing malicious code
          or by automating access;
        </li>
        <li>
          store content that is unlawful, infringing, or that you have no right
          to store.
        </li>
      </ul>
      <p>
        Accounts are personal to you. Sharing your sign-in credentials with
        someone else is a breach of these terms.
      </p>

      <h2>7. Payments</h2>
      <p>
        Paid plans are not available in the beta and no payment is taken now. We
        do not collect card or bank details.{" "}
        <span className="legal__todo">
          [Before any paid plan is sold: state the operator&rsquo;s name as
          shown on the account, the billing intervals available, the refund
          policy, and whether prices include VAT.]
        </span>
      </p>

      <h2>8. Availability, offline use and changes</h2>
      <p>
        The web version is a static app. Once it has loaded, it can be used
        without a connection, and the Android app carries its own files. Some
        actions, such as signing in, resetting a password or refreshing an
        expired session, need a connection. If you cannot establish a session,
        the app will not open.
      </p>
      <p>
        Livanta is provided <strong>as is</strong>. It may be unavailable, and
        features may change or be withdrawn. We do not promise a particular
        level of uptime, and a beta is by nature unstable.
      </p>

      <h2>9. Data storage, backups and your responsibility</h2>
      <p>
        Data stored only on your device exists only on your device. Clearing
        your browser data, uninstalling the browser or app, wiping the device or
        losing it will delete your records permanently. Livanta cannot recover
        them for you.
      </p>
      <p>
        <strong>
          There is no cloud sync and no cloud backup in this beta.
        </strong>{" "}
        Signing in does not upload your records, and your account is not a
        backup. Records are kept per account on each device and are not copied
        automatically to another device. Export your data regularly from the
        Profile tab and keep the file somewhere safe. The operator is not liable
        for records lost on a device the operator does not control.
      </p>

      <h2>10. Export and deletion</h2>
      <p>
        &ldquo;Export my data&rdquo; in the Profile tab downloads your records
        and settings as a JSON file. You can import that file on the same or
        another device. &ldquo;Delete all my data&rdquo; erases the records and
        settings stored for the signed-in account in this browser or app
        installation, not any other account&rsquo;s local records. It does not
        delete your account or sign you out.
      </p>
      <p>
        In-app account deletion is not available yet. To delete an account and
        the account information we hold, contact us at{" "}
        <span className="legal__todo">[support email address]</span>. Deleting
        the account does not delete records stored on your device; use
        &ldquo;Delete all my data&rdquo; for those.
      </p>

      <h2>11. Notifications and reminders</h2>
      <p>
        Reminders require notification permission. In the Android app, the
        operating system schedules them and they can arrive while the app is
        closed. In a browser, an alert can appear only while Livanta is open in
        a tab. Delivery can be delayed or blocked by battery settings,
        do-not-disturb, the operating system or the browser.
      </p>
      <p>
        We do not guarantee that a reminder will be scheduled, delivered or
        delivered on time. You remain responsible for meeting your obligations
        and for checking anything that matters.
      </p>

      <h2>12. Third-party services</h2>
      <p>
        Livanta relies on third-party services: Supabase for authentication,
        Cloudflare for hosting the web version, GitHub for the Android APK
        download, and Google or Apple if you choose social sign-in. Those
        services have their own terms and privacy policies, and we are not
        responsible for their services. If one of them is unavailable, part of
        Livanta may not work.
      </p>

      <h2>13. Disclaimer of warranties</h2>
      <p>
        To the fullest extent permitted by law, Livanta is provided without
        warranties of any kind, whether express or implied, including implied
        warranties of merchantability, fitness for a particular purpose, and
        non-infringement. We do not warrant that the app will be uninterrupted,
        error-free, or that any reminder will be delivered in time, and we do
        not warrant the accuracy of anything the app displays.
      </p>

      <h2>14. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, the operator is not liable for
        any indirect, incidental, special, consequential or exemplary loss, or
        for loss of profit, revenue, data or goodwill, arising out of or in
        connection with your use of Livanta. The operator&rsquo;s total liability
        to you for all claims relating to Livanta is limited to{" "}
        <span className="legal__todo">[state the cap]</span>.
      </p>
      <p>
        Nothing in these terms excludes liability that cannot lawfully be
        excluded, including for death or personal injury caused by negligence,
        or for fraud or fraudulent misrepresentation.
      </p>

      <h2>15. Indemnity</h2>
      <p>
        You agree to indemnify the operator against claims arising from your use
        of Livanta, your breach of these terms, or content you enter that
        infringes the rights of others.{" "}
        <span className="legal__todo">
          [Review whether this indemnity is appropriate for a free consumer beta
          before launch.]
        </span>
      </p>

      <h2>16. Ending the agreement</h2>
      <p>
        You may stop using Livanta at any time and delete your on-device data
        from the Profile tab. To delete an account and the account information
        we hold, contact us at{" "}
        <span className="legal__todo">[support email address]</span>.
      </p>
      <p>
        We may suspend or terminate your access if you breach these terms, in
        particular the acceptable use rules, or if we end the beta. On
        termination you should export your data. Records on your device remain
        until you delete them or clear the app&rsquo;s data; we may delete the
        account information we hold.
      </p>

      <h2>17. Changes to these terms</h2>
      <p>
        We may modify these terms. The version and date at the top of this page
        identify the terms that apply to your use. If a change is material, we
        will take reasonable steps to bring it to your attention before it takes
        effect.
      </p>

      <h2>18. Governing law</h2>
      <p>
        These terms are governed by the laws of the Federal Republic of Nigeria,
        and the courts of Nigeria have exclusive jurisdiction.{" "}
        <span className="legal__todo">
          [If users are expected outside Nigeria, add a consumer arbitration
          and mandatory-law carve-out here.]
        </span>
      </p>

      <h2>19. Contact</h2>
      <p>
        Questions about these terms:{" "}
        <span className="legal__todo">[support email address]</span>. See also
        the <Link href="/privacy/">privacy policy</Link>, which explains what
        information Livanta stores and where.
      </p>
    </article>
  );
}
