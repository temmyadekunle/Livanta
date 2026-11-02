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
        Version 0.1 &middot; draft &middot; 5 October 2026 &middot; applies to the
        Livanta beta
      </p>

      <div className="legal__draft">
        <strong>Draft &mdash; not yet in force</strong>
        This document is a working draft prepared for review. It has not been
        reviewed by a lawyer and the beta is pre-release. Placeholders marked
        below must be filled in before the service is opened more widely.
      </div>

      <h2>1. Agreement</h2>
      <p>
        These terms govern your use of Livanta, the personal life-admin app
        operated by{" "}
        <span className="legal__todo">[full legal name of the operator]</span>{" "}
        (the &ldquo;operator&rdquo;). By using Livanta you accept these terms. If
        you do not accept them, do not use the app.
      </p>

      <h2>2. The service is a beta</h2>
      <p>
        Livanta is <strong>pre-release and under development</strong>. It is
        provided to you free of charge to test, for as long as the operator
        chooses to operate it. We may change, suspend or withdraw any part of it,
        or end the beta and remove the app, at any time and without notice. Your
        stored data may be deleted when the beta ends, so please keep your own
        export &mdash; use &ldquo;Export my data&rdquo; in the Profile tab.
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
        Reminders are computed from information you enter. The app cannot
        verify that what you entered is correct, that a deadline is real, or
        that a reminder was delivered. A reminder you did not receive is not a
        defence for a missed obligation.
      </p>

      <h2>4. Your account</h2>
      <p>
        You may use Livanta without an account, in which case your data stays
        on your device. If you create an account you are responsible for
        keeping your sign-in credentials confidential and for activity that
        occurs under your account. Tell us promptly if you believe someone else
        has accessed it. You must be at least 18 years old to create an
        account. Accounts are personal to you and may not be shared.
      </p>

      <h2>5. Your content</h2>
      <p>
        You keep all ownership of the information you enter into Livanta. You
        grant the operator only the narrow licence needed to host, back up and
        display that information to you &mdash; for example, to store it on our
        database when you use the optional account and sync. That licence ends
        when you delete the data or ask us to delete your account.
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
          store content that is unlawful, infringing, or that you have no
          right to store.
        </li>
      </ul>
      <p>
        Accounts are personal to you. Sharing your sign-in credentials with
        someone else is a breach of these terms.
      </p>

      <h2>7. Payments</h2>
      <p>
        Paid plans are not available in the beta and no payment is taken now.{" "}
        <span className="legal__todo">
          [before any paid plan is sold: state the operator&rsquo;s name as shown
          on the account, the billing intervals available, the refund policy,
          and that prices exclude VAT where applicable]
        </span>.
      </p>

      <h2>8. Availability and changes</h2>
      <p>
        Livanta is provided <strong>as is</strong>. It may be unavailable, and
        features may change or be withdrawn. We do not promise a particular
        level of uptime, and a beta is by nature unstable. We may modify these
        terms; the version and date at the top of this page identify the terms
        that apply to your use.
      </p>

      <h2>9. Your responsibility for backups</h2>
      <p>
        Data stored only on your device exists only on your device. Clearing
        your browser data, uninstalling the browser, wiping the device or
        losing it will delete your records permanently. Livanta cannot recover
        them for you. Export your data regularly and keep the file. The optional
        account and sync are still being completed, so they should not be relied
        on as your only backup. The operator is not liable for records lost on a
        device the operator does not control.
      </p>

      <h2>10. Disclaimer of warranties</h2>
      <p>
        To the fullest extent permitted by law, Livanta is provided without
        warranties of any kind, whether express or implied, including implied
        warranties of merchantability, fitness for a particular purpose, and
        non-infringement. We do not warrant that the app will be uninterrupted,
        error-free, or that any reminder will be delivered in time, and we do
        not warrant the accuracy of anything the app displays.
      </p>

      <h2>11. Limitation of liability</h2>
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

      <h2>12. Indemnity</h2>
      <p>
        You agree to indemnify the operator against claims arising from your use
        of Livanta, your breach of these terms, or content you enter that
        infringes the rights of others.{" "}
        <span className="legal__todo">
          [review whether this indemnity is appropriate for a free consumer beta
          before launch]
        </span>
      </p>

      <h2>13. Ending the agreement</h2>
      <p>
        You may stop using Livanta at any time and delete your on-device data
        from the Profile tab. In-app account deletion is not available yet; to
        delete an account and its synced records, contact us at{" "}
        <span className="legal__todo">[support email address]</span>. We may
        suspend or terminate your access if you breach these terms, in
        particular the acceptable use rules. On termination you should export
        your data, as we may delete it with the beta.
      </p>

      <h2>14. Governing law</h2>
      <p>
        These terms are governed by the laws of the Federal Republic of Nigeria,
        and the courts of Nigeria have exclusive jurisdiction.{" "}
        <span className="legal__todo">
          [if users are expected outside Nigeria, add a consumer arbitration
          and mandatory-law carve-out here]
        </span>
      </p>

      <h2>15. Contact</h2>
      <p>
        Questions about these terms:{" "}
        <span className="legal__todo">[support email address]</span>. See also
        the <Link href="/privacy/">privacy policy</Link>, which explains what
        data Livanta stores and where.
      </p>
    </article>
  );
}
