'use client';

import { useState } from 'react';
import Link from 'next/link';
import { API_BASE_URL } from '@/lib/auth-context';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!API_BASE_URL) {
      setError('NEXT_PUBLIC_API_BASE_URL is not set — see .env.local');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Something went wrong. Try again.');
        return;
      }
      setSent(true);
    } catch (err) {
      setError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="shellNarrow">
      <div className="card">
        <h1 className="formTitle">Reset your password</h1>
        <p className="formSub">
          Enter the email on your account and we&apos;ll send a reset code.
        </p>

        {error && <div className="alert alertError">{error}</div>}

        {sent ? (
          <>
            <div className="alert alertSuccess">
              If an account exists for that email, a reset code has been sent.
            </div>
            <p className="formFooter" style={{ marginTop: 4 }}>
              Have a code? <Link href="/reset-password">Enter it here</Link>
            </p>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane.doe@example.com"
              />
            </div>

            <button className="btn btnPrimary btnFull" type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset code'}
            </button>
          </form>
        )}

        <p className="formFooter">
          Remembered it? <Link href="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
