import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/access';
import { getRouteContext, jsonError } from '@/lib/serverAuth';
import type { PermissionMap } from '@/lib/types';

export const runtime = 'nodejs';

function cleanPermissions(value: unknown): PermissionMap {
  if (!value || typeof value !== 'object') return {};
  return value as PermissionMap;
}

function titleCase(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)(\S)/g, (match) => match.toUpperCase());
}

function canManageCollaborators(profile: Parameters<typeof can>[0]) {
  return can(profile, 'cadastrar_colaboradores');
}

export async function POST(request: NextRequest) {
  const context = await getRouteContext(request);
  if ('error' in context) return context.error;
  if (!canManageCollaborators(context.profile)) {
    return jsonError('Sem permissão para cadastrar colaboradores.', 403);
  }

  const body = await request.json().catch(() => null) as {
    name?: string;
    email?: string;
    password?: string;
    phone?: string;
    permissions?: PermissionMap;
  } | null;

  if (!body?.name || !body.email || !body.password) return jsonError('Nome, email e senha são obrigatórios.');

  const storeId = context.profile.store_id;
  if (!storeId && context.role !== 'ADMIN_MASTER') {
    return jsonError('Seu usuário não está vinculado a uma loja.', 422);
  }

  const { data: authData, error: authError } = await context.admin.auth.admin.createUser({
    email: body.email.trim().toLowerCase(),
    password: body.password,
    email_confirm: true,
    user_metadata: {
      name: titleCase(body.name),
      phone: body.phone ?? null,
      role: 'colaborador_lojista',
    },
  });

  if (authError || !authData.user) return jsonError(authError?.message ?? 'Não foi possível criar o usuário.', 400);

  const { data, error } = await context.admin
    .from('profiles')
    .insert({
      user_id: authData.user.id,
      role: 'colaborador_lojista',
      store_id: storeId,
      name: titleCase(body.name),
      phone: body.phone || null,
      permissions: cleanPermissions(body.permissions),
    })
    .select()
    .single();

  if (error) return jsonError(error.message, 400);
  return NextResponse.json({ profile: data });
}

export async function PATCH(request: NextRequest) {
  const context = await getRouteContext(request);
  if ('error' in context) return context.error;
  if (!canManageCollaborators(context.profile)) {
    return jsonError('Sem permissão para editar colaboradores.', 403);
  }

  const body = await request.json().catch(() => null) as {
    profileId?: string;
    name?: string;
    phone?: string;
    permissions?: PermissionMap;
    blocked?: boolean;
  } | null;

  if (!body?.profileId || !body.name) return jsonError('Dados incompletos.');

  const patch = {
    name: titleCase(body.name),
    phone: body.phone || null,
    permissions: cleanPermissions(body.permissions),
    blocked_at: body.blocked ? new Date().toISOString() : null,
  };

  let query = context.admin
    .from('profiles')
    .update(patch)
    .eq('id', body.profileId)
    .eq('role', 'colaborador_lojista');

  if (context.role !== 'ADMIN_MASTER') {
    query = query.eq('store_id', context.profile.store_id);
  }

  const { data, error } = await query.select().single();
  if (error) return jsonError(error.message, 400);
  return NextResponse.json({ profile: data });
}
