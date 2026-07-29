'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, useAuth } from '@/lib/auth-context';

function todayDateString() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function NewEventPage() {
  const router = useRouter();
  const { user, token, loading: authLoading } = useAuth();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [minDate] = useState(todayDateString);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  // if the date is today, set the time input's min to now (also re-checked
  // on submit since browsers don't enforce min on time inputs)
  const minTime = useMemo(() => {
    if (date !== minDate) return undefined;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }, [date, minDate]);

  // if switching back to today makes the previously-picked time earlier than
  // now, clear it rather than silently submit a stale value
  useEffect(() => {
    if (time && minTime && time < minTime) {
      setTime('');
    }
  }, [minTime, time]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!API_BASE_URL) {
      setError('NEXT_PUBLIC_API_BASE_URL is not set - see .env.local');
      return;
    }
    if (!token) {
      setError('You need to be logged in to host an event.');
      return;
    }
    if (!date || !time) {
      setError('Pick a date and time.');
      return;
    }
    if (minTime && time < minTime) {
      setError('Pick a time later than now.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          // build a Date from the local parts and send as UTC ISO
          title,
          date: new Date(`${date}T${time}:00`).toISOString(),
          location,
          capacity: Number(capacity),
          price: price ? Number(price) : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Try again.');
        return;
      }
      router.push('/');
    } catch (err) {
      setError('Network error - check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  if (authLoading || !user) {
    return <div className="shellNarrow" />;
  }

  return (
    <div className="shellNarrow">
      <form className="card" onSubmit={handleSubmit}>
        <h1 className="formTitle">Host an event</h1>
        <p className="formSub">Fill in the details and it'll show up on the events page right away.</p>

        {error && <div className="alert alertError">{error}</div>}

        <div className="field">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Summer Rooftop Social"
          />
        </div>

        <div className="paymentRow" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field">
            <label htmlFor="date">Date</label>
            <input
              id="date"
              required
              type="date"
              min={minDate}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="time">Time</label>
            <input
              id="time"
              required
              type="time"
              step={300}
              min={minTime}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={!date}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="location">Location</label>
          <input
            id="location"
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Marina Bay, Singapore"
          />
        </div>

        <div className="field">
          <label htmlFor="capacity">Capacity</label>
          <input
            id="capacity"
            required
            type="number"
            min="1"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="50"
          />
        </div>

        <div className="field">
          <label htmlFor="price">Price (USD)</label>
          <input
            id="price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Leave blank for a free event"
          />
          <span className="fieldHint">
            Attendees pay this exact amount at checkout - they won&apos;t enter their own amount.
          </span>
        </div>

        <button className="btn btnPrimary btnFull" type="submit" disabled={loading}>
          {loading ? 'Publishing...' : 'Publish event'}
        </button>
      </form>
    </div>
  );
}
