"use client";

import { ArrowRight, Bot, Building2, Check, FileText, KeyRound, Mail, MapPin, MessageSquare, Phone, Siren, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Health } from "@/lib/api";

const ICON = 20;
const STROKE = 1.75;

type Step = {
  icon: typeof Siren;
  title: string;
  time: string;
  doThis: string[];
  youSee: string;
  cta: { href: string; label: string };
  danger?: boolean;
};

const SWAPS: { intended: string; demo: string; why: string; icon: typeof Siren }[] = [
  {
    icon: MessageSquare,
    intended: "WhatsApp message",
    demo: "Discord message",
    why: "The WhatsApp Business API needs a verified business account and charges per conversation. A Discord webhook is free and instant. The alert is written once and the channel is a setting, so WhatsApp is a drop-in swap.",
  },
  {
    icon: Phone,
    intended: "Twilio SMS and voice call",
    demo: "MacroDroid on an Android phone",
    why: "Twilio bills every message and call, and its free trial is not available in many countries. A spare Android phone running MacroDroid sends real SMS and places real calls from its own SIM, at no cost. Twilio support is already built in and switches on with one setting.",
  },
  {
    icon: Building2,
    intended: "Police or government complaint systems",
    demo: "The authorities dashboard in this app",
    why: "There is no public API for filing harassment complaints. The dashboard shows the exact hand-off: the full complaint arrives, an officer updates its status, and the 24-hour clock reads that status.",
  },
  {
    icon: Mail,
    intended: "Real activist groups and news outlets",
    demo: "Fictional organisations with team inboxes",
    why: "So no real organisation is contacted while the app is judged. The emails are real and are sent through Gmail.",
  },
  {
    icon: MapPin,
    intended: "Google Maps",
    demo: "OpenStreetMap",
    why: "Free and needs no billing account. It turns the phone's position into a street address and a map link.",
  },
];

function Setting({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <dt className="label">{label}</dt>
      <dd className="mt-1 flex items-start gap-2 text-small font-semibold">
        {ok ? (
          <Check size={16} strokeWidth={2.25} className="mt-0.5 shrink-0 text-safe-ink" aria-hidden />
        ) : (
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full border border-line-strong" aria-hidden />
        )}
        <span>{value}</span>
      </dd>
    </div>
  );
}

