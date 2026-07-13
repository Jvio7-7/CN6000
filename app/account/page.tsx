'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, useAuth } from '@/lib/auth-context';

interface NotificationRecord {
  id: string;
  recipient_email: string;
  subject: string;
  body: string;
  status: string;
  created_at: string;
}

export default function AccountPage() {
  const router = useRouter();
  const { user, token, loading } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!token || !API_BASE_URL) return;
    fetch(`${API_BASE_URL}/notifications`)
      .then((res) => res.json())
      .then((data) => setNotifications(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingNotifications(false));
  }, [token]);

  if (loading || !user) {
    return <div className="shell" />;
  }

  const initial = user.name?.[0]?.toUpperCase() || '?';
  const mine = notifications.filter((n) => n.recipient_email === user.email);

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
        <h2 className="sectionTitle">Activity</h2>
      </div>

      {loadingNotifications ? (
        <div className="emptyState">Loading…</div>
      ) : mine.length === 0 ? (
        <div className="emptyState">
          Nothing here yet. Book something and you&apos;ll see updates show up here.
        </div>
      ) : (
        <div className="card">
          {mine.map((n) => (
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
