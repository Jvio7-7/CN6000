'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_BASE_URL, useAuth } from '@/lib/auth-context';

interface EventRecord {
  id: string;
  title: string;
  event_date: string;
  location: string;
  capacity: number;
  price: number;
  booking_count: number;
}

function BookForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = searchParams.get('eventId') || '';
  const { user, token, loading: authLoading } = useAuth();

  const [event, setEvent] = useState<EventRecord | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

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
    if (!token || !user) {
      setError('You need to be logged in to book a spot.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          eventId,
          attendeeName: user.name,
          attendeeEmail: user.email,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Try again.');
        return;
      }
      // free events skip the payment step entirely - nothing to charge
      if (event && Number(event.price) > 0) {
        router.push(`/payment?bookingId=${data.id}&amount=${event.price}`);
      } else {
        router.push('/account');
      }
    } catch (err) {
      setError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  if (authLoading || !user) {
    return <div className="shellNarrow" />;
  }

  const full = event ? Number(event.booking_count) >= event.capacity : false;

  return (
    <div className="shellNarrow">
      <form className="card" onSubmit={handleSubmit}>
        <h1 className="formTitle">Book your spot</h1>
        <p className="formSub">A couple of details and you&apos;re in.</p>

        {event && (
          <div className="summaryBox">
            <p className="summaryLabel">Booking for</p>
            <p className="summaryValue">{event.title}</p>
            <p className="fieldHint" style={{ marginTop: 6 }}>
              {event.booking_count} / {event.capacity} spots taken &middot;{' '}
              {Number(event.price) > 0 ? `$${Number(event.price).toFixed(2)}` : 'Free'}
            </p>
          </div>
        )}

        {error && <div className="alert alertError">{error}</div>}
        {full && <div className="alert alertError">This event is full.</div>}

        {/* name/email come from the logged-in account and aren't
            editable here on purpose - a booking should always reflect
            who actually made it */}
        <div className="field">
          <label>Your name</label>
          <div className="summaryBox" style={{ marginBottom: 0 }}>
            {user.name}
          </div>
        </div>

        <div className="field">
          <label>Email</label>
          <div className="summaryBox" style={{ marginBottom: 0 }}>
            {user.email}
          </div>
        </div>

        <button className="btn btnPrimary btnFull" type="submit" disabled={loading || full} style={{ marginTop: 18 }}>
          {loading ? 'Booking…' : full ? 'Event full' : 'Confirm booking'}
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
