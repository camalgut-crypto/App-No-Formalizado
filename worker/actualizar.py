"""Carga la base de App No Formalizado: ejecuta "app no formalizada.sql" y la sube a Supabase (proyecto Telemercadeo).

Uso:
  actualizar.py            una carga (la ejecutan las tareas programadas de las 11:00 y las 15:00)
  actualizar.py --prueba   ejecuta las consultas y muestra el resumen sin subir nada
"""
import argparse
import logging
import sys
import time as reloj
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nf.conexion import RAIZ, consultar, leer_config  # noqa: E402

LOG = RAIZ / "worker" / "logs" / "actualizar.log"
COLUMNAS = {"Num_Solicitud": "solicitud", "Cliente": "cliente", "Cedula": "cedula", "Tipo_Credito": "tipo_credito",
            "Fecha_creacion": "fecha_creacion", "Monto_Solicitado": "monto_solicitado", "Monto_Tasa": "monto_tasa",
            "Monto_Aprobado": "monto_aprobado", "Monto_Pagare": "monto_pagare", "Estado": "estado",
            "Suc_Origen": "suc_origen", "Categorizacion": "categorizacion", "Medio_Captacion": "medio_captacion",
            "Telefono_Cliente": "telefono", "Correo_Cliente": "correo", "Promotor": "promotor"}
VENTANA_DIAS = 35  # la de la consulta


def _valor(v):
    if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NaT:
        return None
    if isinstance(v, (datetime, date, pd.Timestamp)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, str):
        v = v.strip()
        return v or None
    if hasattr(v, "item"):
        return v.item()
    return v


def leer_base(cfg: dict) -> list[dict]:
    sql = (RAIZ / cfg["consultas"]["base"]).read_text(encoding="utf-8-sig")
    t0 = reloj.time()
    df = consultar(cfg["servidor"], sql)
    logging.info("Consulta base: %s filas (%.0f s)", len(df), reloj.time() - t0)
    faltan = set(COLUMNAS) - set(df.columns)
    if faltan:
        raise RuntimeError(f"La consulta ya no trae las columnas {sorted(faltan)}")
    df = df[list(COLUMNAS)].rename(columns=COLUMNAS)
    df["solicitud"] = df["solicitud"].astype("int64")
    return [{k: _valor(v) for k, v in r.items()} for r in df.to_dict("records")]


def motivos_salida(cfg: dict, ids: list[int]) -> list[dict]:
    """Por qué dejó de salir cada solicitud, según su estado actual en el DWH."""
    if not ids:
        return []
    plantilla = (RAIZ / cfg["consultas"]["estado_actual"]).read_text(encoding="utf-8-sig")
    est = consultar(cfg["servidor"], plantilla.replace("{ids}", ",".join(str(int(i)) for i in ids)))
    limite = date.today() - timedelta(days=VENTANA_DIAS)
    salidas = []
    for r in est.drop_duplicates("Num_Solicitud").to_dict("records"):
        e = (r["Estado"] or "").strip()
        fecha = pd.Timestamp(r["Fecha_creacion"]).date() if r["Fecha_creacion"] else None
        if e == "FORMALIZADO" or pd.notna(r["Fecha_Formalizado"]):
            m = "FORMALIZÓ"
        elif r["Tiene_Nueva"]:
            m = "NUEVA SOLICITUD DEL CLIENTE"
        elif "TUD" not in e or e == "TUD REASIGNACION":
            m = "CAMBIÓ DE ESTADO"
        elif fecha and fecha < limite:
            m = "FUERA DE LOS 35 DÍAS"
        else:
            m = "OTRO"
        salidas.append({"solicitud": int(r["Num_Solicitud"]), "estado": e or None, "motivo": m})
    return salidas


def cargar(cfg: dict, prueba: bool = False):
    filas = leer_base(cfg)
    if not filas:
        raise RuntimeError("La consulta no devolvió filas: no se toca la base")
    if prueba:
        df = pd.DataFrame(filas)
        for c in ("estado", "tipo_credito", "categorizacion"):
            print(df[c].value_counts().to_string(), "\n")
        return
    from nf.nube import Supabase
    sb = Supabase(cfg["supabase"])
    antes = {r["solicitud"] for r in sb.leer("nf_solicitudes", "select=solicitud&en_base=is.true")}
    salen = sorted(antes - {f["solicitud"] for f in filas})
    salidas = motivos_salida(cfg, salen)
    r = sb.rpc("nf_cargar", {"p_filas": filas, "p_salidas": salidas})
    logging.info("Carga %s: %s en base, %s nuevas, %s reingresos, %s salidas (%s formalizaron)", r["carga"],
                 r["en_base"], r["nuevas"], r["reingresos"], r["salidas"], r["formalizadas"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prueba", action="store_true")
    a = ap.parse_args()
    LOG.parent.mkdir(exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.FileHandler(LOG, encoding="utf-8"), logging.StreamHandler()])
    try:
        cargar(leer_config(), a.prueba)
    except Exception:
        logging.exception("La carga falló")
        sys.exit(1)


if __name__ == "__main__":
    main()
