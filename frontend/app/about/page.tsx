"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const AGENTS = [
  ["Location Agent", "Reads the coordinates your browser shares, looks up the address and builds a Google Maps link."],
  ["Twilio Agent", "Writes a short alert, texts it to your trusted contact and calls them. If it fails, a fixed template sends the same alert."],
  ["Intake Agent", "Listens and asks one gentle question at a time, in Urdu, Roman Urdu or English. Every question can be skipped."],
  ["Drafting Agent", "Writes a full police version and an anonymised public version, and rewrites the public one until a privacy scanner passes it."],
  ["Matching Agent", "Compares the anonymised case with activist communities and picks only those above a similarity threshold."],
  ["Gmail Agent", "Emails the anonymised description, one recipient per email: first to matched communities, later to news outlets if needed."],
  ["Police Dispatch Agent", "Submits the full complaint to the police dashboard and starts a 24-hour timer."],
  ["Police Status Agent", "After 24 hours, checks whether the police acted. If not, it starts the news escalation."],
];

function Diagram() {
  const box = "rounded-xl border-2 px-3 py-2 text-center text-sm font-semibold bg-surface";
  return (
    <div className="card overflow-x-auto p-4">
      <div className="mx-auto grid min-w-[560px] max-w-3xl grid-cols-2 gap-x-8 gap-y-3">
        <div className={`${box} col-span-2 mx-auto w-64 border-accent`}>“Are you in danger right now?”</div>
        <div className="text-center text-sm font-semibold text-danger">Yes ↓</div>
        <div className="text-center text-sm font-semibold text-accent">No → report ↓</div>
        <div className={`${box} border-danger`}>Location Agent → Twilio Agent</div>
        <div className={`${box} border-run`}>Intake Agent → Drafting Agent</div>
        <div className="text-center text-xs text-muted">SMS + call to your trusted contact, live location updates</div>
        <div className={`${box} border-warn`}>You review both drafts and press Send</div>
        <div />
        <div className="grid grid-cols-2 gap-2">
          <div className={`${box} border-line text-xs`}>Police Dispatch → police dashboard</div>
          <div className={`${box} border-line text-xs`}>Matching → Gmail → communities</div>
        </div>
        <div />
        <div className={`${box} border-line text-xs`}>24 h later: Police Status Agent → if no action, Gmail → news outlets</div>
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
    <article className="mx-auto w-full max-w-3xl space-y-8 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">About Awaaz</h1>
        <p className="text-lg text-ink-2">
          Awaaz (“voice”) helps survivors of harassment get help fast, and report safely, on their own terms.
        </p>
        <p className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
          Awaaz is not a substitute for emergency services. If you are in immediate danger, call <strong>15</strong> (Police) or{" "}
          <strong>1122</strong> (Rescue) in Pakistan.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">How it works</h2>
        <Diagram />
        <p className="text-sm text-ink-2">
          Each step is an AI agent with a small set of tools. The order of steps, who receives anything, and every safety check are fixed in
          code, never left to the AI. The live workflow panel on the home page shows every agent and tool call as it happens.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">The agents</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {AGENTS.map(([n, d]) => (
            <li key={n} className="card p-3">
              <div className="font-semibold">{n}</div>
              <div className="text-sm text-ink-2">{d}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card p-3">
          <h3 className="font-semibold">🔒 Private</h3>
          <p className="text-sm text-ink-2">
            Your name, contact, address, the accused&apos;s name and the full account go only to the police dashboard, stored encrypted. The
            chat transcript is deleted after you press Send.
          </p>
        </div>
        <div className="card p-3">
          <h3 className="font-semibold">👮 What the police see</h3>
          <p className="text-sm text-ink-2">The full, unfiltered complaint you approved, your contact details, and a 24-hour countdown.</p>
        </div>
        <div className="card p-3">
          <h3 className="font-semibold">🌐 What the public sees</h3>
          <p className="text-sm text-ink-2">
            Communities, and later news outlets, get only the anonymised description and a random reference. If the privacy check cannot
            confirm it is clean, nothing is published.
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Who receives public reports</h2>
        <p className="text-xs text-muted">The demo uses fictional organisations with test addresses.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card p-3">
            <h3 className="font-semibold">Activist communities</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {communities.map((c) => (
                <li key={c.name}>
                  {c.name} <span className="text-muted">({c.countries})</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-3">
            <h3 className="font-semibold">News outlets</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {news.map((c) => (
                <li key={c.name}>
                  {c.name} <span className="text-muted">({c.country})</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Limits</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>Awaaz cannot guarantee that the police or anyone else will act.</li>
          <li>Location depends on your phone sharing it; indoors it may be inaccurate.</li>
          <li>The privacy check is strict but automated: please read the public version before sending.</li>
          <li>SMS and calls depend on the mobile network and the Twilio account in use.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Emergency numbers (Pakistan)</h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li className="card p-3"><strong>15</strong> Police emergency</li>
          <li className="card p-3"><strong>1122</strong> Rescue</li>
          <li className="card p-3"><strong>1099</strong> Ministry of Human Rights helpline</li>
          <li className="card p-3"><strong>1098</strong> Madadgaar helpline (women and children)</li>
          <li className="card p-3"><strong>1043</strong> Punjab Women Helpline</li>
        </ul>
      </section>
    </article>
  );
}
