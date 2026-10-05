"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  App,
  Button,
  Dropdown,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Table,
  Tag,
  Typography,
  type MenuProps,
  type TableColumnsType,
} from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import type { PaginaUsuarios, Usuario } from "@/lib/api/usuarios";
import { EMAIL_MAX, NOMBRE_MAX } from "@/lib/usuarios/limites";
import {
  accionActivarUsuario,
  accionActualizarUsuario,
  accionCrearUsuario,
  accionDesactivarUsuario,
  type ResultadoAccionUsuario,
} from "@/app/(panel)/usuarios/actions";

interface UsuariosScreenProps {
  pagina: PaginaUsuarios;
  busqueda: string;
  usuarioActualId: string;
}

interface ValoresFormulario {
  nombre: string;
  email: string;
  password?: string;
}

const pluralUsuarios = new Intl.PluralRules("es");

function textoTotal(total: number): string {
  const cantidad = new Intl.NumberFormat("es").format(total);
  return `${cantidad} ${pluralUsuarios.select(total) === "one" ? "usuario" : "usuarios"}`;
}

/**
 * Los datos llegan siempre del Server Component (página actual + total).
 * Las Server Actions llaman a `revalidatePath`, que devuelve el RSC
 * actualizado en la misma respuesta de la acción: no hay copia local de
 * la lista ni un segundo fetch para refrescarla.
 */
