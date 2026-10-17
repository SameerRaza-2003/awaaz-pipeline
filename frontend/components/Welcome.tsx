"use client";

import Link from "next/link";
import { EmergencyNumbers } from "@/components/chat/parts";
import { JaaliWindow } from "@/components/Jaali";

/**
 * First screen. An account is optional, and help is never behind a login:
 * the emergency button skips straight to alerting the trusted contact.
 */
export function Welcome({ onContinue, onEmergency }: { onContinue: () => void; onEmergency: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:items-center lg:justify-center lg:gap-20 lg:px-12">
      <div className="flex flex-1 flex-col lg:max-w-xl lg:flex-none">
        <div className="flex flex-1 flex-col justify-center px-5 pb-6 pt-8 sm:px-8 lg:flex-none lg:px-0 lg:pt-0">
          <JaaliWindow className="mb-6 w-20 lg:hidden" />
          <p className="label">Awaaz</p>
          <h1 className="mt-3 text-display font-semibold sm:text-hero">Help when you need it. A report when you are ready.</h1>
          <p className="mt-4 text-lead text-ink-2">
            Awaaz alerts someone you trust with your location in one tap, or helps you report harassment to the police without exposing who you are.
          </p>
        </div>

        <div className="border-t border-line bg-surface lg:border-0 lg:bg-transparent">
          <div className="w-full space-y-4 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-8 lg:px-0 lg:pt-8">
            <div>
              <button className="btn btn-danger w-full !min-h-16 text-lead" onClick={onEmergency}>
                I am in danger: get help now
              </button>
              <p className="mt-2 text-small text-ink-2">No login needed. You get three seconds to cancel before your contact is alerted.</p>
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

      <figure className="hidden shrink-0 lg:block">
        <JaaliWindow className="w-72" />
        <figcaption className="mt-4 max-w-72 text-small text-muted">
          A jaali screen lets light and air in while keeping the people inside private. Awaaz works the same way.
        </figcaption>
      </figure>
    </div>
  );
}
