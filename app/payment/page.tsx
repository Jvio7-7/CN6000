'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_BASE_URL } from '@/lib/auth-context';

function PaymentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookingId = searchParams.get('bookingId') || '';

  const [form, setForm] = useState({ amount: '', cardNumber: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!API_BASE_URL) {
      setError('NEXT_PUBLIC_API_BASE_URL is not set — see .env.local');
      return;
    }
    if (!bookingId) {
      setError('No booking found — head back and book a spot first.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          amount: Number(form.amount),
          cardNumber: form.cardNumber,
        }),
      });
      const data = await res.json();
      if (res.status === 402) {
        setError('Your card was declined. Try a different card.');
        return;
      }
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Try again.');
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push('/account'), 1600);
    } catch (err) {
      setError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="shellNarrow">
      <form className="card" onSubmit={handleSubmit}>
        <h1 className="formTitle">Complete your booking</h1>
        <p className="formSub">
          This is a demo checkout — no real card is ever charged.
        </p>

        {error && <div className="alert alertError">{error}</div>}
        {success && (
          <div className="alert alertSuccess">
            Payment received — taking you to your account…
          </div>
        )}

        <div className="field">
          <label htmlFor="amount">Amount (USD)</label>
          <input
            id="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="25.00"
          />
        </div>

        <div className="field">
          <label htmlFor="cardNumber">Card number</label>
          <input
            id="cardNumber"
            required
            value={form.cardNumber}
            onChange={(e) => setForm({ ...form, cardNumber: e.target.value })}
            placeholder="4242 4242 4242 4242"
          />
          <span className="fieldHint">Any number works — one ending in 0000 will be declined, for testing.</span>
        </div>

        <button className="btn btnPrimary btnFull" type="submit" disabled={loading}>
          {loading ? 'Processing…' : 'Pay'}
        </button>
      </form>
    </div>
  );
}

export default function PaymentPage() {
  return (
    <Suspense fallback={<div className="shellNarrow" />}>
      <PaymentForm />
    </Suspense>
  );
}
