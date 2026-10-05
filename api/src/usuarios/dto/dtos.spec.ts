import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrearUsuarioDto } from './crear-usuario.dto';
import { ListarUsuariosDto } from './listar-usuarios.dto';

describe('DTOs de usuarios', () => {
  it('normaliza espacios en nombre y recorta el email', async () => {
    const dto = plainToInstance(CrearUsuarioDto, {
      nombre: '  Sam   Lee ',
      email: ' sam@example.com ',
      password: 'password123',
    });

    expect(dto.nombre).toBe('Sam Lee');
    expect(dto.email).toBe('sam@example.com');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza un nombre más largo que el límite', async () => {
    const dto = plainToInstance(CrearUsuarioDto, {
      nombre: 'a'.repeat(121),
      email: 'a@example.com',
      password: 'password123',
    });

    const errores = await validate(dto);
    expect(errores.map((e) => e.property)).toContain('nombre');
  });

  it('aplica valores por defecto y convierte la paginación a número', async () => {
    const vacio = plainToInstance(ListarUsuariosDto, {});
    expect(vacio).toMatchObject({ pagina: 1, tamano: 20 });

    const dto = plainToInstance(ListarUsuariosDto, {
      pagina: '3',
      tamano: '500',
    });
    expect(dto.pagina).toBe(3);
    const errores = await validate(dto);
    expect(errores.map((e) => e.property)).toEqual(['tamano']);
  });
});
