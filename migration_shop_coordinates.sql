-- Coordenadas reais das lojas para o mapa.
-- Depois de rodar, edite/salve a loja uma vez para gravar latitude/longitude pelo endereço cadastrado.

alter table public.shops add column if not exists latitude double precision;
alter table public.shops add column if not exists longitude double precision;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shops_coordinates_valid'
      and conrelid = 'public.shops'::regclass
  ) then
    alter table public.shops
      add constraint shops_coordinates_valid check (
        (latitude is null and longitude is null)
        or (latitude between -90 and 90 and longitude between -180 and 180)
      );
  end if;
end $$;

notify pgrst, 'reload schema';
