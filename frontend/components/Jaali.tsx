import { useId } from "react";

/**
 * A jaali window: the carved lattice screen of Mughal and South Asian architecture, framed in a pointed arch.
 * A jaali lets light and air in while keeping the people inside private, which is what Awaaz tries to do.
 * Drawn in the line colours, so it follows light and dark mode and never competes with text. Decorative only.
 */
export function JaaliWindow({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const arch = "M6 274V112C6 58 58 22 100 6c42 16 94 52 94 106v162z";
  const inner = "M18 262V114C18 66 64 34 100 20c36 14 82 46 82 94v148z";
  return (
    <svg className={className} viewBox="0 0 200 280" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={`jaali-${id}`} width="33" height="33" patternUnits="userSpaceOnUse" x="1" y="4">
          <g fill="none" stroke="var(--line-strong)" strokeWidth="0.9" strokeLinejoin="round">
            {/* eight-pointed star: a square and a diamond */}
            <path d="M8.25 8.25h16.5v16.5H8.25z" />
            <path d="M16.5 4.1 28.9 16.5 16.5 28.9 4.1 16.5z" />
            {/* links to the neighbouring stars */}
            <path d="M16.5 0v4.1M16.5 28.9V33M0 16.5h4.1M28.9 16.5H33" />
            <path d="M0 0l8.25 8.25M33 0l-8.25 8.25M0 33l8.25-8.25M33 33l-8.25-8.25" />
            <circle cx="16.5" cy="16.5" r="2.6" />
          </g>
        </pattern>
        <clipPath id={`arch-${id}`}>
          <path d={inner} />
        </clipPath>
      </defs>
      <path d={arch} fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="1.5" />
      <rect width="200" height="280" fill={`url(#jaali-${id})`} clipPath={`url(#arch-${id})`} />
      <path d={inner} fill="none" stroke="var(--line-strong)" strokeWidth="1" />
    </svg>
  );
}
