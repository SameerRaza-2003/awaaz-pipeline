"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CallLinks } from "@/components/chat/parts";
import { pretty, useEmergency } from "@/lib/emergency";

const AGENTS: [string, string][] = [
  ["Location Agent", "Reads the position her phone shares, looks up the street address and builds a map link."],
  ["Alert Agent", "Writes a short alert and sends it to her trusted contact by text, call and Discord. If it fails, a fixed template sends the same alert."],
  ["Intake Agent", "Asks one gentle question at a time, in plain English. Any question can be skipped."],
  ["Drafting Agent", "Writes the full complaint for the authorities and a public summary, and rewrites the summary until it passes the privacy checks."],
  ["Matching Agent", "Compares the anonymised case with activist groups and picks only the close matches."],
  ["Email Agent", "Sends the public summary, one recipient per email: first to matched groups, later to news outlets if needed."],
  ["Authorities Dispatch Agent", "Submits the full complaint to the authorities dashboard and starts the 24-hour clock."],
  ["Authorities Status Agent", "After 24 hours, checks whether the authorities acted. If they did not, news outlets are told."],
];

/** Headline figures. Every number links to its source below. */
const FACTS: { value: string; text: string; src: number }[] = [
  {
    value: "89,000",
    text: "women and girls were killed intentionally in 2022, the highest yearly number in two decades. More than half were killed by a partner or family member.",
    src: 1,
  },
  {
    value: "1 in 3",
    text: "women worldwide, about 736 million, have faced physical or sexual violence. The share has barely moved in a decade.",
    src: 2,
  },
  {
    value: "1 in 5",
    text: "workers, about 743 million people, have faced violence or harassment at work. Fewer than 55% of recent victims told anyone.",
    src: 3,
  },
];

type Trend = { title: string; unit: string; rows: [string, number, string][]; note: string; src: number };

const TRENDS: Trend[] = [
  {
    title: "Severe online harassment",
    unit: "Share of US adults who have faced threats, stalking, sexual harassment or sustained harassment online",
    rows: [
      ["2014", 15, "15%"],
      ["2017", 18, "18%"],
      ["2020", 25, "25%"],
    ],
    note: "Up two thirds in six years.",
    src: 4,
  },
  {
    title: "Online enticement reports",
    unit: "Reports of adults targeting children online, sent to NCMEC's CyberTipline by platforms worldwide",
    rows: [
      ["2021", 44_155, "44,155"],
      ["2022", 80_524, "80,524"],
      ["2023", 186_000, "186,000+"],
      ["2025", 1_400_000, "1.4 million"],
    ],
    note: "Part of the recent jump comes from a 2024 US law that made platforms report these cases.",
    src: 5,
  },
];

const SOURCES: [string, string][] = [
  [
    "UNODC and UN Women, Gender-related killings of women and girls, 2023",
    "https://www.unodc.org/unodc/en/press/releases/2023/November/more-women-and-girls-killed-in-2022-even-as-overall-homicide-numbers-fall--says-new-research-from-unodc-and-un-women.html",
  ],
  ["World Health Organization, Violence against women prevalence estimates, 2021", "https://www.who.int/news/item/09-03-2021-devastatingly-pervasive-1-in-3-women-globally-experience-violence"],
  ["ILO, Lloyd's Register Foundation and Gallup, Experiences of violence and harassment at work, 2022", "https://news.un.org/en/node/1131372"],
  ["Pew Research Center, The State of Online Harassment, 2021", "https://www.pewresearch.org/internet/2021/01/13/the-state-of-online-harassment/"],
  ["National Center for Missing & Exploited Children, CyberTipline data, 2022 to 2025", "https://www.missingkids.org/cybertiplinedata"],
];

function Ref({ n }: { n: number }) {
  return (
    <a href={`#src-${n}`} className="ml-0.5 align-super text-caption font-semibold text-muted no-underline hover:text-ink" aria-label={`Source ${n}`}>
      {n}
    </a>
  );
}

