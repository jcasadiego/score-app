-- Agrega la familia Evento (antes los eventos llegaban como PROFESSIONAL).
-- Solo agrega un valor: no toca filas ni rompe el código que sigue corriendo.
ALTER TYPE "diagnostic_family" ADD VALUE IF NOT EXISTS 'EVENT';
