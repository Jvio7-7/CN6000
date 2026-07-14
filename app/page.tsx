'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { API_BASE_URL } from '@/lib/auth-context';
import EventCard from '@/components/EventCard';

interface EventRecord {
  id: string;
  title: string;
  event_date: string;
  location: string;
  capacity: number;
  price: number;
  booking_count: number;
}

export default function Home() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showOld, setShowOld] = useState(false);

  useEffect(() => {
    if (!API_BASE_URL) {
      setError('NEXT_PUBLIC_API_BASE_URL is not set — see .env.local');
      setLoading(false);
      return;
    }
    fetch(`${API_BASE_URL}/events`)
      .then((res) => res.json())
      .then((data) => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setError('Could not load events right now.'))
      .finally(() => setLoading(false));
  }, []);

  const { upcoming, past } = useMemo(() => {
    const now = new Date();
    const upcoming: EventRecord[] = [];
    const past: EventRecord[] = [];
    for (const ev of events) {
      (new Date(ev.event_date) >= now ? upcoming : past).push(ev);
    }
    return { upcoming, past };
  }, [events]);

  return (
    <div className="shell">
      <div className="hero">
        <p className="heroEyebrow">Upcoming events</p>
        <h1 className="heroTitle">Never miss what&apos;s next.</h1>
        <p className="heroSub">
          Browse what&apos;s happening nearby, save your spot in a couple of
          clicks, and keep track of everything you&apos;re going to in one
          place.
        </p>
        <Link href="/events/new" className="btn btnPrimary">
          Host your own event →
        </Link>
      </div>

      <div className="sectionHead">
        <h2 className="sectionTitle">What&apos;s on</h2>
      </div>

      {error && <div className="alert alertError">{error}</div>}

      {!error && loading && <div className="emptyState">Loading events…</div>}

      {!error && !loading && upcoming.length === 0 && (
        <div className="emptyState">
          Nothing&apos;s coming up yet. Be the first to host something.
        </div>
      )}

      {!error && !loading && upcoming.length > 0 && (
        <div className="ticketGrid">
          {upcoming.map((ev) => (
            <EventCard
              key={ev.id}
              id={ev.id}
              title={ev.title}
              eventDate={ev.event_date}
              location={ev.location}
              capacity={ev.capacity}
              price={Number(ev.price)}
              bookingCount={Number(ev.booking_count)}
            />
          ))}
        </div>
      )}

      {!error && !loading && past.length > 0 && (
        <>
          <div className="sectionHead">
            <h2 className="sectionTitle">Old events</h2>
            <button className="linkQuiet" onClick={() => setShowOld(!showOld)}>
              {showOld ? 'Hide' : `Show ${past.length}`}
            </button>
          </div>
          {showOld && (
            <div className="ticketGrid">
              {past.map((ev) => (
                <EventCard
                  key={ev.id}
                  id={ev.id}
                  title={ev.title}
                  eventDate={ev.event_date}
                  location={ev.location}
                  capacity={ev.capacity}
                  price={Number(ev.price)}
                  bookingCount={Number(ev.booking_count)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
