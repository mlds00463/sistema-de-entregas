-- Dados de exemplo opcionais.
-- Primeiro crie usuários reais pelo Supabase Auth ou pela tela do app.
-- Depois substitua os e-mails abaixo e rode este seed.

insert into shops (created_by, name, address, city)
select p.id, 'Loja Centro', 'Rua Principal, 100', 'São Paulo'
from profiles p
where p.role = 'gestor'
limit 1
on conflict do nothing;

insert into motorcyclists (profile_id, name, phone, is_online, available)
select p.id, p.name, p.phone, false, false
from profiles p
where p.role = 'motoqueiro'
on conflict (profile_id) do nothing;
