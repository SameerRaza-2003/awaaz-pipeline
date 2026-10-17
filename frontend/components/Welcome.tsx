"use client";

import { ArrowRight, LogIn, ShieldAlert, ShieldCheck, UserPlus } from "lucide-react";
import Link from "next/link";

/**
 * First screen. An account is optional, and help is never behind a login:
 * the emergency button skips straight to alerting the trusted contact.
 */
export function Welcome({ onContinue, onEmergency }: { onContinue: () => void; onEmergency: () => void }) {
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome to Awaaz</h1>
          <p className="text-ink-2">Get help fast, or report harassment safely. Private, and on your terms.</p>
        </div>

        <button className="btn btn-danger w-full !min-h-16 text-lg" onClick={onEmergency}>
          <ShieldAlert size={22} aria-hidden />
          I&apos;m in danger: get help now
        </button>
        <p className="-mt-3 text-center text-xs text-muted">No login needed. Your trusted contact is alerted with your location.</p>

        <div className="card space-y-3 p-5">
          <div className="grid grid-cols-2 gap-2">
            <Link href="/account?next=/" className="btn btn-primary">
              <LogIn size={16} aria-hidden /> Sign in
            </Link>
            <Link href="/account?mode=register&next=/" className="btn btn-ghost">
              <UserPlus size={16} aria-hidden /> Create account
            </Link>
          </div>
          <p className="text-xs text-muted">
            An account saves your trusted contact, so help is one tap away. Just a username and password: no email or real name.
          </p>
          <button className="btn btn-quiet w-full" onClick={onContinue}>
            Continue without an account <ArrowRight size={16} aria-hidden />
          </button>
        </div>

        <p className="flex items-start justify-center gap-2 text-center text-xs text-muted">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
          Quick exit (top right) leaves this site instantly and signs you out.
        </p>
      </div>
    </div>
  );
}
