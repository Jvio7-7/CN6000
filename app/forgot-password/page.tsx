'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_BASE_URL } from '@/lib/auth-context';
import { validatePasswordClient, PASSWORD_HINT } from '@/lib/validation';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLookup(e: React.FormEvent) {
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
      const data = await res.json();
      if (!res.ok) {
        // deliberately explicit if the account doesn't exist
        setError(data.error || 'Something went wrong. Try again.');
        return;
      }
      setQuestion(data.question);
      setStep('reset');
    } catch (err) {
      setError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const passwordError = validatePasswordClient(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords don\u2019t match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, answer, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'That answer doesn\u2019t match.');
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push('/login'), 1800);
    } catch (err) {
      setError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'reset') {
    return (
      <div className="shellNarrow">
        <form className="card" onSubmit={handleResetPassword}>
          <h1 className="formTitle">Answer your security question</h1>
          <p className="formSub">Then set a new password.</p>

          {error && <div className="alert alertError">{error}</div>}
          {success && (
            <div className="alert alertSuccess">Password updated. Redirecting you to log in…</div>
          )}

          <div className="summaryBox">
            <p className="summaryLabel">Your question</p>
            <p className="summaryValue">{question}</p>
          </div>

          <div className="field">
            <label htmlFor="answer">Answer</label>
            <input
              id="answer"
              required
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Your answer"
            />
          </div>

          <div className="field">
            <label htmlFor="newPassword">New password</label>
            <input
              id="newPassword"
              type="password"
              required
              minLength={12}
              maxLength={24}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 12 characters"
            />
            <span className="fieldHint">{PASSWORD_HINT}</span>
          </div>

          <div className="field">
            <label htmlFor="confirmPassword">Confirm new password</label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={12}
              maxLength={24}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <button className="btn btnPrimary btnFull" type="submit" disabled={loading}>
            {loading ? 'Updating…' : 'Update password'}
          </button>

          <p className="formFooter">
            <Link href="/login">Back to log in</Link>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="shellNarrow">
      <form className="card" onSubmit={handleLookup}>
        <h1 className="formTitle">Reset your password</h1>
        <p className="formSub">
          Enter the email on your account and we&apos;ll show your security question.
        </p>

        {error && <div className="alert alertError">{error}</div>}

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
          {loading ? 'Looking up…' : 'Continue'}
        </button>

        <p className="formFooter">
          Remembered it? <Link href="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