export function UsuariosScreen({
  pagina,
  busqueda,
  usuarioActualId,
}: UsuariosScreenProps) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navegando, iniciarNavegacion] = useTransition();

  const [modalAbierto, setModalAbierto] = useState(false);
  const [usuarioEnEdicion, setUsuarioEnEdicion] = useState<Usuario | null>(
    null,
  );
  const [guardando, setGuardando] = useState(false);
  const [idEnProceso, setIdEnProceso] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [form] = Form.useForm<ValoresFormulario>();

  /** Cambia página/búsqueda en la URL (conserva el resto, p. ej. `data`). */
  function navegar(cambios: { pagina?: number; q?: string }) {
    const params = new URLSearchParams(searchParams);
    if (cambios.q !== undefined) {
      if (cambios.q) params.set("q", cambios.q);
      else params.delete("q");
    }
    const nuevaPagina = cambios.pagina ?? 1;
    if (nuevaPagina > 1) params.set("pagina", String(nuevaPagina));
    else params.delete("pagina");

    const query = params.toString();
    iniciarNavegacion(() => {
      router.push(query ? `${pathname}?${query}` : pathname);
    });
  }

  function abrirCrear() {
    setUsuarioEnEdicion(null);
    form.resetFields();
    setErrorModal(null);
    setModalAbierto(true);
  }

  function abrirEditar(usuario: Usuario) {
    setUsuarioEnEdicion(usuario);
    form.setFieldsValue({ nombre: usuario.nombre, email: usuario.email });
    setErrorModal(null);
    setModalAbierto(true);
  }

  function cerrarModal() {
    if (guardando) return;
    setModalAbierto(false);
  }

  async function enviarFormulario(valores: ValoresFormulario) {
    setGuardando(true);
    setErrorModal(null);

    const resultado = usuarioEnEdicion
      ? await accionActualizarUsuario(usuarioEnEdicion.id, {
          nombre: valores.nombre,
          email: valores.email,
        })
      : await accionCrearUsuario({
          nombre: valores.nombre,
          email: valores.email,
          password: valores.password ?? "",
        });

    setGuardando(false);

    if (!resultado.ok) {
      setErrorModal(resultado.error ?? "Ocurrió un error inesperado.");
      return;
    }

    setModalAbierto(false);
    message.success(
      usuarioEnEdicion ? "Cambios guardados." : "Usuario creado.",
    );
  }

  async function ejecutarCambioActivo(
    usuario: Usuario,
    accion: (id: string) => Promise<ResultadoAccionUsuario>,
    exito: string,
  ) {
    setIdEnProceso(usuario.id);
    const resultado = await accion(usuario.id);
    setIdEnProceso(null);

    if (!resultado.ok) {
      message.error(resultado.error ?? "Ocurrió un error inesperado.");
      return;
    }
    message.success(exito);
  }

  function activar(usuario: Usuario) {
    // Reversible y sin efecto sobre nadie más: no pide confirmación.
    void ejecutarCambioActivo(
      usuario,
      accionActivarUsuario,
      `${usuario.nombre} puede volver a entrar al panel.`,
    );
  }

  function confirmarDesactivar(usuario: Usuario) {
    modal.confirm({
      title: `¿Desactivar a ${usuario.nombre}?`,
      content:
        "Pierde acceso al panel de inmediato, incluida cualquier sesión ya iniciada. Puedes volver a activarlo después.",
      okText: "Desactivar",
      okButtonProps: { danger: true },
      cancelText: "Cancelar",
      onOk: () =>
        ejecutarCambioActivo(
          usuario,
          accionDesactivarUsuario,
          `${usuario.nombre} ya no tiene acceso.`,
        ),
    });
  }

  function accionesDe(usuario: Usuario): MenuProps["items"] {
    const esUsuarioActual = usuario.id === usuarioActualId;
    return [
      { key: "editar", label: "Editar", onClick: () => abrirEditar(usuario) },
      usuario.activo
        ? {
            key: "desactivar",
            label: esUsuarioActual
              ? "No puedes desactivar tu propia cuenta"
              : "Desactivar",
            danger: !esUsuarioActual,
            disabled: esUsuarioActual,
            onClick: () => confirmarDesactivar(usuario),
          }
        : {
            key: "activar",
            label: "Activar",
            onClick: () => activar(usuario),
          },
    ];
  }

  const columnas: TableColumnsType<Usuario> = [
    {
      title: "Nombre",
      dataIndex: "nombre",
      key: "nombre",
      render: (nombre: string, usuario) => (
        <Flex gap={8} align="baseline">
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {nombre}
          </span>
          {usuario.id === usuarioActualId && (
            <Tag style={{ flexShrink: 0, marginInlineEnd: 0 }}>Tú</Tag>
          )}
        </Flex>
      ),
    },
    {
      title: "Correo",
      dataIndex: "email",
      key: "email",
      render: (email: string) => (
        <span style={{ overflowWrap: "anywhere" }}>{email}</span>
      ),
    },
    {
      title: "Estado",
      dataIndex: "activo",
      key: "activo",
      width: 110,
      render: (activo: boolean) =>
        activo ? (
          <Tag color="green">Activo</Tag>
        ) : (
          <Tag>Inactivo</Tag>
        ),
    },
    {
      title: <span className="sr-only">Acciones</span>,
      key: "acciones",
      width: 64,
      align: "right",
      render: (_, usuario) => (
        <Dropdown
          menu={{ items: accionesDe(usuario) }}
          trigger={["click"]}
          placement="bottomRight"
        >
          <Button
            type="text"
            icon={<MoreOutlined />}
            aria-label={`Acciones para ${usuario.nombre}`}
            loading={idEnProceso === usuario.id}
          />
        </Dropdown>
      ),
    },
  ];

  const vacio = busqueda ? (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={`Ningún usuario coincide con “${busqueda}”.`}
    >
      <Button onClick={() => navegar({ q: "" })}>Limpiar búsqueda</Button>
    </Empty>
  ) : (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="Aún no hay usuarios."
    >
      <Button type="primary" icon={<PlusOutlined />} onClick={abrirCrear}>
        Nuevo usuario
      </Button>
    </Empty>
  );

  return (
    <div>
      <Flex
        justify="space-between"
        align="center"
        gap={16}
        wrap
        style={{ marginBottom: 16 }}
      >
        <Typography.Title
          level={3}
          style={{ margin: 0, letterSpacing: "-0.01em" }}
        >
          Usuarios
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={abrirCrear}>
          Nuevo usuario
        </Button>
      </Flex>

      <Input.Search
        key={busqueda}
        defaultValue={busqueda}
        placeholder="Buscar por nombre o correo"
        aria-label="Buscar usuarios"
        allowClear
        maxLength={100}
        loading={navegando}
        onSearch={(valor) => navegar({ q: valor.trim() })}
        style={{ maxWidth: 360, marginBottom: 16 }}
      />

      <Table<Usuario>
        rowKey="id"
        size="middle"
        dataSource={pagina.datos}
        columns={columnas}
        loading={navegando}
        scroll={{ x: 640 }}
        locale={{ emptyText: vacio }}
        pagination={{
          current: pagina.pagina,
          pageSize: pagina.tamano,
          total: pagina.total,
          showSizeChanger: false,
          hideOnSinglePage: true,
          showTotal: textoTotal,
          onChange: (nueva) => navegar({ pagina: nueva }),
        }}
      />

      <Modal
        title={usuarioEnEdicion ? "Editar usuario" : "Nuevo usuario"}
        open={modalAbierto}
        onCancel={cerrarModal}
        confirmLoading={guardando}
        onOk={() => form.submit()}
        okText={usuarioEnEdicion ? "Guardar" : "Crear"}
        cancelText="Cancelar"
        destroyOnHidden
      >
        {errorModal && (
          <Alert
            type="error"
            showIcon
            title={errorModal}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form<ValoresFormulario>
          form={form}
          layout="vertical"
          onFinish={enviarFormulario}
          disabled={guardando}
        >
          <Form.Item
            name="nombre"
            label="Nombre"
            rules={[
              { required: true, whitespace: true, message: "Ingresa el nombre." },
              { min: 2, message: "Debe tener al menos 2 caracteres." },
            ]}
          >
            <Input autoFocus maxLength={NOMBRE_MAX} />
          </Form.Item>

          <Form.Item
            name="email"
            label="Correo"
            rules={[
              { required: true, message: "Ingresa el correo." },
              { type: "email", message: "Ingresa un correo válido." },
            ]}
          >
            <Input maxLength={EMAIL_MAX} autoComplete="off" />
          </Form.Item>

          {!usuarioEnEdicion && (
            <Form.Item
              name="password"
              label="Contraseña"
              rules={[
                { required: true, message: "Ingresa una contraseña." },
                { min: 8, message: "Debe tener al menos 8 caracteres." },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
