'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_BASE_URL } from '@/lib/auth-context';

interface EventRecord {
  id: string;
  title: string;
  event_date: string;
  location: string;
}

function BookForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = searchParams.get('eventId') || '';

  const [event, setEvent] = useState<EventRecord | null>(null);
  const [form, setForm] = useState({ attendeeName: '', attendeeEmail: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!API_BASE_URL || !eventId) return;
    fetch(`${API_BASE_URL}/events`)
      .then((res) => res.json())
      .then((data: EventRecord[]) => {
        const found = data.find((e) => e.id === eventId);
        if (found) setEvent(found);
      })
      .catch(() => {});
  }, [eventId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!API_BASE_URL) {
      setError('NEXT_PUBLIC_API_BASE_URL is not set — see .env.local');
      return;
    }
    if (!eventId) {
      setError('No event selected — head back and pick one from the events page.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, ...form }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Try again.');
        return;
      }
      router.push(`/payment?bookingId=${data.id}`);
    } catch (err) {
      setError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="shellNarrow">
      <form className="card" onSubmit={handleSubmit}>
        <h1 className="formTitle">Book your spot</h1>
        <p className="formSub">A couple of details and you&apos;re in.</p>

        {event && (
          <div className="summaryBox">
            <p className="summaryLabel">Booking for</p>
            <p className="summaryValue">{event.title}</p>
          </div>
        )}

        {error && <div className="alert alertError">{error}</div>}

        <div className="field">
          <label htmlFor="attendeeName">Your name</label>
          <input
            id="attendeeName"
            required
            value={form.attendeeName}
            onChange={(e) => setForm({ ...form, attendeeName: e.target.value })}
            placeholder="Jane Doe"
          />
        </div>

        <div className="field">
          <label htmlFor="attendeeEmail">Email</label>
          <input
            id="attendeeEmail"
            type="email"
            required
            value={form.attendeeEmail}
            onChange={(e) => setForm({ ...form, attendeeEmail: e.target.value })}
            placeholder="jane.doe@example.com"
          />
        </div>

        <button className="btn btnPrimary btnFull" type="submit" disabled={loading}>
          {loading ? 'Booking…' : 'Confirm booking'}
        </button>
      </form>
    </div>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={<div className="shellNarrow" />}>
      <BookForm />
    </Suspense>
  );
}
