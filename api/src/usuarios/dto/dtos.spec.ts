import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrearUsuarioDto } from './crear-usuario.dto';
import { ListarUsuariosDto } from './listar-usuarios.dto';

describe('DTOs de usuarios', () => {
  it('normaliza espacios en nombre y recorta el email', async () => {
    const dto = plainToInstance(CrearUsuarioDto, {
      name: '  Sam   Lee ',
      email: ' sam@example.com ',
      password: 'password123',
    });

    expect(dto.name).toBe('Sam Lee');
    expect(dto.email).toBe('sam@example.com');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rechaza un nombre más largo que el límite', async () => {
    const dto = plainToInstance(CrearUsuarioDto, {
      name: 'a'.repeat(121),
      email: 'a@example.com',
      password: 'password123',
    });

    const errores = await validate(dto);
    expect(errores.map((e) => e.property)).toContain('name');
  });

  it('aplica valores por defecto y convierte la paginación a número', async () => {
    const vacio = plainToInstance(ListarUsuariosDto, {});
    expect(vacio).toMatchObject({ page: 1, pageSize: 20 });

    const dto = plainToInstance(ListarUsuariosDto, {
      page: '3',
      pageSize: '500',
    });
    expect(dto.page).toBe(3);
    const errores = await validate(dto);
    expect(errores.map((e) => e.property)).toEqual(['pageSize']);
  });
});
