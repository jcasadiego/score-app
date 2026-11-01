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
import type { PaginatedUsers, User } from "@/lib/api/users";
import { EMAIL_MAX, NAME_MAX, PASSWORD_MIN } from "@/lib/users/limits";
import {
  activateUserAction,
  updateUserAction,
  createUserAction,
  deactivateUserAction,
  type UserActionResult,
} from "@/app/(panel)/users/actions";
import { ReactiveSearch } from "@/components/reactive-search";

interface UsersScreenProps {
  page: PaginatedUsers;
  search: string;
  currentUserId: string;
}

interface UserFormValues {
  name: string;
  email: string;
  password?: string;
}

const pluralUsers = new Intl.PluralRules("es");

function totalText(total: number): string {
  const count = new Intl.NumberFormat("es").format(total);
  return `${count} ${pluralUsers.select(total) === "one" ? "usuario" : "usuarios"}`;
}

/**
 * Los datos llegan siempre del Server Component (página actual + total).
 * Las Server Actions llaman a `revalidatePath`, que devuelve el RSC
 * actualizado en la misma respuesta de la acción: no hay copia local de
 * la lista ni un segundo fetch para refrescarla.
 */
export function UsersScreen({
  page,
  search,
  currentUserId,
}: UsersScreenProps) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNavigation] = useTransition();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [form] = Form.useForm<UserFormValues>();
  // Vacía el buscador cuando la búsqueda se limpia desde fuera.
  const [searchReset, setSearchReset] = useState(0);

  /**
   * Cambia página/búsqueda en la URL (conserva el resto, p. ej. `data`).
   * `replace` no agrega una entrada al historial: es para la búsqueda
   * mientras se escribe.
   */
  function navigate(
    changes: { page?: number; q?: string },
    { replace = false } = {},
  ) {
    const params = new URLSearchParams(searchParams);
    if (changes.q !== undefined) {
      if (changes.q) params.set("q", changes.q);
      else params.delete("q");
    }
    const newPage = changes.page ?? 1;
    if (newPage > 1) params.set("page", String(newPage));
    else params.delete("page");

    const query = params.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    startNavigation(() => {
      if (replace) router.replace(target);
      else router.push(target);
    });
  }

  function clearSearch() {
    setSearchReset((n) => n + 1);
    navigate({ q: "" });
  }

  function openCreate() {
    setEditingUser(null);
    setModalError(null);
    setModalOpen(true);
  }

  function openEdit(user: User) {
    setEditingUser(user);
    setModalError(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
  }

  async function submitForm(values: UserFormValues) {
    setSaving(true);
    setModalError(null);

    const result = editingUser
      ? await updateUserAction(editingUser.id, {
          name: values.name,
          email: values.email,
          // Vacío = no se cambia.
          password: values.password || undefined,
        })
      : await createUserAction({
          name: values.name,
          email: values.email,
          password: values.password ?? "",
        });

    setSaving(false);

    if (!result.ok) {
      setModalError(result.error ?? "Ocurrió un error inesperado.");
      return;
    }

    setModalOpen(false);
    message.success(
      editingUser ? "Cambios guardados." : "Usuario creado.",
    );
  }

  async function runActiveChange(
    user: User,
    action: (id: string) => Promise<UserActionResult>,
    successMessage: string,
  ) {
    setPendingId(user.id);
    const result = await action(user.id);
    setPendingId(null);

    if (!result.ok) {
      message.error(result.error ?? "Ocurrió un error inesperado.");
      return;
    }
    message.success(successMessage);
  }

  function activate(user: User) {
    // Reversible y sin efecto sobre nadie más: no pide confirmación.
    void runActiveChange(
      user,
      activateUserAction,
      `${user.name} puede volver a entrar al panel.`,
    );
  }

  function confirmDeactivate(user: User) {
    modal.confirm({
      title: `¿Desactivar a ${user.name}?`,
      content:
        "Pierde acceso al panel de inmediato, incluida cualquier sesión ya iniciada. Puedes volver a activarlo después.",
      okText: "Desactivar",
      okButtonProps: { danger: true },
      cancelText: "Cancelar",
      onOk: () =>
        runActiveChange(
          user,
          deactivateUserAction,
          `${user.name} ya no tiene acceso.`,
        ),
    });
  }

  function actionsFor(user: User): MenuProps["items"] {
    const isCurrentUser = user.id === currentUserId;
    return [
      { key: "edit", label: "Editar", onClick: () => openEdit(user) },
      user.active
        ? {
            key: "deactivate",
            label: isCurrentUser
              ? "No puedes desactivar tu propia cuenta"
              : "Desactivar",
            danger: !isCurrentUser,
            disabled: isCurrentUser,
            onClick: () => confirmDeactivate(user),
          }
        : {
            key: "activate",
            label: "Activar",
            onClick: () => activate(user),
          },
    ];
  }

  const columns: TableColumnsType<User> = [
    {
      title: "Nombre",
      dataIndex: "name",
      key: "name",
      render: (name: string, user) => (
        <Flex gap={8} align="baseline">
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {name}
          </span>
          {user.id === currentUserId && (
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
      dataIndex: "active",
      key: "active",
      width: 110,
      render: (active: boolean) =>
        active ? (
          <Tag color="green">Activo</Tag>
        ) : (
          <Tag>Inactivo</Tag>
        ),
    },
    {
      title: <span className="sr-only">Acciones</span>,
      key: "actions",
      width: 64,
      align: "right",
      render: (_, user) => (
        <Dropdown
          menu={{ items: actionsFor(user) }}
          trigger={["click"]}
          placement="bottomRight"
        >
          <Button
            type="text"
            icon={<MoreOutlined />}
            aria-label={`Acciones para ${user.name}`}
            loading={pendingId === user.id}
          />
        </Dropdown>
      ),
    },
  ];

  const emptyState = search ? (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={`Ningún usuario coincide con “${search}”.`}
    >
      <Button onClick={clearSearch}>Limpiar búsqueda</Button>
    </Empty>
  ) : (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="Aún no hay usuarios."
    >
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
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
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Nuevo usuario
        </Button>
      </Flex>

      <ReactiveSearch
        resetKey={searchReset}
        initialValue={search}
        onSearch={(q) => navigate({ q }, { replace: true })}
        placeholder="Buscar por nombre o correo"
        ariaLabel="Buscar usuarios"
        loading={navigating}
        style={{ maxWidth: 360, marginBottom: 16 }}
      />

      <Table<User>
        rowKey="id"
        size="middle"
        dataSource={page.data}
        columns={columns}
        loading={navigating}
        scroll={{ x: 640 }}
        locale={{ emptyText: emptyState }}
        pagination={{
          current: page.page,
          pageSize: page.pageSize,
          total: page.total,
          showSizeChanger: false,
          hideOnSinglePage: true,
          showTotal: totalText,
          onChange: (nextPage) => navigate({ page: nextPage }),
        }}
      />

      <Modal
        title={editingUser ? "Editar usuario" : "Nuevo usuario"}
        open={modalOpen}
        onCancel={closeModal}
        confirmLoading={saving}
        onOk={() => form.submit()}
        okText={editingUser ? "Guardar" : "Crear"}
        cancelText="Cancelar"
        destroyOnHidden
      >
        {modalError && (
          <Alert
            type="error"
            showIcon
            title={modalError}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form<UserFormValues>
          form={form}
          layout="vertical"
          onFinish={submitForm}
          disabled={saving}
          // El Form se monta al abrir el modal (destroyOnHidden), así que los
          // valores iniciales salen de aquí y no de form.setFieldsValue, que
          // no tendría Form conectado. preserve={false} hace que, al volver a
          // montarse, cada campo tome los initialValues nuevos en vez de lo
          // que quedó de la apertura anterior (clearOnDestroy no sirve: con
          // StrictMode borra también los initialValues recién cargados).
          initialValues={
            editingUser
              ? { name: editingUser.name, email: editingUser.email }
              : undefined
          }
          preserve={false}
        >
          <Form.Item
            name="name"
            label="Nombre"
            rules={[
              { required: true, whitespace: true, message: "Ingresa el nombre." },
              { min: 2, message: "Debe tener al menos 2 caracteres." },
            ]}
          >
            <Input autoFocus maxLength={NAME_MAX} />
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

          <Form.Item
            name="password"
            label={editingUser ? "Nueva contraseña" : "Contraseña"}
            extra={
              editingUser
                ? "Déjala vacía para no cambiarla. Si la cambias, se cierran las sesiones abiertas de este usuario."
                : undefined
            }
            rules={[
              {
                required: !editingUser,
                message: "Ingresa una contraseña.",
              },
              {
                min: PASSWORD_MIN,
                message: `Debe tener al menos ${PASSWORD_MIN} caracteres.`,
              },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
