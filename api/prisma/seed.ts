import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Crea el primer usuario ADMIN si todavía no existe. Necesario porque
 * `UsuariosController` (POST /usuarios) exige estar ya autenticado como
 * ADMIN — sin este seed no hay forma de entrar al panel por primera vez.
 * Idempotente: si el email ya existe, no le toca el password.
 */
async function main() {
  const email = requerirEnv('ADMIN_EMAIL');
  const password = requerirEnv('ADMIN_PASSWORD');
  const nombre = requerirEnv('ADMIN_NOMBRE');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const passwordHash = await argon2.hash(password);

  const usuario = await prisma.usuario.upsert({
    where: { email },
    update: {},
    create: { nombre, email, passwordHash, activo: true },
  });

  console.log(`Usuario admin listo: ${usuario.email} (${usuario.id})`);

  await prisma.$disconnect();
}

function requerirEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(
      `Falta la variable de entorno ${nombre} para correr el seed`,
    );
  }
  return valor;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
