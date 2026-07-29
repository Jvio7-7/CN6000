'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_BASE_URL } from '@/lib/auth-context';

const BULLET = '\u2022';

// Amex (starts 34/37) is 15 digits with a 4-digit code; others are 16/3
function isAmex(digits: string) {
  return /^3[47]/.test(digits);
}
function cardMaxLen(digits: string) {
  return isAmex(digits) ? 15 : 16;
}
function cvcLen(digits: string) {
  return isAmex(digits) ? 4 : 3;
}

// mask the middle 8 digits (positions 5-12), grouped in 4s
function maskCardDisplay(digits: string) {
  const shown = digits
    .split('')
    .map((d, i) => (i >= 4 && i < 12 ? BULLET : d))
    .join('');
  return shown.match(/.{1,4}/g)?.join(' ') || shown;
}

// rebuild the real digits: keep visible digits, and where a bullet sits pull
// the original digit back from the previous value by position
function unmaskCard(shown: string, prev: string) {
  const chars = shown.replace(/ /g, '').split('');
  let real = '';
  for (const c of chars) {
    if (real.length >= 16) break;
    if (c === BULLET) real += prev[real.length] ?? '';
    else if (/\d/.test(c)) real += c;
  }
  // cap to this card's length (15 for Amex, else 16)
  return real.slice(0, cardMaxLen(real));
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
    if (cardNumber.length < cardMaxLen(cardNumber)) {
      setError(isAmex(cardNumber) ? 'An Amex card number is 15 digits.' : 'A card number is 16 digits.');
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
    const wantCvc = cvcLen(cardNumber);
    if (cvv.length !== wantCvc) {
      setError(`Security code should be ${wantCvc} digits.`);
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
            autoComplete="off"
            value={maskCardDisplay(cardNumber)}
            onChange={(e) => {
              const next = unmaskCard(e.target.value, cardNumber);
              setCardNumber(next);
              setCvv((c) => c.slice(0, cvcLen(next)));
            }}
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
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={cvv}
              onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, cvcLen(cardNumber)))}
              placeholder={BULLET.repeat(cvcLen(cardNumber))}
              maxLength={cvcLen(cardNumber)}
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
