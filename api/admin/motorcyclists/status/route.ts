import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/access';
import { getRouteContext, jsonError } from '@/lib/serverAuth';

export const runtime = 'nodejs';

type Related<T> = T | T[] | null;

type RiderForStatus = {
  id: string;
  current_shop_id: string | null;
  profiles: Related<{
    id: string;
    store_id: string | null;
  }>;
};

function firstRelated<T>(value: Related<T>) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function canManageMotorcyclist(context: Awaited<ReturnType<typeof getRouteContext>>, rider: RiderForStatus) {
  if ('error' in context) return false;
  if (context.role === 'ADMIN_MASTER') return true;

  const riderProfile = firstRelated(rider.profiles);
  const sameStore = Boolean(
    context.profile.store_id
      && (context.profile.store_id === rider.current_shop_id || context.profile.store_id === riderProfile?.store_id)
  );

  if (context.role === 'LOJISTA') return sameStore;
  if (context.role === 'COLABORADOR_LOJISTA') return sameStore && can(context.profile, 'cadastrar_colaboradores');

  return false;
}

export async function POST(request: NextRequest) {
  const context = await getRouteContext(request);
  if ('error' in context) return context.error;

  const body = await request.json().catch(() => null) as {
    motorcyclistId?: string;
    active?: boolean;
  } | null;

  if (!body?.motorcyclistId || typeof body.active !== 'boolean') {
    return jsonError('Informe o motoqueiro e o status do cadastro.');
  }

  const { data: riderData, error: riderError } = await context.admin
    .from('motorcyclists')
    .select('id,current_shop_id,profiles(id,store_id)')
    .eq('id', body.motorcyclistId)
    .maybeSingle();

  if (riderError) return jsonError(riderError.message, 400);
  if (!riderData) return jsonError('Motoqueiro não encontrado.', 404);

  const rider = riderData as unknown as RiderForStatus;

  if (!canManageMotorcyclist(context, rider)) {
    return jsonError('Sem permissão para alterar este motoqueiro.', 403);
  }

  const now = new Date().toISOString();
  const payload = body.active
    ? { active: true, updated_at: now }
    : { active: false, is_online: false, available: false, updated_at: now };

  const { data: motorcyclist, error } = await context.admin
    .from('motorcyclists')
    .update(payload)
    .eq('id', rider.id)
    .select()
    .single();

  if (error) return jsonError(error.message, 400);

  return NextResponse.json({ motorcyclist });
}
