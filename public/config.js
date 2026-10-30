// Conexión a Supabase (proyecto de Telemercadeo). La clave "publishable" es pública por diseño:
// la seguridad la dan las políticas RLS de supabase/schema.sql (solo usuarios con perfil nf_ ven los datos).
window.NF_CONFIG = {
  SUPABASE_URL: 'https://osigpjjokeecfihcyzxk.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_BvyeNi_H2exf_mWMPpl7mA_gwShSQfE',
};
