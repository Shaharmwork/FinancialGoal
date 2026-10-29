import Image from 'next/image'
import OwlIcon from '@/src/assets/web/icons/Owlicon.png'
import ReportIcon from '@/src/assets/web/icons/ReportIcon.png'
import CompassIcon from '@/src/assets/web/icons/Compass.png'
import TaxIcon from '@/src/assets/web/icons/TaxReserveIcon.png'

const primaryLink = 'inline-flex min-h-12 items-center justify-center rounded-xl border border-[#f4d494] bg-gradient-to-b from-[#ffe3a2] to-[#bd783b] px-6 py-3 text-base font-semibold text-[#211207] shadow-[0_8px_30px_#c48e4330] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ffe3a2]'
const secondaryLink = 'inline-flex min-h-12 items-center justify-center rounded-xl border border-[#a8744a]/60 bg-[#18120e] px-6 py-3 text-base font-semibold text-[#eed4b1] transition hover:bg-[#302117] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ffe3a2]'

export function PublicLanding() {
  return <div className="mx-auto max-w-6xl px-5 sm:px-8">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-black focus:p-4">Skip to content</a>
    <header className="flex items-center justify-between gap-4 border-b border-[#a8744a]/25 py-5">
      <a href="/" aria-label="Financial Goal home" className="flex items-center gap-2">
        <Image src={OwlIcon} alt="" width={44} height={52} className="h-12 w-11 object-contain" />
        <span className="dashboard-gold-title text-lg font-bold sm:text-xl">Financial Goal</span>
      </a>
      <a href="/?auth=signin" className={secondaryLink + ' shrink-0 !px-4'}>Sign in</a>
    </header>
    <main id="main-content">
      <section aria-labelledby="landing-title" className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.25fr_1fr] lg:gap-16">
        <div>
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-[#d3ae83]">Built for Dutch freelancers</p>
          <h1 id="landing-title" className="dashboard-gold-title max-w-2xl text-4xl font-bold leading-[1.12] tracking-tight sm:text-6xl">Prepare for<br/>your year-end<br/>tax bill.</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#d0b99e]">Financial Goal helps Dutch freelancers estimate what to set aside for tax throughout the year. Track income, expenses and working hours to keep your tax outlook up to date, while following progress towards your take-home goal.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/?auth=signup" className={primaryLink}>Create account</a>
            <a href="#how-it-works" className={secondaryLink}>See how it works</a>
          </div>
          <p className="mt-4 text-sm text-[#b0947a]">Use it in your phone or desktop browser.</p>
        </div>
        <div className="relative mx-auto w-full max-w-sm rounded-[32px] border border-[#bd8d58]/60 bg-[radial-gradient(ellipse_at_top,#49301c_0%,#1d1510_50%,#110d0a_100%)] p-7 text-center shadow-[0_20px_70px_#0008,inset_0_0_0_5px_#bc8a4a0a]">
          <Image src={OwlIcon} alt="The bronze owl of Financial Goal" width={220} height={260} priority className="mx-auto h-56 w-48 object-contain drop-shadow-[0_12px_18px_#0009]" />
          <p className="dashboard-gold-title mt-3 text-2xl font-bold">Plan your tax reserve.</p>
          <p className="mt-3 leading-relaxed text-[#d0b99e]">See how your reported income shapes your estimated tax bill and what you may need to set aside.</p>
          <div className="mt-6 grid grid-cols-3 gap-2 border-t border-[#a8744a]/30 pt-5 text-sm text-[#e5c6a3]">
            <span>Log income</span><span>Review tax</span><span>Plan ahead</span>
          </div>
        </div>
      </section>
      <section aria-labelledby="features-title" className="border-t border-[#a8744a]/25 py-12">
        <h2 id="features-title" className="dashboard-gold-title text-2xl font-bold sm:text-3xl">Tax preparation, built into your working year.</h2>
        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {[
            { icon: TaxIcon, title: 'Prepare for your tax bill', text: 'Review your estimated yearly tax and tax reserve guidance as your income develops, based on the app’s supported Dutch tax rules and your settings.' },
            { icon: ReportIcon, title: 'Keep your tax picture up to date', text: 'Log daily hours, income and business expenses. Backfill past months and spot missing reports so your estimates reflect the work you have recorded.' },
            { icon: CompassIcon, title: 'Follow your take-home goal', text: 'Set the net income you want each month and track your progress. Use your rate, working hours and planned days off to support your income plan.' },
          ].map(feature => <article key={feature.title} className="rounded-2xl border border-[#a8744a]/35 bg-[#201711]/80 p-6">
            <Image src={feature.icon} alt="" width={56} height={56} className="mb-5 h-14 w-14 object-contain" />
            <h3 className="text-lg font-semibold text-[#f3e4cf]">{feature.title}</h3>
            <p className="mt-3 text-base leading-relaxed text-[#c7ae92]">{feature.text}</p>
          </article>)}
        </div>
      </section>
      <section id="how-it-works" aria-labelledby="steps-title" className="scroll-mt-6 border-t border-[#a8744a]/25 py-12">
        <h2 id="steps-title" className="dashboard-gold-title text-2xl font-bold sm:text-3xl">Get started, one step at a time.</h2>
        <ol className="mt-8 grid gap-8 md:grid-cols-3">
          {[
            ['Create your account', 'Register with your email and confirm it using the link in your inbox.'],
            ['Set up your tax and income plan', 'The guided setup walks through your tax assumptions, income goal, rates and working hours, with explanations along the way.'],
            ['Review your tax outlook regularly', 'Keep your reports up to date, review your estimated tax reserve and follow progress towards your take-home goal throughout the year.'],
          ].map(([title, text], index) => <li key={title}>
            <span aria-hidden="true" className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#c7955b]/50 text-[#edc78e]">{index + 1}</span>
            <h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 leading-relaxed text-[#c7ae92]">{text}</p>
          </li>)}
        </ol>
      </section>
      <section aria-labelledby="questions-title" className="border-t border-[#a8744a]/25 py-12">
        <h2 id="questions-title" className="dashboard-gold-title text-2xl font-bold sm:text-3xl">A few things to know</h2>
        <div className="mt-6 divide-y divide-[#a8744a]/25">
          {[
            ['Who is Financial Goal for?', 'The app is designed for freelancers and self-employed people in the Netherlands (ZZP) who want to prepare for their year-end tax bill while tracking their income goals. Amounts are in euros, and estimates use supported Dutch tax rules.'],
            ['Can I use it on my phone?', 'Yes. Open Financial Goal in your phone’s browser and sign in. Your saved reports and settings are linked to your account, so you can also use them on your computer.'],
            ['Does it file my taxes?', 'No. Financial Goal helps with planning and estimates; it does not submit tax returns. Keep your official records and check your tax position with your accountant.'],
          ].map(([question, answer]) => <details key={question} className="py-5">
            <summary className="cursor-pointer text-lg font-semibold text-[#ead3b6]">{question}</summary>
            <p className="mt-3 max-w-3xl leading-relaxed text-[#c7ae92]">{answer}</p>
          </details>)}
        </div>
      </section>
      <section className="mb-12 rounded-2xl border border-[#b78650]/40 bg-[#241a12] px-6 py-10 text-center">
        <h2 className="dashboard-gold-title text-2xl font-bold sm:text-3xl">Start preparing before the tax bill arrives.</h2>
        <p className="mx-auto mt-3 max-w-lg leading-relaxed text-[#c7ae92]">Build a clearer picture of what you may owe and what to set aside, while keeping your take-home goal in view.</p>
        <a href="/?auth=signup" className={primaryLink + ' mt-6'}>Create account</a>
      </section>
    </main>
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-[#a8744a]/25 py-6 text-sm text-[#b0947a]">
      <p>Financial Goal · Tax preparation &amp; income planning for Dutch freelancers</p>
      <a href="/?auth=signin" className="text-[#ead3b6] underline underline-offset-4">Sign in</a>
    </footer>
  </div>
}
