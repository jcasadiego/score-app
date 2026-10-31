import {
  CorreoRenderizado,
  OpcionesMarca,
  renderizarPlantillaBase,
} from './plantilla-base';

export interface DatosCorreoEnlace {
  nombre: string;
  enlace: string;
}

// TODO: textos provisionales — reemplazar cuando el cliente apruebe la
// redacción definitiva de los dos correos (PF-19, "Preparación").

export function correoDiagnosticoEnlace(
  datos: DatosCorreoEnlace,
  marca?: OpcionesMarca,
): CorreoRenderizado {
  return renderizarPlantillaBase(
    {
      asunto: 'Tu diagnóstico SCORE',
      titulo: `Hola, ${datos.nombre}`,
      parrafos: [
        'Ya puedes responder tu diagnóstico SCORE. Entra con el botón de abajo: no necesitas crear usuario ni contraseña.',
        'Puedes pausar y retomar cuando quieras desde este mismo enlace mientras siga vigente.',
      ],
      boton: { texto: 'Empezar mi diagnóstico', url: datos.enlace },
      nota: 'Este enlace es personal: no lo reenvíes. Si vence, puedes pedir uno nuevo desde la plataforma.',
    },
    marca,
  );
}

export function correoRecuperarEnlace(
  datos: DatosCorreoEnlace,
  marca?: OpcionesMarca,
): CorreoRenderizado {
  return renderizarPlantillaBase(
    {
      asunto: 'Recupera tu enlace de SCORE',
      titulo: `Hola, ${datos.nombre}`,
      parrafos: [
        'Recibimos una solicitud para recuperar el acceso a tu diagnóstico SCORE. Usa el botón de abajo para continuar donde lo dejaste.',
      ],
      boton: { texto: 'Continuar mi diagnóstico', url: datos.enlace },
      nota: 'Si no pediste este correo, puedes ignorarlo: tu diagnóstico sigue igual.',
    },
    marca,
  );
}

export function correoRestablecerContrasena(
  datos: DatosCorreoEnlace,
  marca?: OpcionesMarca,
): CorreoRenderizado {
  return renderizarPlantillaBase(
    {
      asunto: 'Restablece tu contraseña del panel SCORE',
      titulo: `Hola, ${datos.nombre}`,
      parrafos: [
        'Recibimos una solicitud para restablecer la contraseña de tu cuenta del panel SCORE. Usa el botón de abajo para elegir una nueva.',
        'El enlace sirve una sola vez y vence en 1 hora. Al cambiar la contraseña se cierran las sesiones que tengas abiertas.',
      ],
      boton: { texto: 'Restablecer contraseña', url: datos.enlace },
      nota: 'Si no pediste este cambio, ignora este correo: tu contraseña sigue igual.',
    },
    marca,
  );
}
