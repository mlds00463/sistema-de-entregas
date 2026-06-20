'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

export function useRealtimeTable(table: string, onChange: () => void, filter?: string) {
  useEffect(() => {
    const channel = supabase
      .channel(`${table}-${filter ?? 'all'}-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter },
        () => onChange()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter, onChange]);
}
