'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

export default function Nav() {
  const { user, loading, logout } = useAuth();

  return (
    <nav className="nav">
      <Link href="/" className="navBrand">
        Gather
      </Link>
      <div className="navLinks">
        <Link href="/" className="navLink">
          Events
        </Link>
        <Link href="/events/new" className="navLink">
          Host an event
        </Link>
        {!loading && user && (
          <Link href="/account" className="navLink">
            Account
          </Link>
        )}
        {!loading && !user && (
          <>
            <Link href="/login" className="navButtonGhost">
              Log in
            </Link>
            <Link href="/register" className="navButton">
              Sign up
            </Link>
          </>
        )}
        {!loading && user && (
          <button className="navButtonGhost" onClick={logout} style={{ cursor: 'pointer' }}>
            Log out
          </button>
        )}
      </div>
    </nav>
  );
}
