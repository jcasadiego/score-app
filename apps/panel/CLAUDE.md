@AGENTS.md

## Lecciones de PRs anteriores (no repetir)

- **Escapar con `encodeURIComponent`** todo id que se interpole en una
  ruta de la api desde una Server Action (`../` apuntaba a otro endpoint
  con el mismo token, #10).
- **Modales con `Form` de Ant Design:** no compartir `Form.useForm` entre
  aperturas ni confiar en que `destroyOnHidden` desmonte a tiempo: un selector
  mostró el rol de la apertura anterior, y guardar habría degradado a otra
  persona (PF-48). Cada apertura monta un `Form` nuevo con `key`, y el botón lo
  envía con `form={id}`. Los valores van en `initialValues`. Descartados:
  `forceRender` (error de hidratación) y `clearOnDestroy` (con StrictMode borra
  los `initialValues`) (#16).
- No copiar datos del servidor a `useState`: la Server Action +
  `revalidatePath` ya devuelve el RSC actualizado (#13). Colores solo
  desde `lib/theme.ts`, sin hex sueltos.
- **CSP con nonce (`proxy.ts`):** las páginas deben ser dinámicas (por eso
  `force-dynamic` en el layout raíz): una estática queda sin scripts. Los estilos
  no llevan nonce, porque anularía el `'unsafe-inline'` que Ant Design necesita.
  Probar con `pnpm build && next start -p 3002`: sin `-p`, toma el puerto de la api.
- Revisar la consola del navegador (avisos de Ant Design, hidratación)
  antes de dar por buena una pantalla — así se detectó #16.
