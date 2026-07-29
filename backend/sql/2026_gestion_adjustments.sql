-- FORD-AVON · Ajustes módulo Gestión (idempotente).
-- Agrega Tipo de Contacto y Canal a las gestiones. No borra datos históricos.
-- gestion_log.tipo_contacto: 'Representante' | 'Gerente de Zona' | 'Tercero' (texto libre validado en app)
-- gestion_log.canal: 'Llamada' | 'SMS' | 'WhatsApp' | 'Correo'
alter table public.gestion_log add column if not exists tipo_contacto text;
alter table public.gestion_log add column if not exists canal text;
