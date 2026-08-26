-- FORD-AVON · Alta idempotente de gestores + supervisor (aplicada en Supabase).
-- Crea usuarios en auth.users + auth.identities + public.profiles con contraseña temporal.
-- Idempotente: si el correo ya existe en auth, NO recrea ni sobreescribe la contraseña;
-- solo asegura el perfil (rol/activo). No destructivo. La asignación de cartera es semimanual.
-- Nota: el email de Auth se guarda en minúsculas (GoTrue es case-insensitive); el email de
-- perfil se conserva tal cual (incluye 'josselyn.Herrera').
do $$
declare
  r record;
  uid uuid;
  existing uuid;
  gestor_role uuid := (select id from public.roles where clave='gestor' limit 1);
  super_role  uuid := (select id from public.roles where clave='supervisor' limit 1);
  lem text;
begin
  for r in
    select * from (values
      ('sherly.cotom@grupopdc.com','Sherly','Cotom','Sherly@2026',gestor_role),
      ('sarai.ticas@grupopdc.com','Sarai','Ticas','Sarai@2026',gestor_role),
      ('jasmin.ramirez@grupopdc.com','Jasmin','Ramirez','Jasmin@2026',gestor_role),
      ('maria.valey@grupopdc.com','María','Valey','Maria@2026',gestor_role),
      ('astrid.vasquez@grupopdc.com','Astrid','Vasquez','Astrid@2026',gestor_role),
      ('karina.noriega@grupopdc.com','Karina','Noriega','Karina@2026',gestor_role),
      ('diego.soto@grupopdc.com','Diego','Soto','Diego@2026',gestor_role),
      ('bryan.rodriguez@grupopdc.com','Bryan','Rodriguez','Bryan@2026',gestor_role),
      ('juan.reyes@grupopdc.com','Juan','Reyes','Juan@2026',gestor_role),
      ('angie.buch@grupopdc.com','Angie','Buch','Angie@2026',gestor_role),
      ('alejandra.diaz@grupopdc.com','Alejandra','Díaz','Alejandra@2026',gestor_role),
      ('heidi.morales@grupopdc.com','Heidi','Morales','Heidi@2026',gestor_role),
      ('derick.gonzalez@grupopdc.com','Derick','González','Derick@2026',gestor_role),
      ('jonathan.guzman@grupopdc.com','Jonathan','Guzmán','Jonathan@2026',gestor_role),
      ('marcos.canteo@grupopdc.com','Marcos','Canteo','Marcos@2026',gestor_role),
      ('andrea.soto@grupopdc.com','Mishelle','Soto','Mishelle@2026',gestor_role),
      ('alexandra.perez@grupopdc.com','Dahirin','Pérez','Dahirin@2026',gestor_role),
      ('julio.cano@grupopdc.com','Julio','Salazar','Julio@2026',gestor_role),
      ('josselyn.Herrera@grupopdc.com','Josselyn','Herrera','Josselyn@2026',gestor_role),
      ('daniel.monge@grupopdc.com','Daniel','Monge','Daniel@2026',super_role)
    ) as t(email,nombre,apellido,pw,role_id)
  loop
    lem := lower(r.email);
    select id into existing from auth.users where lower(email) = lem limit 1;
    if existing is null then
      uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', lem,
              crypt(r.pw, gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}'::jsonb,
              jsonb_build_object('nombre', r.nombre, 'apellido', r.apellido), now(), now());
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id)
      values (uid::text, uid,
              jsonb_build_object('sub', uid::text, 'email', lem, 'email_verified', true, 'phone_verified', false),
              'email', now(), now(), now(), gen_random_uuid());
    else
      uid := existing;
    end if;
    insert into public.profiles (id, nombre, apellido, email, role_id, activo, creado_en, actualizado_en)
    values (uid, r.nombre, r.apellido, r.email, r.role_id, true, now(), now())
    on conflict (id) do update
      set nombre = excluded.nombre, apellido = excluded.apellido, email = excluded.email,
          role_id = excluded.role_id, activo = true, actualizado_en = now();
  end loop;
end $$;
