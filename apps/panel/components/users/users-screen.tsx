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
  Select,
  Table,
  Tag,
  Typography,
  type MenuProps,
  type TableColumnsType,
} from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import type { PaginatedUsers, User, UserRole } from "@/lib/api/users";
import { ROLE_LABELS } from "@/lib/theme";
import { EMAIL_MAX, NAME_MAX } from "@/lib/users/limits";
import {
  activateUserAction,
  updateUserAction,
  createUserAction,
  deactivateUserAction,
  resetUserMfaAction,
  resetUserPasswordAction,
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
  role: UserRole;
}

const USER_FORM_ID = "user-form";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "REVIEWER", label: ROLE_LABELS.REVIEWER },
  { value: "ADMIN", label: ROLE_LABELS.ADMIN },
];

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
  // Sube en cada apertura para montar un Form nuevo. Sin esto, si el modal
  // reabre sin haberse desmontado, el selector de rol muestra el valor anterior
  // y guardar le cambiaría el rol a otra persona.
  const [formKey, setFormKey] = useState(0);
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
    setFormKey((key) => key + 1);
    setModalOpen(true);
  }

  function openEdit(user: User) {
    setEditingUser(user);
    setModalError(null);
    setFormKey((key) => key + 1);
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
          role: values.role,
        })
      : await createUserAction({
          name: values.name,
          email: values.email,
          role: values.role,
        });

    setSaving(false);

    if (!result.ok) {
      setModalError(result.error ?? "Ocurrió un error inesperado.");
      return;
    }

    setModalOpen(false);
    if (editingUser) {
      message.success("Cambios guardados.");
    } else {
      notifyLink(result, `Usuario creado. Le enviamos a ${values.email} el enlace para activar su cuenta.`);
    }
  }

  /** El correo con el enlace puede fallar aunque la acción se haya guardado. */
  function notifyLink(result: UserActionResult, successMessage: string) {
    if (result.linkSent === false) {
      message.warning(
        "Se guardó el cambio, pero no pudimos enviar el correo. Usa “Reenviar enlace” para intentarlo de nuevo.",
        8,
      );
      return;
    }
    message.success(successMessage);
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
    notifyLink(result, successMessage);
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

  function confirmResetMfa(user: User) {
    modal.confirm({
      title: `¿Restablecer la verificación en dos pasos de ${user.name}?`,
      content:
        "Hazlo solo si perdió su autenticador y sus códigos de recuperación, y tras confirmar su identidad. Se cierran sus sesiones, su contraseña deja de servir y le enviamos un enlace para definir otra y configurar la verificación de nuevo.",
      okText: "Restablecer",
      okButtonProps: { danger: true },
      cancelText: "Cancelar",
      onOk: () =>
        runActiveChange(
          user,
          resetUserMfaAction,
          `Le enviamos a ${user.email} el enlace para volver a entrar.`,
        ),
    });
  }

  function confirmResetPassword(user: User) {
    const pending = !user.passwordSetAt;
    modal.confirm({
      title: pending
        ? `¿Reenviar el enlace de activación a ${user.name}?`
        : `¿Restablecer la contraseña de ${user.name}?`,
      content: pending
        ? "El enlace anterior deja de servir. El nuevo vence en 72 horas."
        : "Su contraseña deja de servir y se cierran sus sesiones. Le enviamos un enlace para que defina una nueva; nadie más la conocerá.",
      okText: pending ? "Reenviar" : "Restablecer",
      okButtonProps: { danger: !pending },
      cancelText: "Cancelar",
      onOk: () =>
        runActiveChange(
          user,
          resetUserPasswordAction,
          `Le enviamos a ${user.email} el enlace para definir su contraseña.`,
        ),
    });
  }

  function actionsFor(user: User): MenuProps["items"] {
    const isCurrentUser = user.id === currentUserId;
    return [
      { key: "edit", label: "Editar", onClick: () => openEdit(user) },
      // Sobre una cuenta desactivada no sirve: el enlace no la deja entrar.
      ...(user.active
        ? [
            {
              key: "reset-password",
              label: isCurrentUser
                ? "Para tu contraseña, usa “¿Olvidaste tu contraseña?”"
                : user.passwordSetAt
                  ? "Restablecer contraseña"
                  : "Reenviar enlace de activación",
              disabled: isCurrentUser,
              onClick: () => confirmResetPassword(user),
            },
          ]
        : []),
      ...(user.mfaEnabledAt
        ? [
            {
              key: "reset-mfa",
              label: isCurrentUser
                ? "Otro Aprobador debe restablecer tu verificación"
                : "Restablecer verificación en dos pasos",
              disabled: isCurrentUser,
              onClick: () => confirmResetMfa(user),
            },
          ]
        : []),
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
      title: "Rol",
      dataIndex: "role",
      key: "role",
      width: 120,
      render: (role: UserRole) => ROLE_LABELS[role] ?? role,
    },
    {
      title: "Estado",
      dataIndex: "active",
      key: "active",
      width: 180,
      render: (active: boolean, user) =>
        !active ? (
          <Tag>Inactivo</Tag>
        ) : user.passwordSetAt ? (
          <Tag color="green">Activo</Tag>
        ) : (
          <Tag color="gold">Pendiente de activar</Tag>
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
        scroll={{ x: 760 }}
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
        okButtonProps={{ htmlType: "submit", form: USER_FORM_ID }}
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
          key={formKey}
          id={USER_FORM_ID}
          layout="vertical"
          onFinish={submitForm}
          disabled={saving}
          // Cada apertura monta un Form con su propio estado (`formKey`), así
          // que los valores iniciales salen de aquí. clearOnDestroy no sirve:
          // con StrictMode borra también los initialValues recién cargados.
          initialValues={
            editingUser
              ? {
                  name: editingUser.name,
                  email: editingUser.email,
                  role: editingUser.role,
                }
              : { role: "REVIEWER" }
          }
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

          {!editingUser && (
            <Typography.Paragraph type="secondary">
              Le enviaremos un enlace a este correo para que defina su
              contraseña y active su cuenta. Nadie más la conocerá.
            </Typography.Paragraph>
          )}

          <Form.Item
            name="role"
            label="Rol"
            extra={
              editingUser
                ? "Si lo cambias, se cierran las sesiones abiertas de este usuario."
                : "El Aprobador puede hacer todo, incluido administrar usuarios."
            }
            rules={[{ required: true, message: "Elige un rol." }]}
          >
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
