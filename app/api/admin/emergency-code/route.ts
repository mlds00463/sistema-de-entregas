import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getRouteContext, jsonError } from '@/lib/serverAuth';

export const runtime = 'nodejs';

function createCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

export async function POST(request: NextRequest) {
  const context = await getRouteContext(request);
  if ('error' in context) return context.error;
  if (context.role !== 'ADMIN_MASTER') return jsonError('Apenas Admin Master pode gerar senha emergencial.', 403);

  const body = await request.json().catch(() => null) as {
    targetUserId?: string;
    targetStoreId?: string;
  } | null;

  if (!body?.targetUserId && !body?.targetStoreId) {
    return jsonError('Informe um usuário ou uma loja.');
  }

  const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  let code = createCode();
  let attempt = 0;
  let result;

  do {
    result = await context.admin
      .from('emergency_access_codes')
      .insert({
        code,
        target_user_id: body.targetUserId ?? null,
        target_store_id: body.targetStoreId ?? null,
        valid_until: validUntil,
        created_by: context.profile.id,
      })
      .select()
      .single();

    if (!result.error) break;
    code = createCode();
    attempt += 1;
  } while (attempt < 5);

  if (result.error) return jsonError(result.error.message, 400);
  return NextResponse.json({ code, record: result.data });
}