export default function Guide() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    api<Health>("/healthz")
      .then(setHealth)
      .catch(() => {});
  }, []);
  const demo = health?.demo;
  const hours = Math.round((health?.escalation_delay_seconds ?? 86400) / 3600);

  const STEPS: Step[] = [
    {
      icon: UserRound,
      title: "Sign in as the survivor",
      time: "30 seconds",
      doThis: [
        "Press “Sign in” at the top right, or the button below.",
        "Use the survivor account from the submission PDF.",
        "You land on her account page.",
      ],
      youSee:
        "Accounts are optional and need no email or real name. An account remembers her trusted contact, so in an emergency there is nothing to type.",
      cta: { href: "/account", label: "Sign in" },
    },
    {
      icon: Phone,
      title: "Make yourself her trusted contact",
      time: "1 minute",
      doThis: [
        "Under “Trusted contact”, enter your name and your phone number with its country code.",
        "Optional: paste a Discord webhook for a channel you can see.",
        "Press Save.",
      ],
      youSee:
        "From now on every alert from this account goes to you. Calls and SMS come from the team's phone in Pakistan, so if your number is abroad and does not ring, the Discord alert still arrives anywhere.",
      cta: { href: "/account", label: "Open the account page" },
    },
    {
      icon: Siren,
      danger: true,
      title: "Press “I am in danger”",
      time: "1 minute",
      doThis: [
        "Go to the home screen and press “I am in danger: get help now”.",
        "Allow location when the browser asks.",
        "Let the three-second countdown run.",
      ],
      youSee:
        "You receive an SMS, a phone call and a Discord message that name her (her account’s display name) and give her street address and a map link. A new location follows every two minutes until she presses “I'm safe”. The Workflow tab shows the Location and Alert agents doing it live.",
      cta: { href: "/", label: "Go to the home screen" },
    },
    {
      icon: FileText,
      title: "Report what happened",
      time: "3 minutes",
      doThis: [
        "Start a new session and answer “No, I want to report”.",
        "Describe an incident in your own words, then answer a few short questions. Any can be skipped.",
        "Read the two versions it writes, then send.",
      ],
      youSee:
        "Agents write a full complaint for the authorities and an anonymised public summary that passes two privacy checks. Matched activist groups get a designed email. The Agents and Events tabs show every tool call. Note the reference on the receipt.",
      cta: { href: "/", label: "Start a report" },
    },
    {
      icon: Building2,
      title: "The complaint reaches the authorities",
      time: "1 minute",
      doThis: [
        "The moment you press Send, the full complaint is filed on the authorities' dashboard. Open it with the officer account from the submission PDF and you will find it there, under the reference on your receipt.",
        `The authorities then have ${hours} hours to act on it: acknowledge it, start working on it, or resolve it.`,
        "To see what happens when they do nothing, press “Demo: skip to the deadline” on your receipt instead of waiting.",
      ],
      youSee:
        "If the authorities take it up in time, the case stays with them and nothing more is sent. If they do not, a status agent escalates it: news outlets receive the anonymised summary by email, so a complaint cannot be quietly ignored.",
      cta: { href: "/authorities", label: "See it on the dashboard" },
    },
  ];

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <article className="mx-auto w-full max-w-3xl space-y-16 px-5 py-12 sm:px-8 sm:py-16">
        <header>
          <p className="label !text-danger-ink">For judges</p>
          <h1 className="mt-3 text-display font-semibold sm:text-hero">Follow one case from first tap to the authorities.</h1>
          <p className="mt-4 text-lead text-ink-2">
            Five steps, about seven minutes. You sign in as a survivor, receive her emergency alert on your own phone, file a report, then follow it to the
            authorities. Everything is live: real messages, real calls, real emails.
          </p>

          <div className="mt-8 rounded-lg border-2 border-ink bg-surface p-5 sm:p-6">
            <p className="flex items-center gap-2 text-lead font-semibold">
              <KeyRound size={ICON} strokeWidth={STROKE} aria-hidden /> Two test accounts are in the submission PDF
            </p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="border-l-4 border-danger pl-4">
                <dt className="font-semibold">Survivor account</dt>
                <dd className="mt-1 text-small text-ink-2">For the app itself: alerts, reports and her saved trusted contact. Sign in from the top right.</dd>
              </div>
              <div className="border-l-4 border-ink pl-4">
                <dt className="font-semibold">Officer account</dt>
                <dd className="mt-1 text-small text-ink-2">For the authorities dashboard, where complaints arrive and their status is set.</dd>
              </div>
            </dl>
          </div>

          <dl className="mt-8 grid gap-3 sm:grid-cols-2">
            <Setting label="AI agents" value={health?.llm_configured ? `Connected · ${health.model_default}` : "Checking…"} ok={!!health?.llm_configured} />
            <Setting
              label="Default emergency contact"
              value={demo?.default_contact ? `${demo.default_contact}, the team's demo phone` : "Not set"}
              ok={!!demo?.default_contact}
            />
            <Setting label="Default Discord channel" value={demo?.default_discord ? "Set: the team's demo channel" : "Not set"} ok={!!demo?.default_discord} />
            <Setting
              label="Calls and SMS"
              value={demo ? (demo.call_provider === "macrodroid" ? "MacroDroid on an Android phone" : "Twilio") : "Checking…"}
              ok={!!demo}
            />
          </dl>
        </header>

        <section aria-labelledby="tour">
          <h2 id="tour" className="text-title font-semibold">
            The tour
          </h2>
          <p className="mt-2 text-body text-ink-2">Do the steps in order: each one uses what the step before it set up.</p>
          <ol className="mt-6 space-y-5">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={s.title} className="overflow-hidden rounded-lg border border-line bg-surface">
                  <div className="flex items-start gap-4 p-5 sm:p-6">
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${s.danger ? "bg-danger text-on-fill" : "bg-ink text-paper"}`}
                      aria-hidden
                    >
                      <Icon size={ICON} strokeWidth={STROKE} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-3 text-caption text-muted">
                        <span className="tabular font-mono font-semibold">Step {i + 1}</span>
                        <span>{s.time}</span>
                      </p>
                      <h3 className="mt-1 text-lead font-semibold">{s.title}</h3>
                      <ol className="mt-3 space-y-1.5 text-body">
                        {s.doThis.map((d, j) => (
                          <li key={j} className="flex gap-2.5">
                            <span className="tabular w-4 shrink-0 font-mono text-small text-muted">{j + 1}</span>
                            <span>{d}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                  <div className="flex flex-col gap-4 border-t border-line bg-sunken px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <p className="text-small text-ink-2">
                      <span className="font-semibold text-ink">What happens: </span>
                      {s.youSee}
                    </p>
                    <Link href={s.cta.href} className={`btn shrink-0 ${s.danger ? "btn-danger" : "btn-primary"}`}>
                      {s.cta.label} <ArrowRight size={18} strokeWidth={STROKE} aria-hidden />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <section aria-labelledby="noaccount" className="flex gap-4 rounded-lg border border-line bg-danger-soft p-5 sm:p-6">
          <Siren size={ICON} strokeWidth={STROKE} className="mt-1 shrink-0 text-danger-ink" aria-hidden />
          <div>
            <h2 id="noaccount" className="text-lead font-semibold">
              Also try it signed out
            </h2>
            <p className="mt-1 text-body text-ink-2">
              Help is never behind a login. Sign out, press “I am in danger” on the welcome screen, and the alert still goes out within seconds, to the
              team&apos;s demo contact{demo?.default_contact ? ` (${demo.default_contact} and the demo Discord channel)` : ""}, because a signed-out visitor has
              no saved contact yet.
            </p>
          </div>
        </section>

        <section aria-labelledby="poc">
          <p className="label">Proof of concept</p>
          <h2 id="poc" className="mt-2 text-title font-semibold">
            What we planned, and what this demo uses
          </h2>
          <p className="mt-2 text-body text-ink-2">
            Awaaz was designed around WhatsApp and paid SMS and voice. For a free, working proof of concept we used channels that cost nothing. Each one is a
            setting, not a rewrite: the agents, safety checks and workflow stay the same.
          </p>
          <ul className="mt-6 space-y-4">
            {SWAPS.map((s) => {
              const Icon = s.icon;
              return (
                <li key={s.intended} className="rounded-lg border border-line bg-surface p-5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Icon size={ICON} strokeWidth={STROKE} className="shrink-0 text-ink-2" aria-hidden />
                    <span className="text-body text-ink-2">
                      <span className="label mr-1.5">Planned</span>
                      {s.intended}
                    </span>
                    <ArrowRight size={16} strokeWidth={STROKE} className="text-muted" aria-hidden />
                    <span className="text-body font-semibold">
                      <span className="label mr-1.5 !text-safe-ink">In this demo</span>
                      {s.demo}
                    </span>
                  </div>
                  <p className="mt-2 text-small text-ink-2">{s.why}</p>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="notes" className="rounded-lg border border-line bg-surface p-5 sm:p-6">
          <h2 id="notes" className="flex items-center gap-2 text-lead font-semibold">
            <Bot size={ICON} strokeWidth={STROKE} aria-hidden /> Good to know
          </h2>
          <ul className="mt-3 space-y-2 text-body text-ink-2">
            <li>The emergency button never asks for a login. Without an account, the team&apos;s demo contact is alerted so the button always works.</li>
            <li>“Exit” at the top right leaves the site at once and clears the session, for when someone looks over her shoulder.</li>
            <li>If an AI agent fails, a fixed fallback does the same job, so help is never held back.</li>
            <li>
              The full design, the privacy checks and the sources for the problem figures are on{" "}
              <Link href="/about" className="font-semibold text-ink underline underline-offset-4">
                How it works
              </Link>
              .
            </li>
          </ul>
        </section>
      </article>
    </div>
  );
}
