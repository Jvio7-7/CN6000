'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, useAuth } from '@/lib/auth-context';
import { validatePasswordClient, PASSWORD_HINT } from '@/lib/validation';

interface NotificationRecord {
  id: string;
  recipient_email: string;
  subject: string;
  body: string;
  status: string;
  created_at: string;
}

interface MyEventRecord {
  id: string;
  title: string;
  event_date: string;
  location: string;
  capacity: number;
  cancelled_at: string | null;
}

interface MyBookingRecord {
  id: string;
  event_id: string;
  event_title: string;
  event_date: string;
  attendee_name: string;
  attendee_email: string;
  cancelled_at: string | null;
  created_at: string;
}

export default function AccountPage() {
  const router = useRouter();
  const { user, token, loading, updateUser } = useAuth();

  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [myEvents, setMyEvents] = useState<MyEventRecord[]>([]);
  const [myBookings, setMyBookings] = useState<MyBookingRecord[]>([]);

  const [nameForm, setNameForm] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMessage, setNameMessage] = useState('');
  const [nameError, setNameError] = useState('');

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState('');
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) setNameForm(user.name);
  }, [user]);

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  function refreshNotifications() {
    if (!token || !API_BASE_URL) return;
    fetch(`${API_BASE_URL}/notifications`)
      .then((res) => res.json())
      .then((data) => setNotifications(Array.isArray(data) ? data : []))
      .catch(() => {});
  }

  function refreshMyEvents() {
    if (!token || !API_BASE_URL) return;
    fetch(`${API_BASE_URL}/users/me/events`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => setMyEvents(Array.isArray(data) ? data : []))
      .catch(() => {});
  }

  function refreshMyBookings() {
    if (!token || !API_BASE_URL) return;
    fetch(`${API_BASE_URL}/users/me/bookings`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => setMyBookings(Array.isArray(data) ? data : []))
      .catch(() => {});
  }

  useEffect(() => {
    refreshNotifications();
    refreshMyEvents();
    refreshMyBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleNameSave(e: React.FormEvent) {
    e.preventDefault();
    setNameError('');
    setNameMessage('');
    if (!nameForm.trim()) {
      setNameError('Name can\u2019t be empty.');
      return;
    }
    setNameSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/me`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ name: nameForm.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNameError(data.error || 'Something went wrong.');
        return;
      }
      updateUser(data);
      setNameMessage('Saved.');
    } catch (err) {
      setNameError('Network error \u2014 try again.');
    } finally {
      setNameSaving(false);
    }
  }

  async function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwMessage('');
    const passwordError = validatePasswordClient(pwForm.newPassword);
    if (passwordError) {
      setPwError(passwordError);
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('New passwords don\u2019t match.');
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/change-password`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          currentPassword: pwForm.currentPassword,
          newPassword: pwForm.newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwError(data.error || 'Something went wrong.');
        return;
      }
      setPwMessage('Password updated.');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setPwError('Network error \u2014 try again.');
    } finally {
      setPwSaving(false);
    }
  }

  async function handleCancelEvent(id: string) {
    if (!confirm('Cancel this event? Everyone who\u2019s booked will have their booking cancelled too, and anyone who paid will get a refund notification.')) return;
    try {
      await fetch(`${API_BASE_URL}/events/${id}/cancel`, { method: 'POST', headers: authHeaders() });
      refreshMyEvents();
    } catch (err) {
      // silent - the row just won't update, user can retry
    }
  }

  async function handleCancelBooking(id: string) {
    if (!confirm('Cancel this booking?')) return;
    try {
      await fetch(`${API_BASE_URL}/bookings/${id}/cancel`, { method: 'POST', headers: authHeaders() });
      refreshMyBookings();
    } catch (err) {
      // silent
    }
  }

  if (loading || !user) {
    return <div className="shell" />;
  }

  const initial = user.name?.[0]?.toUpperCase() || '?';
  const myNotifications = notifications.filter((n) => n.recipient_email === user.email);

  return (
    <div className="shell">
      <div className="hero" style={{ paddingBottom: 16 }}>
        <div className="profileHead">
          <div className="avatar">{initial}</div>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, margin: 0 }}>
              {user.name}
            </h1>
            <p style={{ color: 'var(--muted)', margin: '2px 0 0', fontSize: 14.5 }}>{user.email}</p>
          </div>
        </div>
      </div>

      <div className="sectionHead">
        <h2 className="sectionTitle">Edit profile</h2>
      </div>
      <form className="card" onSubmit={handleNameSave} style={{ marginBottom: 20 }}>
        {nameError && <div className="alert alertError">{nameError}</div>}
        {nameMessage && <div className="alert alertSuccess">{nameMessage}</div>}
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" value={nameForm} onChange={(e) => setNameForm(e.target.value)} />
        </div>
        <button className="btn btnSecondary" type="submit" disabled={nameSaving}>
          {nameSaving ? 'Saving\u2026' : 'Save name'}
        </button>
      </form>

      <form className="card" onSubmit={handlePasswordSave} style={{ marginBottom: 20 }}>
        <p className="formSub" style={{ marginBottom: 18 }}>Change password</p>
        {pwError && <div className="alert alertError">{pwError}</div>}
        {pwMessage && <div className="alert alertSuccess">{pwMessage}</div>}
        <div className="field">
          <label htmlFor="currentPassword">Current password</label>
          <input
            id="currentPassword"
            type="password"
            value={pwForm.currentPassword}
            onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            type="password"
            minLength={12}
            maxLength={24}
            value={pwForm.newPassword}
            onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
            placeholder="At least 12 characters"
          />
          <span className="fieldHint">{PASSWORD_HINT}</span>
        </div>
        <div className="field">
          <label htmlFor="confirmPassword">Confirm new password</label>
          <input
            id="confirmPassword"
            type="password"
            minLength={12}
            maxLength={24}
            value={pwForm.confirmPassword}
            onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
          />
        </div>
        <button className="btn btnSecondary" type="submit" disabled={pwSaving}>
          {pwSaving ? 'Saving\u2026' : 'Update password'}
        </button>
      </form>

      <div className="sectionHead">
        <h2 className="sectionTitle">Events you're hosting</h2>
      </div>
      {myEvents.length === 0 ? (
        <div className="emptyState">You haven't hosted anything yet.</div>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          {myEvents.map((ev) => (
            <div className="notificationRow" key={ev.id}>
              <p className="notificationSubject">
                {ev.title}
                {ev.cancelled_at && (
                  <span style={{ color: 'var(--error)', fontWeight: 600, fontSize: 12.5, marginLeft: 8 }}>
                    CANCELLED
                  </span>
                )}
              </p>
              <p className="notificationBody">
                {new Date(ev.event_date).toLocaleString()} | {ev.location} | {ev.capacity} spots
              </p>
              {!ev.cancelled_at && (
                <button
                  className="linkQuiet"
                  style={{ color: 'var(--error)', marginTop: 6 }}
                  onClick={() => handleCancelEvent(ev.id)}
                >
                  Cancel event
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="sectionHead">
        <h2 className="sectionTitle">Your bookings</h2>
      </div>
      {myBookings.length === 0 ? (
        <div className="emptyState">No bookings yet.</div>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          {myBookings.map((b) => (
            <div className="notificationRow" key={b.id}>
              <p className="notificationSubject">
                {b.event_title}
                {b.cancelled_at && (
                  <span style={{ color: 'var(--error)', fontWeight: 600, fontSize: 12.5, marginLeft: 8 }}>
                    CANCELLED
                  </span>
                )}
              </p>
              <p className="notificationBody">{new Date(b.event_date).toLocaleString()}</p>
              <p className="notificationMeta">Booked {new Date(b.created_at).toLocaleString()}</p>
              {!b.cancelled_at && (
                <button
                  className="linkQuiet"
                  style={{ color: 'var(--error)', marginTop: 6 }}
                  onClick={() => handleCancelBooking(b.id)}
                >
                  Cancel booking
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="sectionHead">
        <h2 className="sectionTitle">Activity</h2>
      </div>
      {myNotifications.length === 0 ? (
        <div className="emptyState">
          Nothing here yet. Book something and you&apos;ll see updates show up here.
        </div>
      ) : (
        <div className="card">
          {myNotifications.map((n) => (
            <div className="notificationRow" key={n.id}>
              <p className="notificationSubject">{n.subject}</p>
              <p className="notificationBody">{n.body}</p>
              <p className="notificationMeta">{new Date(n.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
