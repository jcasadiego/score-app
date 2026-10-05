"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { Usuario } from "@/lib/api/usuarios";
import {
  accionActivarUsuario,
  accionActualizarUsuario,
  accionCrearUsuario,
  accionDesactivarUsuario,
} from "@/app/(panel)/usuarios/actions";

interface UsuariosScreenProps {
  usuariosIniciales: Usuario[];
  usuarioActualId: string;
}

interface ValoresFormulario {
  nombre: string;
  email: string;
  password?: string;
}

export function UsuariosScreen({
  usuariosIniciales,
  usuarioActualId,
}: UsuariosScreenProps) {
  const [usuarios, setUsuarios] = useState(usuariosIniciales);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [usuarioEnEdicion, setUsuarioEnEdicion] = useState<Usuario | null>(
    null,
  );
  const [guardando, setGuardando] = useState(false);
  const [idEnProceso, setIdEnProceso] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [errorTabla, setErrorTabla] = useState<string | null>(null);
  const [form] = Form.useForm<ValoresFormulario>();

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

  function reemplazarUsuario(usuario: Usuario) {
    setUsuarios((actual) => {
      const existe = actual.some((u) => u.id === usuario.id);
      if (existe) {
        return actual.map((u) => (u.id === usuario.id ? usuario : u));
      }
      return [...actual, usuario];
    });
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

    if (!resultado.ok || !resultado.usuario) {
      setErrorModal(resultado.error ?? "Ocurrió un error inesperado.");
      return;
    }

    reemplazarUsuario(resultado.usuario);
    setModalAbierto(false);
  }

  async function cambiarActivo(usuario: Usuario) {
    setIdEnProceso(usuario.id);
    setErrorTabla(null);

    const resultado = usuario.activo
      ? await accionDesactivarUsuario(usuario.id)
      : await accionActivarUsuario(usuario.id);

    setIdEnProceso(null);

    if (!resultado.ok || !resultado.usuario) {
      setErrorTabla(resultado.error ?? "Ocurrió un error inesperado.");
      return;
    }

    reemplazarUsuario(resultado.usuario);
  }

  const columnas = [
    { title: "Nombre", dataIndex: "nombre", key: "nombre" },
    { title: "Correo", dataIndex: "email", key: "email" },
    { title: "Rol", dataIndex: "rol", key: "rol" },
    {
      title: "Estado",
      dataIndex: "activo",
      key: "activo",
      render: (activo: boolean) =>
        activo ? (
          <Tag color="green">Activo</Tag>
        ) : (
          <Tag color="red">Inactivo</Tag>
        ),
    },
    {
      title: "Acciones",
      key: "acciones",
      render: (_: unknown, usuario: Usuario) => {
        const esUsuarioActual = usuario.id === usuarioActualId;

        return (
          <Space>
            <Button size="small" onClick={() => abrirEditar(usuario)}>
              Editar
            </Button>
            {esUsuarioActual ? (
              <Tooltip title="No puedes desactivar tu propia cuenta.">
                <Button size="small" disabled>
                  Desactivar
                </Button>
              </Tooltip>
            ) : (
              <Popconfirm
                title={
                  usuario.activo ? "¿Desactivar usuario?" : "¿Activar usuario?"
                }
                description={
                  usuario.activo
                    ? "Pierde acceso al panel de inmediato, incluida cualquier sesión ya iniciada."
                    : "Recupera acceso al panel de inmediato."
                }
                okText={usuario.activo ? "Desactivar" : "Activar"}
                okButtonProps={{ danger: usuario.activo }}
                cancelText="Cancelar"
                onConfirm={() => cambiarActivo(usuario)}
              >
                <Button
                  size="small"
                  danger={usuario.activo}
                  loading={idEnProceso === usuario.id}
                >
                  {usuario.activo ? "Desactivar" : "Activar"}
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Space
        style={{
          marginBottom: 16,
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <Typography.Title level={3} style={{ margin: 0 }}>
          Usuarios
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={abrirCrear}>
          Nuevo usuario
        </Button>
      </Space>

      {errorTabla && (
        <Alert
          type="error"
          showIcon
          title={errorTabla}
          closable={{ onClose: () => setErrorTabla(null) }}
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<Usuario>
        rowKey="id"
        dataSource={usuarios}
        columns={columnas}
        pagination={false}
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
            rules={[{ required: true, message: "Ingresa el nombre." }]}
          >
            <Input autoFocus />
          </Form.Item>

          <Form.Item
            name="email"
            label="Correo"
            rules={[
              { required: true, message: "Ingresa el correo." },
              { type: "email", message: "Ingresa un correo válido." },
            ]}
          >
            <Input />
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
