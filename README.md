# App No Formalizado

Lista de llamadas para retomar las solicitudes **TUD sin formalizar** de Nicaragua (último crédito por cédula, 35 días),
con detalle, estatus de llamada, comentarios, segmentación de la base y dashboard de su evolución.

- App: https://camalgut-crypto.github.io/App-No-Formalizado/
- Datos: Supabase de Telemercadeo (`osigpjjokeecfihcyzxk`, el mismo del CRM), tablas `nf_*`. Los usuarios del CRM no las ven.
- Base: `app no formalizada.sql` (la consulta del usuario; el proceso la lee tal cual).

## Pestañas

| Pestaña | Qué muestra |
|---|---|
| **Llamadas** | Cliente, promotor y teléfono. Al abrir un cliente: todos los datos de la consulta, estatus de llamada, comentario e historial. |
| **Base y segmentación** | Indicadores, segmentos (estado TUD, tipo de crédito, categorización, sucursal, medio, estatus, promotor; clic para filtrar), tabla completa y Excel. También las que **salieron de la base** y por qué. |
| **Dashboard** | Evolución de la base por carga, entradas y salidas por día, motivos de salida y avance de la gestión. |
| **Administración** | Usuarios (solo administrador). |

## Perfiles

- **Administrador**: todo, incluido registrar llamadas y comentarios y crear usuarios.
- **Genérico**: consulta la base, su segmentación, el estatus y el dashboard. No modifica nada.

Se ingresa con el nombre completo (o `generico`). La contraseña temporal se cambia en el primer ingreso.

## Cargas

Tareas programadas **"App No Formalizado - 11am"** y **"App No Formalizado - 3pm"** → `Ejecutar carga.bat` → `worker/actualizar.py`.

- Cada carga actualiza los datos de la solicitud y **conserva** el estatus y los comentarios.
- La que deja de salir en la consulta pasa a "salió de la base" con su motivo, según su estado actual en el DWH:
  FORMALIZÓ (tiene fecha de formalizado, aunque ya esté en AUDITADO u otro estado), NUEVA SOLICITUD DEL CLIENTE,
  CAMBIÓ DE ESTADO, FUERA DE LOS 35 DÍAS u OTRO. Si vuelve a salir en la consulta, reingresa con su historial.
- Cada carga deja una foto (`nf_cargas`, `nf_cargas_detalle`) para el dashboard.
- Si la consulta devuelve 0 filas no se toca la base (se registra el error en `worker/logs/actualizar.log`).

El DWH solo se alcanza desde la red interna, así que las tareas corren en esta PC (debe estar encendida a esas horas).
Credenciales: SQL en keyring `modulo_garantias_sql` (el de Loan Tape); Supabase con el usuario `nf.sistema` (keyring `app_no_formalizado_supabase`).

`worker/actualizar.py --prueba` ejecuta la consulta y muestra un resumen sin subir nada.

## Puesta en marcha (una vez)

1. `py -m venv .venv` y `.venv\Scripts\pip install pandas pyodbc keyring requests`.
2. Supabase de Telemercadeo › SQL Editor: ejecutar `supabase/schema.sql`.
3. `.venv\Scripts\python worker\instalar.py` genera `data/instalar_usuarios.sql` (ejecutarlo también en el SQL Editor) y
   `data/credenciales_iniciales.txt` con las contraseñas temporales. `data/` no se sube a Git.
4. `Ejecutar carga.bat` para la primera carga.

Los estatus de llamada están en la tabla `nf_estatus` (columna `contacto` = cuenta como contacto efectivo).
