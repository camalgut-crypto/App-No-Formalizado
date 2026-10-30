WITH Solicitudes AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY Cedula
            ORDER BY Fecha_creacion DESC, Num_Solicitud DESC
        ) AS RN
    FROM [GENESIS_REGIONAL].[dwh].[V_BIT_REGIONAL_COLOCACION_new]
    WHERE Fecha_creacion >= DATEADD(DAY, -35, GETDATE())
      AND IdPais = 2
      AND Cedula IS NOT NULL
)
SELECT
    U.Num_Solicitud,
    U.Cliente,
    U.Cedula,
    U.Tipo_Credito,
    U.Fecha_creacion,
    U.Monto_Solicitado,
    U.Monto_Tasa,
    U.Monto_Aprobado,
    U.Monto_Pagare,
    U.Estado,
    U.Suc_Origen,
    U.Categorizacion,
    U.Medio_Captacion,
    U.Telefono_Cliente,
    U.Correo_Cliente,
    P.Promotor
FROM Solicitudes U

OUTER APPLY (
    SELECT TOP 1
        CONCAT(
            T.usu_nombre, ' ',
            T.usu_apellido1, ' ',
            T.usu_apellido2
        ) AS Promotor
    FROM [SRV-TORTUGUERO\DATAWAREHOUSE].[GENESIS_REGIONAL].[dwh].[hech_solicitud_usuario] S
    INNER JOIN [SRV-TORTUGUERO\DATAWAREHOUSE].[GENESIS_REGIONAL].[dwh].[dim_t_usuario] T
        ON S.id_usuario = T.id_usuario
    WHERE S.id_m_solicitud = U.Num_Solicitud
      AND S.id_pais = 2
      AND T.id_pais = 2
    ORDER BY S.id_usuario
) P

WHERE U.RN = 1
  AND U.Estado LIKE '%TUD%'
  AND U.Estado <> 'TUD REASIGNACION'
  AND U.Monto_Solicitado > 2
  AND (
        U.Categorizacion = 'REESTRUCTURACION'
        OR NOT EXISTS (
            SELECT 1
            FROM [GENESIS_REGIONAL].[dwh].[V_BIT_REGIONAL_COLOCACION_new] F
            WHERE F.Num_Solicitud = U.Num_Solicitud
              AND F.IdPais = U.IdPais
              AND F.Estado = 'FORMALIZADO'
        )
      )
ORDER BY U.Fecha_creacion ASC;