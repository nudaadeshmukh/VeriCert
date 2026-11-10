// Layout shared by the sign-in pages (DESIGN.md: dark canvas, brand dot + wordmark, mono eyebrow above the heading).
import Link from 'next/link';

export default function AuthShell({ eyebrow, title, intro, children, footer }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-[480px] flex-col px-6 py-12">
      <Link href="/" className="flex items-center gap-2 self-start rounded-app-sm">
        <span aria-hidden="true" className="size-3 rounded-full bg-brand" />
        <span className="text-button-lg font-medium text-on-primary">VeriCert</span>
      </Link>
      <div className="mt-16">
        <p className="font-mono text-mono-eyebrow text-mute">{eyebrow}</p>
        <h1 className="mt-4 text-display-sm font-normal text-on-primary">{title}</h1>
        {intro ? <p className="mt-4 text-body text-ash">{intro}</p> : null}
      </div>
      <div className="mt-10">{children}</div>
      {footer ? <div className="mt-10 text-body-sm text-ash">{footer}</div> : null}
    </main>
  );
}

/** A text link in the design's link colour for dark surfaces. */
export function AuthLink({ href, children }) {
  return (
    <Link
      href={href}
      className="rounded-app-xs text-link-blue-soft underline underline-offset-4 hover:text-on-primary"
    >
      {children}
    </Link>
  );
}
