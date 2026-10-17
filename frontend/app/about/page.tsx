"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const AGENTS: [string, string][] = [
  ["Location Agent", "Reads the position her phone shares, looks up the street address and builds a map link."],
  ["Alert Agent", "Writes a short alert and sends it to her trusted contact by text, call and Discord. If it fails, a fixed template sends the same alert."],
  ["Intake Agent", "Asks one gentle question at a time, in Urdu, Roman Urdu or English. Any question can be skipped."],
  ["Drafting Agent", "Writes the full police complaint and a public summary, and rewrites the summary until it passes the privacy checks."],
  ["Matching Agent", "Compares the anonymised case with activist groups and picks only the close matches."],
  ["Email Agent", "Sends the public summary, one recipient per email: first to matched groups, later to news outlets if needed."],
  ["Police Dispatch Agent", "Submits the full complaint to the police dashboard and starts the 24-hour clock."],
  ["Police Status Agent", "After 24 hours, checks whether the police acted. If they did not, news outlets are told."],
];

const NUMBERS: [string, string][] = [
  ["15", "Police emergency"],
  ["1122", "Rescue"],
  ["1099", "Ministry of Human Rights helpline"],
  ["1098", "Madadgaar (women and children)"],
  ["1043", "Punjab Women Helpline"],
];

export default function About() {
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
            It does two things for someone facing harassment in Pakistan: it reaches a person she trusts the moment she is in danger, and it helps her
            report what happened to the police without exposing who she is.
          </p>
          <p className="mt-6 border-l-4 border-danger pl-4 text-body">
            Awaaz does not replace emergency services. If you are in immediate danger, call{" "}
            <a href="tel:15" className="font-semibold underline underline-offset-4">
              15
            </a>{" "}
            for the police or{" "}
            <a href="tel:1122" className="font-semibold underline underline-offset-4">
              1122
            </a>{" "}
            for Rescue.
          </p>
        </header>

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
                  <span className="tabular font-mono text-muted">1</span>She can tell what happened, in her own words and language.
                </li>
                <li className="flex gap-3">
                  <span className="tabular font-mono text-muted">2</span>Awaaz writes a police complaint and a public summary. She reads both and decides.
                </li>
                <li className="flex gap-3">
                  <span className="tabular font-mono text-muted">3</span>The police get the complaint. Activist groups get the summary. If the police do
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
                  Police
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
                <td className="py-3 text-ink-2">The same public summary, only if the police record no action within 24 hours, and only if she has not cancelled.</td>
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
              ["Code then enforces the list.", "A scanner blocks those details, plus phone numbers, emails, ID numbers, links and street addresses, in English and Urdu script."],
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
              <li>Awaaz cannot make the police or anyone else act.</li>
              <li>Location depends on her phone sharing it; indoors it can be approximate.</li>
              <li>The privacy checks are strict but automated, which is why she always reads the summary first.</li>
              <li>Messages depend on the network and on the providers this server is set up with.</li>
            </ul>
          </div>
          <div aria-labelledby="numbers">
            <h2 id="numbers" className="text-title font-semibold">
              Emergency numbers
            </h2>
            <table className="mt-3 w-full text-body">
              <caption className="sr-only">Emergency numbers in Pakistan</caption>
              <tbody className="divide-y divide-line">
                {NUMBERS.map(([n, d]) => (
                  <tr key={n}>
                    <th scope="row" className="tabular w-16 py-2 text-left font-mono font-semibold">
                      <a href={`tel:${n}`} className="underline underline-offset-4">
                        {n}
                      </a>
                    </th>
                    <td className="py-2 text-ink-2">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="border-t border-line pt-6 text-small text-ink-2">
          Police officers use a separate{" "}
          <Link href="/police" className="font-semibold underline underline-offset-4">
            complaint dashboard
          </Link>
          .
        </p>
      </article>
    </div>
  );
}
