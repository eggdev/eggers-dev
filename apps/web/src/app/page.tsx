import { Signup } from '@web/components/signup';
import { ArrowUpRight } from 'lucide-react';
export default function Page() {
  return (
    <main className="flex min-h-dvh flex-col px-6 md:px-12">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between py-8">
        <span className="text-sm font-medium">Brendan Eggers</span>
        <a
          href="mailto:brendan@eggers.dev"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Get in touch <ArrowUpRight className="size-4" />
        </a>
      </header>
      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-20">
        <div className="construction mb-10" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} style={{ animationDelay: `${i * 160}ms` }} />
          ))}
        </div>
        <p className="mb-4 text-sm text-muted-foreground">A work in progress</p>
        <h1 className="text-4xl font-semibold leading-[1.15] tracking-tight sm:text-5xl">
          Making room for
          <br />
          what comes next.
        </h1>
        <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">
          I’m rebuilding this space to share my work, ideas, and a little more of the story behind
          them.
        </p>
        <div className="mt-12 max-w-sm">
          <Signup />
        </div>
      </section>
      <footer className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-3 border-t py-6 text-xs text-muted-foreground">
        <span>Brendan Eggers · New York</span>
        <a href="mailto:brendan@eggers.dev" className="hover:text-foreground">
          brendan@eggers.dev
        </a>
      </footer>
    </main>
  );
}
