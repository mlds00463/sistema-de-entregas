'use client';

import { RefreshCw, Save, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import ProtectedPage from '@/components/ProtectedPage';
import { useProfile } from '@/hooks/useProfile';
import { COLLABORATOR_PERMISSIONS } from '@/lib/access';
import type { PermissionMap, Profile } from '@/lib/types';
import { createCollaborator, getStoreCollaborators, updateCollaborator } from '@/services/collaboratorService';

function emptyPermissions(): PermissionMap {
  return COLLABORATOR_PERMISSIONS.reduce<PermissionMap>((result, permission) => {
    result[permission.key] = false;
    return result;
  }, {});
}

function permissionFromProfile(profile: Profile): PermissionMap {
  return { ...emptyPermissions(), ...(profile.permissions ?? {}) };
}

export default function CollaboratorsPage() {
  const { profile } = useProfile();
  const [collaborators, setCollaborators] = useState<Profile[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [permissions, setPermissions] = useState<PermissionMap>(emptyPermissions);
  const [editing, setEditing] = useState<Record<string, PermissionMap>>({});
  const [blocked, setBlocked] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await getStoreCollaborators(profile?.store_id);
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const nextCollaborators = data ?? [];
    setCollaborators(nextCollaborators);
    setEditing(Object.fromEntries(nextCollaborators.map((item) => [item.id, permissionFromProfile(item)])));
    setBlocked(Object.fromEntries(nextCollaborators.map((item) => [item.id, Boolean(item.blocked_at)])));
  }, [profile?.store_id]);

  useEffect(() => {
    if (profile) load();
  }, [load, profile]);

  function toggleNewPermission(key: keyof PermissionMap) {
    setPermissions((current) => ({ ...current, [key]: !current[key] }));
  }

  function toggleExistingPermission(profileId: string, key: keyof PermissionMap) {
    setEditing((current) => ({
      ...current,
      [profileId]: {
        ...current[profileId],
        [key]: !current[profileId]?.[key],
      },
    }));
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    const result = await createCollaborator({ name, email, password, phone, permissions });
    setSaving(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setName('');
    setEmail('');
    setPassword('');
    setPhone('');
    setPermissions(emptyPermissions());
    setMessage('Colaborador criado.');
    await load();
  }

  async function handleUpdate(collaborator: Profile) {
    setSaving(true);
    setError(null);
    setMessage(null);
    const result = await updateCollaborator({
      profileId: collaborator.id,
      name: collaborator.name,
      phone: collaborator.phone ?? '',
      permissions: editing[collaborator.id] ?? {},
      blocked: blocked[collaborator.id] ?? false,
    });
    setSaving(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setMessage('Permissões atualizadas.');
    await load();
  }

  return (
    <ProtectedPage roles={['LOJISTA', 'COLABORADOR_LOJISTA', 'ADMIN_MASTER']} permissions={['cadastrar_colaboradores']}>
      <section className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Equipe da loja</p>
            <h2>Cadastrar colaboradores</h2>
            <p className="small-text">Crie acessos e marque exatamente o que cada pessoa pode fazer.</p>
          </div>
          <button className="icon-button" onClick={load}><RefreshCw size={18} /> Atualizar</button>
        </div>

        {error && <p className="error-text">{error}</p>}
        {message && <p className="success-text">{message}</p>}

        <form className="form-grid" onSubmit={handleCreate}>
          <div className="form-grid columns-2">
            <input className="input" placeholder="Nome completo" value={name} onChange={(event) => setName(event.target.value)} required />
            <input className="input" placeholder="Telefone" value={phone} onChange={(event) => setPhone(event.target.value)} />
            <input className="input" type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <input className="input" type="password" placeholder="Senha inicial" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required />
          </div>

          <div className="checkbox-grid">
            {COLLABORATOR_PERMISSIONS.map((permission) => (
              <label className="checkbox-card" key={permission.key}>
                <input type="checkbox" checked={Boolean(permissions[permission.key])} onChange={() => toggleNewPermission(permission.key)} />
                {permission.label}
              </label>
            ))}
          </div>

          <button className="button" disabled={saving}><UserPlus size={18} /> Criar colaborador</button>
        </form>
      </section>

      <section className="panel">
        <h2>Colaboradores cadastrados</h2>
        <div className="stack">
          {collaborators.map((collaborator) => (
            <div className="delivery-card align-start" key={collaborator.id}>
              <div>
                <strong>{collaborator.name}</strong>
                <p className="small-text">{collaborator.phone || 'Sem telefone'} · {blocked[collaborator.id] ? 'bloqueado' : 'ativo'}</p>
              </div>
              <div className="wide">
                <div className="checkbox-grid compact-checkboxes">
                  {COLLABORATOR_PERMISSIONS.map((permission) => (
                    <label className="checkbox-card" key={permission.key}>
                      <input
                        type="checkbox"
                        checked={Boolean(editing[collaborator.id]?.[permission.key])}
                        onChange={() => toggleExistingPermission(collaborator.id, permission.key)}
                      />
                      {permission.label}
                    </label>
                  ))}
                </div>
                <label className="checkbox-card inline-checkbox">
                  <input
                    type="checkbox"
                    checked={Boolean(blocked[collaborator.id])}
                    onChange={() => setBlocked((current) => ({ ...current, [collaborator.id]: !current[collaborator.id] }))}
                  />
                  Bloquear colaborador
                </label>
              </div>
              <button className="icon-button" onClick={() => handleUpdate(collaborator)} disabled={saving}>
                <Save size={16} /> Salvar
              </button>
            </div>
          ))}
          {collaborators.length === 0 && <p className="small-text">Nenhum colaborador cadastrado ainda.</p>}
        </div>
      </section>
    </ProtectedPage>
  );
}
