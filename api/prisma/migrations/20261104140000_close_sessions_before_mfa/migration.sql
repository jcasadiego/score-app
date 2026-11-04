-- Con MFA obligatorio, una sesión abierta antes no pasó por el segundo factor y
-- podría seguir renovándose hasta 7 días. Se cierran todas: un solo paso.
DELETE FROM "user_sessions";
