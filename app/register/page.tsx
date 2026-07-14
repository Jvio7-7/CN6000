'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, useAuth } from '@/lib/auth-context';
import { validatePasswordClient, PASSWORD_HINT } from '@/lib/validation';

export default function RegisterPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    securityQuestion: '',
    securityAnswer: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!API_BASE_URL) {
      setError('NEXT_PUBLIC_API_BASE_URL is not set - see .env.local');
      return;
    }
    const passwordError = validatePasswordClient(form.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords don\u2019t match.');
      return;
    }
    if (form.securityAnswer.trim().length < 2) {
      setError('Security answer is too short.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          securityQuestion: form.securityQuestion,
          securityAnswer: form.securityAnswer,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Try again.');
        return;
      }
      setSession(data.user, data.token);
      router.push('/');
    } catch (err) {
      setError('Network error - check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="shellNarrow">
      <form className="card" onSubmit={handleSubmit}>
        <h1 className="formTitle">Create an account</h1>
        <p className="formSub">Takes about a minute.</p>

        {error && <div className="alert alertError">{error}</div>}

        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Jane Doe"
          />
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="jane.doe@example.com"
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={12}
            maxLength={24}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="At least 12 characters"
          />
          <span className="fieldHint">{PASSWORD_HINT}</span>
        </div>

        <div className="field">
          <label htmlFor="confirmPassword">Confirm password</label>
          <input
            id="confirmPassword"
            type="password"
            required
            minLength={12}
            maxLength={24}
            value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            placeholder="Type it again"
          />
        </div>

        <div className="field">
          <label htmlFor="securityQuestion">Security question</label>
          <input
            id="securityQuestion"
            required
            value={form.securityQuestion}
            onChange={(e) => setForm({ ...form, securityQuestion: e.target.value })}
            placeholder="What was your first pet's name?"
          />
          <span className="fieldHint">
            Used to reset your password if you forget it - write one only you&apos;d know the answer to.
          </span>
        </div>

        <div className="field">
          <label htmlFor="securityAnswer">Answer</label>
          <input
            id="securityAnswer"
            required
            value={form.securityAnswer}
            onChange={(e) => setForm({ ...form, securityAnswer: e.target.value })}
            placeholder="Your answer"
          />
        </div>

        <button className="btn btnPrimary btnFull" type="submit" disabled={loading}>
          {loading ? 'Creating account...' : 'Sign up'}
        </button>

        <p className="formFooter">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
