"""Prepara los usuarios iniciales (una sola vez).

Genera contraseñas al azar para el administrador, el perfil genérico y el usuario de sistema; guarda la del sistema en
el Administrador de credenciales de Windows y escribe en data/ (no se sube a Git):
  - instalar_usuarios.sql      para ejecutar en el SQL Editor de Supabase después de supabase/schema.sql
  - credenciales_iniciales.txt contraseñas temporales (la app obliga a cambiarlas en el primer ingreso)
"""
import secrets
import string
import sys
from pathlib import Path

import keyring

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nf.conexion import RAIZ, leer_config  # noqa: E402

USUARIOS = [("carlos.manuel.alvarez.gutierrez", "Carlos Manuel Alvarez Gutierrez", "admin"),
            ("generico", "Consulta No Formalizado", "generico")]


def clave(n=14):
    abc = string.ascii_letters + string.digits
    return "".join(secrets.choice(abc) for _ in range(n))


def main():
    sup = leer_config()["supabase"]
    datos = RAIZ / "data"
    datos.mkdir(exist_ok=True)
    claves = {u: clave() for u, _, _ in USUARIOS}
    sistema = keyring.get_password(sup["servicio_credenciales"], sup["usuario"]) or clave(24)
    keyring.set_password(sup["servicio_credenciales"], sup["usuario"], sistema)

    sql = ["-- Usuarios iniciales de App No Formalizado. Ejecutar en el SQL Editor después de supabase/schema.sql.",
           "-- Contiene contraseñas: NO subir a Git."]
    for u, nombre, rol in USUARIOS + [(sup["usuario"], "Proceso de carga", "sistema")]:
        c = sistema if rol == "sistema" else claves[u]
        sql.append(f"select public.nf_crear_usuario('{u}', '{nombre}', '{rol}', '{c}') "
                   f"where not exists (select 1 from public.nf_perfiles where usuario = '{u}');")
    sql.append("select usuario, nombre, rol from public.nf_perfiles order by rol, usuario;")
    (datos / "instalar_usuarios.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")

    txt = ["Contraseñas temporales de App No Formalizado (la app pide cambiarlas en el primer ingreso).", ""]
    for u, nombre, rol in USUARIOS:
        txt.append(f"{rol:9} usuario: {nombre if rol == 'admin' else u}   contraseña: {claves[u]}")
    (datos / "credenciales_iniciales.txt").write_text("\n".join(txt) + "\n", encoding="utf-8")
    print(f"Listo: {datos / 'instalar_usuarios.sql'} y {datos / 'credenciales_iniciales.txt'}")


if __name__ == "__main__":
    main()
