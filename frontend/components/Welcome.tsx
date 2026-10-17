"use client";

import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { EmergencyNumbers } from "@/components/chat/parts";

/**
 * First screen. An account is optional, and help is never behind a login:
 * the emergency button skips straight to alerting the trusted contact.
 * The illustration sits beside the text on wide screens and above it on smaller ones.
 */
export function Welcome({ onContinue, onEmergency }: { onContinue: () => void; onEmergency: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:overflow-y-auto">
      <div className="relative flex flex-[1_0_auto] flex-col overflow-hidden">
        {/* Soft shapes give the band depth without competing with the text. */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-sunken" aria-hidden />
        <div className="pointer-events-none absolute -bottom-48 left-[2%] hidden h-[34rem] w-[34rem] rounded-full bg-sunken xl:block" aria-hidden />
        <Image
          src="/solidarity.svg"
          alt=""
          width={732}
          height={581}
          unoptimized
          priority
          className="pointer-events-none absolute bottom-0 left-[3%] hidden w-[min(calc(50vw-340px),420px)] xl:block"
        />

        <div className="relative mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 pb-6 pt-8 sm:px-8 lg:pt-10">
          <Link
            href="/guide"
            className="mb-8 flex items-center justify-between gap-3 rounded-md border border-line-strong bg-surface px-4 py-3 text-small hover:border-ink"
          >
            <span>
              <span className="font-semibold">Judging Awaaz?</span>{" "}
              <span className="text-ink-2">Start with the judges&apos; guide: test accounts and a step-by-step tour.</span>
            </span>
            <ArrowRight size={18} strokeWidth={1.75} className="shrink-0" aria-hidden />
          </Link>
          <Image
            src="/solidarity.svg"
            alt=""
            width={732}
            height={581}
            unoptimized
            priority
            className="mb-6 h-36 w-auto self-center sm:h-44 xl:hidden"
          />
          <p className="label">Awaaz</p>
          <h1 className="mt-3 text-display font-semibold sm:text-hero">Help when you need it. A report when you are ready.</h1>
          <p className="mt-4 text-lead text-ink-2">
            Awaaz alerts someone you trust with your location in one tap, or helps you report harassment to the authorities without exposing who you are.
          </p>
        </div>
      </div>

      <div className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-xl space-y-4 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-8">
          <div>
            <button className="btn btn-danger w-full !min-h-16 text-lead" onClick={onEmergency}>
              I am in danger: get help now
            </button>
            <p className="mt-2 text-small text-ink-2">No login needed. You get three seconds to cancel. Without an account, the demo contact is alerted.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/account?next=/" className="btn btn-primary">
              Sign in
            </Link>
            <Link href="/account?mode=register&next=/" className="btn btn-secondary">
              Create account
            </Link>
          </div>
          <button className="btn btn-quiet w-full" onClick={onContinue}>
            Continue without an account
          </button>
          <EmergencyNumbers />
        </div>
      </div>
    </div>
  );
}
