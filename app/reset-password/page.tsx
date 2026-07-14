'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// consolidated into /forgot-password (email -> security question ->
// new password, all on one page) - this page just catches any old
// links/bookmarks
export default function ResetPasswordRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/forgot-password');
  }, [router]);

  return null;
}
