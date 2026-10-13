'use client';
import { Button, Input } from '@repo/ui';
import { ArrowRight, Check } from 'lucide-react';
import { useState } from 'react';
export function Signup() {
  const [status, setStatus] = useState<'idle' | 'saving' | 'done'>('idle');
  const [error, setError] = useState('');
  return status === 'done' ? (
    <p role="status" className="flex items-center gap-2 text-sm">
      <Check className="size-4" />
      You’re on the list. See you at launch.
    </p>
  ) : (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setStatus('saving');
        setError('');
        const data = new FormData(e.currentTarget);
        try {
          const r = await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: data.get('email'), website: data.get('website') }),
          });
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);
          setStatus('done');
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Please try again.');
          setStatus('idle');
        }
      }}
    >
      <label htmlFor="email" className="mb-3 block text-sm font-medium">
        Let me know when it’s ready
      </label>
      <div className="flex gap-2">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Your email address"
          required
          maxLength={254}
        />
        <Button type="submit" disabled={status === 'saving'} aria-label="Notify me at launch">
          {status === 'saving' ? '…' : <ArrowRight className="size-4" />}
        </Button>
      </div>
      <div className="hidden" aria-hidden="true">
        <input name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        One email when the new experience is live. That’s it.
      </p>
      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
