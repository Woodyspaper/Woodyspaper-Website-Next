import type { Metadata } from "next";
import type { ReactNode } from "react";

// Title only: see layout.tsx for why description tags aren't set through Next.
export const metadata: Metadata = {
  title: "Privacy & Cookie Policy | Woody's Paper",
  alternates: { canonical: "/privacy" },
};

/** Shown at the top of the page. Update it whenever the policy text changes. */
const EFFECTIVE_DATE = "November 11, 2026";

const linkClasses =
  "font-semibold text-brand-blue underline decoration-brand-blue/30 underline-offset-4 transition-colors hover:text-brand-blue-dark";

function PolicySection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-chrome space-y-3 lg:scroll-mt-chrome-lg">
      <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h2>
      {children}
    </section>
  );
}

function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-brand-blue">{children}</ul>;
}

/*
 * What this page says has to stay true. If the site starts using something new
 * that touches visitor data (analytics, ads, a newsletter, a new form or
 * payment service), update the matching section and EFFECTIVE_DATE.
 * Cookie names below were read from the live store in November 2026.
 */
export default function PrivacyPage() {
  return (
    <div className="px-4 py-12 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-panel border border-slate-100 bg-white p-6 text-base leading-relaxed text-slate-700 shadow-glass sm:p-10">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">Privacy &amp; Cookie Policy</h1>
        <p className="mt-3 text-sm text-slate-500">Effective {EFFECTIVE_DATE}</p>

        <div className="mt-8 space-y-10">
          <PolicySection id="summary" title="The short version">
            <p>
              Woody&rsquo;s Paper (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a wholesale paper and packaging supplier in
              South Florida. We collect only what we need to answer your inquiries, run your account and fill your
              orders. We do not sell your personal information, and this site carries no advertising trackers.
            </p>
          </PolicySection>

          <PolicySection id="what-we-collect" title="What we collect">
            <Bullets>
              <li>
                <strong>Supply inquiries.</strong> When you send the inquiry form we receive your business name, your
                email address and the product list or message you write.
              </li>
              <li>
                <strong>Website account.</strong> When you create an account on this site we keep your name, your
                email address and your password. The password is stored only in a scrambled (hashed) form that we
                cannot read. If you link your store account, we also keep which store account is yours and a copy
                of its details: your contact and address details, your pricing group and discount, and your order
                totals. Unlinking the store account removes that copy.
              </li>
              <li>
                <strong>Store account and orders.</strong> When you sign in or order through our online store we receive
                your name, email, phone number, billing and delivery addresses, and your order history. The store
                signs you in with a code emailed to you, or automatically through your website account.
              </li>
              <li>
                <strong>Payments.</strong> Card payments are handled by our payment processor. We do not see or store
                your full card number.
              </li>
              <li>
                <strong>Technical information.</strong> Like most websites, our host and our store provider receive
                basic details when your browser loads a page, such as your IP address, browser type and the pages
                requested. See <a href="#cookies" className={linkClasses}>Cookies and browser storage</a> below.
              </li>
            </Bullets>
          </PolicySection>

          <PolicySection id="how-we-use-it" title="How we use it">
            <Bullets>
              <li>To reply to inquiries with pricing, availability and delivery details.</li>
              <li>To create and manage your account, including any customer pricing that applies to you.</li>
              <li>To process, deliver and support your orders, and to keep the records the law requires.</li>
              <li>To keep the site and store working, secure and free of fraud and spam.</li>
            </Bullets>
          </PolicySection>

          <PolicySection id="who-we-share-it-with" title="Who we share it with">
            <p>We share personal information only with the services that help us run the business:</p>
            <Bullets>
              <li>
                <strong>Lightspeed</strong> (the Lightspeed eCom / Ecwid platform) runs our online store, store
                accounts and checkout. If your store account is created through your website account, we pass
                Lightspeed your name and email to set it up and sign you in.
              </li>
              <li>
                <strong>Stripe</strong> and the other payment providers offered at checkout process payments and screen
                for fraud.
              </li>
              <li>
                <strong>FormSubmit</strong> delivers the supply inquiry form to our email inbox.
              </li>
              <li>Our website host, our email provider, and the carriers who deliver your orders.</li>
            </Bullets>
            <p>
              Each of these handles your information under its own privacy policy. We may also disclose information
              when the law requires it, or to protect our rights, our customers or the public. We do not sell or rent
              personal information to anyone.
            </p>
          </PolicySection>

          <PolicySection id="cookies" title="Cookies and browser storage">
            <p>
              Cookies and browser storage are small pieces of data a website keeps in your browser. The pages of this
              site and its online store use the following, all of them to make accounts and the store work:
            </p>
            <Bullets>
              <li>
                <strong>Website sign-in.</strong> When you sign in to your website account we set one cookie,{" "}
                <code>woodys_session</code>, that keeps you signed in for up to 30 days. Signing out removes it. We
                also note in your browser&rsquo;s storage whether the store should sign you in automatically.
              </li>
              <li>
                <strong>Cart, checkout and sign-in.</strong> The store keeps your cart, checkout progress and
                signed-in session in your browser&rsquo;s storage so they survive moving between pages. We also keep
                the number of items in your cart there, to show it in the page header.
              </li>
              <li>
                <strong>Your name beside the cart.</strong> Once you sign in to the store, we keep your name and email
                in your browser&rsquo;s storage so the checkout page can greet you by name. Signing out removes it.
              </li>
              <li>
                <strong>Fraud prevention.</strong> Stripe sets the cookies <code>__stripe_mid</code> and{" "}
                <code>__stripe_sid</code> to help detect fraudulent payments.
              </li>
              <li>
                <strong>Store statistics.</strong> Lightspeed stores an anonymous visitor and session identifier to
                count visits and measure how the store performs. It is not used for advertising.
              </li>
            </Bullets>
            <p>
              We do not use advertising cookies or sell data to ad networks. You can block or delete cookies and site
              data in your browser&rsquo;s settings. If you do, the cart, checkout and sign-in may stop working.
            </p>
          </PolicySection>

          <PolicySection id="retention" title="How long we keep it">
            <p>
              We keep inquiry emails, account details and order records for as long as we need them to serve you and to
              meet our tax, accounting and legal obligations. When we no longer need information we delete it or make
              it anonymous.
            </p>
          </PolicySection>

          <PolicySection id="your-choices" title="Your choices">
            <p>
              You can ask us to show you the personal information we hold about you, to correct it, or to delete it.
              You can also update your store details at any time from your account in the store, and unlink your
              store account from your website account on the account page. Email{" "}
              <a href="mailto:info@woodyspaper.com" className={linkClasses}>
                info@woodyspaper.com
              </a>{" "}
              and we will respond as the law requires. We may need to keep some records, such as past invoices, where
              the law says we must.
            </p>
          </PolicySection>

          <PolicySection id="security" title="Security">
            <p>
              The site and store are served over encrypted connections, passwords are stored only in hashed form, and
              payments are processed by providers that specialise in handling card data. No method of sending or storing information is perfectly secure, so we
              cannot guarantee absolute security.
            </p>
          </PolicySection>

          <PolicySection id="children" title="Children">
            <p>
              This site is for businesses and adult customers. It is not directed to children under 13, and we do not
              knowingly collect personal information from them.
            </p>
          </PolicySection>

          <PolicySection id="changes" title="Changes to this policy">
            <p>
              If we change how we handle personal information we will update this page and the effective date at the
              top.
            </p>
          </PolicySection>

          <PolicySection id="contact" title="Contact us">
            <p>
              Questions about this policy or your information? Email{" "}
              <a href="mailto:info@woodyspaper.com" className={linkClasses}>
                info@woodyspaper.com
              </a>{" "}
              or call{" "}
              <a href="tel:7547011797" className={linkClasses}>
                (754) 701-1797
              </a>
              .
            </p>
          </PolicySection>
        </div>
      </article>
    </div>
  );
}