function TrendChart({ t }: { t: Trend }) {
  const max = Math.max(...t.rows.map((r) => r[1]));
  return (
    <figure className="border-t border-line pt-4">
      <figcaption>
        <span className="block text-lead font-semibold">
          {t.title}
          <Ref n={t.src} />
        </span>
        <span className="mt-1 block text-small text-ink-2">{t.unit}</span>
      </figcaption>
      <dl className="mt-4 space-y-2">
        {t.rows.map(([year, v, label], i) => (
          <div key={year} className="grid grid-cols-[3rem_1fr] items-center gap-3">
            <dt className="tabular font-mono text-small text-muted">{year}</dt>
            <dd className="flex items-center gap-3">
              <span
                className={`h-6 rounded-sm ${i === t.rows.length - 1 ? "bg-danger" : "bg-line-strong"}`}
                style={{ width: `${Math.max(2, (v / max) * 50)}%` }}
                aria-hidden
              />
              <span className="tabular shrink-0 font-mono text-small font-semibold">{label}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-small text-ink-2">{t.note}</p>
    </figure>
  );
}

export default function About() {
  const emergency = useEmergency();
  const [communities, setCommunities] = useState<{ name: string; countries: string }[]>([]);
  const [news, setNews] = useState<{ name: string; country: string }[]>([]);
  useEffect(() => {
    api("/api/communities").then(setCommunities).catch(() => {});
    api("/api/news-agencies").then(setNews).catch(() => {});
  }, []);

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <article className="mx-auto w-full max-w-2xl space-y-14 px-5 py-12 sm:px-8 sm:py-16">
        <header>
          <p className="label">How it works</p>
          <h1 className="mt-3 text-display font-semibold sm:text-hero">Awaaz means voice.</h1>
          <p className="mt-4 text-lead text-ink-2">
            It does two things for someone facing harassment, wherever she is: it reaches a person she trusts the moment she is in danger, and it
            helps her report what happened to the authorities without exposing who she is.
          </p>
          <p className="mt-6 border-l-4 border-danger pl-4 text-body">
            Awaaz does not replace emergency services. If you are in immediate danger, call <CallLinks />.
          </p>
        </header>

        <section aria-labelledby="why">
          <p className="label">The problem</p>
          <h2 id="why" className="mt-2 text-title font-semibold">
            Harassment is growing, and most of it is never reported
          </h2>
          <p className="mt-2 text-body text-ink-2">
            Violence against women has not fallen in a decade, and harassment has moved online, where it is rising fast. Fear of being identified keeps
            most survivors silent. That silence is what Awaaz is built to break.
          </p>

          <dl className="mt-6 grid gap-6 sm:grid-cols-3">
            {FACTS.map((f) => (
              <div key={f.value} className="border-l-4 border-danger pl-4">
                <dt className="tabular font-heading text-display font-semibold leading-none">
                  {f.value}
                  <Ref n={f.src} />
                </dt>
                <dd className="mt-2 text-small text-ink-2">{f.text}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 grid gap-10 sm:grid-cols-2">
            {TRENDS.map((t) => (
              <TrendChart key={t.title} t={t} />
            ))}
          </div>

          <ol className="mt-8 space-y-1 border-t border-line pt-4 text-caption text-muted">
            {SOURCES.map(([name, url], i) => (
              <li key={url} id={`src-${i + 1}`} className="flex gap-2">
                <span className="tabular font-mono">{i + 1}</span>
                <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
                  {name}
                </a>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="flow">
          <h2 id="flow" className="text-title font-semibold">
            The first question
          </h2>
          <p className="mt-2 text-body text-ink-2">Every session starts with one question: are you in danger right now?</p>
          <div className="mt-6 grid gap-8 sm:grid-cols-2">
            <div>
              <h3 className="text-lead font-semibold">If she answers yes</h3>
              <ol className="mt-3 space-y-3 text-body">
                <li className="flex gap-3">
                  <span className="tabular font-mono text-muted">1</span>Her phone shares its location.
                </li>
                <li className="flex gap-3">
                  <span className="tabular font-mono text-muted">2</span>Her trusted contact gets the address and a map link by text, call and Discord.
                </li>
                <li className="flex gap-3">
                  <span className="tabular font-mono text-muted">3</span>New locations follow every two minutes until she taps &quot;I&apos;m safe&quot;.
                </li>
              </ol>
            </div>
            <div>
              <h3 className="text-lead font-semibold">If she answers no</h3>
              <ol className="mt-3 space-y-3 text-body">
                <li className="flex gap-3">
                  <span className="tabular font-mono text-muted">1</span>She can tell what happened, in her own words.
                </li>
                <li className="flex gap-3">
                  <span className="tabular font-mono text-muted">2</span>Awaaz writes a complaint for the authorities and a public summary. She reads both and decides.
                </li>
                <li className="flex gap-3">
                  <span className="tabular font-mono text-muted">3</span>The authorities get the complaint. Activist groups get the summary. If the authorities do
                  nothing for 24 hours, news outlets get it too.
                </li>
              </ol>
            </div>
          </div>
        </section>

        <section aria-labelledby="who">
          <h2 id="who" className="text-title font-semibold">
            Who sees what
          </h2>
          <table className="mt-4 w-full text-left text-body">
            <caption className="sr-only">What each audience receives</caption>
            <thead>
              <tr className="border-b border-line-strong">
                <th scope="col" className="label py-2 pr-4">
                  Who
                </th>
                <th scope="col" className="label py-2">
                  What they receive
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <th scope="row" className="py-3 pr-4 align-top font-semibold">
                  Authorities
                </th>
                <td className="py-3 text-ink-2">The full complaint she approved, with her name and contact, stored encrypted.</td>
              </tr>
              <tr>
                <th scope="row" className="py-3 pr-4 align-top font-semibold">
                  Activist groups
                </th>
                <td className="py-3 text-ink-2">The public summary and a random reference. Never her name, number or address.</td>
              </tr>
              <tr>
                <th scope="row" className="py-3 pr-4 align-top font-semibold">
                  News outlets
                </th>
                <td className="py-3 text-ink-2">The same public summary, only if the authorities record no action within 24 hours, and only if she has not cancelled.</td>
              </tr>
              <tr>
                <th scope="row" className="py-3 pr-4 align-top font-semibold">
                  Awaaz itself
                </th>
                <td className="py-3 text-ink-2">Keeps the public summary and references. The conversation is deleted once the report is sent.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section aria-labelledby="privacy">
          <h2 id="privacy" className="text-title font-semibold">
            How the public summary stays anonymous
          </h2>
          <ol className="mt-4 space-y-4 text-body">
            {[
              ["An AI reads the whole account first", "and lists every detail that could identify someone: names, plate numbers, handles, workplaces."],
              ["Code then enforces the list.", "A scanner blocks those details, plus phone numbers, emails, ID numbers, links and street addresses."],
              ["A second, separate AI read", "checks the finished summary. Both checks must pass. If either cannot run, nothing is published."],
              ["She decides.", "She reads both versions, can edit or ask for changes, and nothing leaves until she presses Send."],
            ].map(([lead, rest], i) => (
              <li key={i} className="flex gap-3">
                <span className="tabular font-mono text-muted">{i + 1}</span>
                <span>
                  <strong>{lead}</strong> {rest}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="agents">
          <h2 id="agents" className="text-title font-semibold">
            The agents
          </h2>
          <p className="mt-2 text-body text-ink-2">
            Each step is an AI agent with a small set of tools. The order of steps, who can be contacted and every safety check are fixed in code. If an
            agent fails, a fixed fallback does the same job, so help is never held back.
          </p>
          <dl className="mt-4 divide-y divide-line border-y border-line">
            {AGENTS.map(([n, d]) => (
              <div key={n} className="py-3 sm:grid sm:grid-cols-[12rem_1fr] sm:gap-4">
                <dt className="font-semibold">{n}</dt>
                <dd className="text-ink-2">{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="recipients">
          <h2 id="recipients" className="text-title font-semibold">
            Who receives public reports
          </h2>
          <p className="mt-2 text-small text-muted">This demo uses fictional organisations with test addresses.</p>
          <div className="mt-4 grid gap-8 sm:grid-cols-2">
            {[
              ["Activist groups", communities.map((c) => [c.name, c.countries])],
              ["News outlets", news.map((c) => [c.name, c.country])],
            ].map(([title, rows]) => (
              <div key={title as string}>
                <h3 className="label">{title as string}</h3>
                {(rows as string[][]).length === 0 ? (
                  <p className="mt-2 text-small text-muted">Not loaded.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-line border-y border-line text-small">
                    {(rows as string[][]).map(([n, c]) => (
                      <li key={n} className="flex justify-between gap-3 py-2">
                        <span>{n}</span>
                        <span className="font-mono text-caption text-muted">{c}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-10 sm:grid-cols-2">
          <div aria-labelledby="limits">
            <h2 id="limits" className="text-title font-semibold">
              Limits
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-body text-ink-2">
              <li>Awaaz cannot make the authorities or anyone else act.</li>
              <li>Location depends on her phone sharing it; indoors it can be approximate.</li>
              <li>The privacy checks are strict but automated, which is why she always reads the summary first.</li>
              <li>Messages depend on the network and on the providers this server is set up with.</li>
            </ul>
          </div>
          <div aria-labelledby="numbers">
            <h2 id="numbers" className="text-title font-semibold">
              Emergency numbers
            </h2>
            <p className="mt-1 text-small text-muted">For where this phone is. 112 works from most mobiles worldwide.</p>
            <table className="mt-3 w-full text-body">
              <caption className="sr-only">Emergency numbers where you are</caption>
              <tbody className="divide-y divide-line">
                {[...emergency.primary, ...emergency.helplines].map((n) => (
                  <tr key={n.number}>
                    <th scope="row" className="tabular py-2 pr-4 text-left font-mono font-semibold whitespace-nowrap">
                      <a href={`tel:${n.number}`} className="underline underline-offset-4">
                        {pretty(n.number)}
                      </a>
                    </th>
                    <td className="py-2 text-ink-2">{n.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="border-t border-line pt-6 text-small text-ink-2">
          The authorities use a separate{" "}
          <Link href="/authorities" className="font-semibold underline underline-offset-4">
            complaint dashboard
          </Link>
          .
        </p>
      </article>
    </div>
  );
}
