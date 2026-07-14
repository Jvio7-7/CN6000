'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_BASE_URL } from '@/lib/auth-context';

// groups digits into 4s as you type: "4242424242424242" -> "4242 4242 4242 4242"
function formatCardNumber(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 16);
  return digits.match(/.{1,4}/g)?.join(' ') || digits;
}

function formatExpiry(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function PaymentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookingId = searchParams.get('bookingId') || '';
  const amount = searchParams.get('amount') || '0';

  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!API_BASE_URL) {
      setError('NEXT_PUBLIC_API_BASE_URL is not set - see .env.local');
      return;
    }
    if (!bookingId) {
      setError('No booking found - head back and book a spot first.');
      return;
    }
    if (!/^\d{2}\/\d{2}$/.test(expiry)) {
      setError('Expiry should be in MM/YY format.');
      return;
    }
    const [mm, yy] = expiry.split('/').map(Number);
    if (mm < 1 || mm > 12) {
      setError('That expiry month doesn\u2019t look right.');
      return;
    }
    const expiryDate = new Date(2000 + yy, mm, 0);
    if (expiryDate < new Date()) {
      setError('That card has expired.');
      return;
    }
    if (!/^\d{3,4}$/.test(cvv)) {
      setError('Security code should be 3 or 4 digits.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          amount: Number(amount),
          cardNumber: cardNumber.replace(/\s/g, ''),
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
      setError('Network error - check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="shellNarrow">
      <form className="card" onSubmit={handleSubmit}>
        <h1 className="formTitle">Complete your booking</h1>
        <p className="formSub">
          This is a demo checkout - no real card is ever charged.
        </p>

        <div className="summaryBox">
          <p className="summaryLabel">Amount due</p>
          <p className="summaryValue">${Number(amount).toFixed(2)}</p>
        </div>

        {error && <div className="alert alertError">{error}</div>}
        {success && (
          <div className="alert alertSuccess">
            Payment received - taking you to your account...
          </div>
        )}

        <div className="field">
          <label htmlFor="cardNumber">Card number</label>
          <input
            id="cardNumber"
            required
            inputMode="numeric"
            value={cardNumber}
            onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
            placeholder="4242 4242 4242 4242"
          />
          <span className="fieldHint">Any number works - one ending in 0000 will be declined, for testing.</span>
        </div>

        <div className="paymentRow" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field">
            <label htmlFor="expiry">Expiry</label>
            <input
              id="expiry"
              required
              inputMode="numeric"
              value={expiry}
              onChange={(e) => setExpiry(formatExpiry(e.target.value))}
              placeholder="MM/YY"
              maxLength={5}
            />
          </div>

          <div className="field">
            <label htmlFor="cvv">Security code</label>
            <input
              id="cvv"
              required
              inputMode="numeric"
              value={cvv}
              onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="123"
              maxLength={4}
            />
          </div>
        </div>

        <button className="btn btnPrimary btnFull" type="submit" disabled={loading}>
          {loading ? 'Processing...' : `Pay $${Number(amount).toFixed(2)}`}
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
