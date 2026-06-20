'use client';

import { useEffect, useState } from 'react';
import { ensureProfile } from '@/services/authService';
import type { Profile } from '@/lib/types';
import { useSession } from './useSession';

export function useProfile() {
  const { session, user, loading: sessionLoading } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session || !user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    ensureProfile()
      .then(({ data }) => setProfile(data))
      .finally(() => setLoading(false));
  }, [session, user, sessionLoading]);

  return { profile, session, user, loading: sessionLoading || loading };
}
