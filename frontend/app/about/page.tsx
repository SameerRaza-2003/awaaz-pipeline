"use client";

import { ArrowDown, Bot, Clock, Eye, FileLock2, Globe2, Landmark, ShieldAlert, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const AGENTS: [string, string][] = [
  ["Location Agent", "Reads the position the phone shares, looks up the street address and builds a map link."],
  ["Alert Agent", "Writes a short alert and sends it to the trusted contact by SMS, call and Discord. If it fails, a fixed template sends the same alert."],
  ["Intake Agent", "Listens, and asks one gentle question at a time in Urdu, Roman Urdu or English. Any question can be skipped."],
  ["Drafting Agent", "Writes a full police complaint and an anonymised public summary, rewriting the summary until it passes the privacy checks."],
  ["Matching Agent", "Compares the anonymised case with activist groups and picks only those that are a close match."],
  ["Email Agent", "Emails the anonymised summary, one recipient per email: first to matched groups, later to news outlets if needed."],
  ["Police Dispatch Agent", "Submits the full complaint to the police dashboard and starts a 24-hour timer."],
  ["Police Status Agent", "After 24 hours, checks whether the police acted. If not, the news outlets are told."],
];

function Step({ icon: Icon, title, text, tone = "border-line" }: { icon: typeof Bot; title: string; text: string; tone?: string }) {
  return (
    <div className={`card flex items-start gap-3 border p-3 ${tone}`}>
      <Icon size={18} className="mt-0.5 shrink-0 text-ink-2" />
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted">{text}</div>
      </div>
    </div>
  );
}

const Down = () => (
  <div className="flex justify-center py-1 text-muted">
    <ArrowDown size={16} />
  </div>
);

function Diagram() {
  return (
    <div className="card p-4 sm:p-6">
      <div className="mx-auto max-w-sm">
        <Step icon={UserRound} title="“Are you in danger right now?”" text="The first and only question until she chooses." />
      </div>
      <div className="mt-2 grid gap-6 sm:grid-cols-2">
        <div>
          <div className="label mb-2 text-center text-danger">Yes</div>
          <Step icon={ShieldAlert} title="Location and alert" text="Address and map link go to the trusted contact by SMS, call and Discord." tone="border-danger/40" />
          <Down />
          <Step icon={Clock} title="Live updates" text="New location every two minutes until she presses “I'm safe”." />
        </div>
        <div>
          <div className="label mb-2 text-center text-accent">No, report it</div>
          <Step icon={Bot} title="Gentle interview" text="One question at a time, in her language." tone="border-accent/40" />
          <Down />
          <Step icon={FileLock2} title="Two drafts, privacy-checked" text="She reads both and decides. Nothing is sent before she presses Send." />
          <Down />
          <div className="grid grid-cols-2 gap-2">
            <Step icon={Landmark} title="Police" text="Full complaint on the dashboard." />
            <Step icon={Globe2} title="Activist groups" text="Anonymised summary only." />
          </div>
          <Down />
          <Step icon={Clock} title="After 24 hours" text="If the police record no action, news outlets get the anonymised summary." />
        </div>
      </div>
    </div>
  );
}

export default function About() {
  const [communities, setCommunities] = useState<{ name: string; countries: string }[]>([]);
  const [news, setNews] = useState<{ name: string; country: string }[]>([]);
  useEffect(() => {
    api("/api/communities").then(setCommunities).catch(() => {});
    api("/api/news-agencies").then(setNews).catch(() => {});
  }, []);

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <article className="mx-auto w-full max-w-3xl space-y-10 px-4 py-8 sm:px-6">
        <header className="space-y-3">
          <p className="label">How it works</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Help fast. Report safely. On her terms.</h1>
          <p className="text-lg text-ink-2">
            Awaaz means “voice”. It helps survivors of harassment reach someone they trust in an emergency, and report what happened without
            exposing who they are.
          </p>
          <p className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            Awaaz is not a substitute for emergency services. In immediate danger in Pakistan, call <strong>15</strong> (Police) or <strong>1122</strong> (Rescue).
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">The flow</h2>
          <Diagram />
          <p className="text-sm text-ink-2">
            Each step is an AI agent with a small set of tools, and every tool call is visible live on the home page. The order of steps, who
            can be contacted, and every safety check are fixed in code. If an agent fails, a fixed fallback does the same job, so help is never
            held back.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Who sees what</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [FileLock2, "Private", "Her name, contact, address, the accused's name and the full account go only to the police dashboard, encrypted. The chat is deleted after sending."],
              [Landmark, "The police", "The full complaint she approved, her contact details, and a 24-hour deadline."],
              [Eye, "The public", "Activist groups, and later news outlets, get only the anonymised summary and a random reference. If the privacy checks cannot confirm it is clean, nothing is published."],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof Bot;
              return (
                <div key={t as string} className="card p-4">
                  <I size={18} className="text-ink-2" />
                  <h3 className="mt-2 text-sm font-semibold">{t as string}</h3>
                  <p className="mt-1 text-sm text-ink-2">{d as string}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">How privacy is protected</h2>
          <ol className="card divide-y divide-line text-sm">
            {[
              ["AI identifies", "Before drafting, a model lists every detail in the case that could identify someone: names, plate numbers, handles, workplaces."],
              ["Code enforces", "A deterministic scanner blocks those details plus phone numbers, emails, ID numbers, links and addresses, in English and Urdu script."],
              ["AI double-checks", "A second, independent model review reads the final summary. Both checks must pass; if either cannot run, nothing is published."],
              ["She decides", "She reads both versions, can edit or ask for changes, and nothing leaves until she presses Send."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3 p-4">
                <span className="font-mono text-xs text-muted">0{i + 1}</span>
                <div>
                  <div className="font-medium">{t}</div>
                  <div className="text-ink-2">{d}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">The agents</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {AGENTS.map(([n, d]) => (
              <li key={n} className="card p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Bot size={15} className="text-ink-2" /> {n}
                </div>
                <div className="mt-1 text-sm text-ink-2">{d}</div>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Who receives public reports</h2>
          <p className="text-sm text-muted">This demo uses fictional organisations with test addresses.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Activist groups", communities.map((c) => [c.name, c.countries])],
              ["News outlets", news.map((c) => [c.name, c.country])],
            ].map(([title, rows]) => (
              <div key={title as string} className="card p-4">
                <h3 className="text-sm font-semibold">{title as string}</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {(rows as string[][]).map(([n, c]) => (
                    <li key={n} className="flex justify-between gap-2">
                      <span>{n}</span>
                      <span className="font-mono text-xs text-muted">{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Limits</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
              <li>Awaaz cannot guarantee that the police or anyone else will act.</li>
              <li>Location depends on the phone sharing it; indoors it may be approximate.</li>
              <li>The privacy checks are strict but automated, so she always reviews the summary.</li>
              <li>Messages depend on the network and the providers in use.</li>
            </ul>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">Emergency numbers</h2>
            <dl className="card divide-y divide-line text-sm">
              {[
                ["15", "Police emergency"],
                ["1122", "Rescue"],
                ["1099", "Human Rights helpline"],
                ["1098", "Madadgaar (women and children)"],
                ["1043", "Punjab Women Helpline"],
              ].map(([n, d]) => (
                <div key={n} className="flex items-center gap-4 px-4 py-2">
                  <dt className="w-12 font-mono font-medium">{n}</dt>
                  <dd className="text-ink-2">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </article>
    </div>
  );
}
