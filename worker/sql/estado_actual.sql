-- Estado actual de las solicitudes que salieron de la base ({ids} lo reemplaza el proceso con números de solicitud).
-- Fecha_Formalizado: después de formalizar el estado avanza (EXPEDIENTE DIGITALIZADO, AUDITADO…), por eso no basta el estado.
-- Tiene_Nueva = 1 si la cédula tiene una solicitud más reciente (el ROW_NUMBER de la consulta principal la reemplaza).
SELECT DISTINCT
    V.Num_Solicitud,
    V.Estado,
    V.Fecha_creacion,
    V.Fecha_Formalizado,
    CASE WHEN EXISTS (
        SELECT 1
        FROM [GENESIS_REGIONAL].[dwh].[V_BIT_REGIONAL_COLOCACION_new] N
        WHERE N.Cedula = V.Cedula
          AND N.IdPais = V.IdPais
          AND N.Num_Solicitud <> V.Num_Solicitud
          AND (N.Fecha_creacion > V.Fecha_creacion
               OR (N.Fecha_creacion = V.Fecha_creacion AND N.Num_Solicitud > V.Num_Solicitud))
    ) THEN 1 ELSE 0 END AS Tiene_Nueva
FROM [GENESIS_REGIONAL].[dwh].[V_BIT_REGIONAL_COLOCACION_new] V
WHERE V.IdPais = 2
  AND V.Num_Solicitud IN ({ids});
