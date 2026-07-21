'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

export default function Nav() {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);

  // close the menu after tapping a link, otherwise it stays open over
  // the page you just went to
  const close = () => setOpen(false);

  return (
    <nav className="nav">
      <Link href="/" className="navBrand" onClick={close}>
        Gather
      </Link>

      <button
        className="navToggle"
        onClick={() => setOpen(!open)}
        aria-label="Menu"
        aria-expanded={open}
      >
        <span className="navToggleBar" />
        <span className="navToggleBar" />
        <span className="navToggleBar" />
      </button>

      <div className={open ? 'navLinks navLinksOpen' : 'navLinks'}>
        <Link href="/" className="navLink" onClick={close}>
          Events
        </Link>
        <Link href="/events/new" className="navLink" onClick={close}>
          Host an event
        </Link>
        {!loading && user && (
          <Link href="/account" className="navLink" onClick={close}>
            Account
          </Link>
        )}
        {!loading && !user && (
          <>
            <Link href="/login" className="navButtonGhost" onClick={close}>
              Log in
            </Link>
            <Link href="/register" className="navButton" onClick={close}>
              Sign up
            </Link>
          </>
        )}
        {!loading && user && (
          <button
            className="navButtonGhost"
            onClick={() => {
              close();
              logout();
            }}
            style={{ cursor: 'pointer' }}
          >
            Log out
          </button>
        )}
      </div>
    </nav>
  );
}
