"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Avatar,
  Button,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Typography,
  theme,
  type MenuProps,
} from "antd";
import { DownOutlined, LogoutOutlined, MenuOutlined } from "@ant-design/icons";
import { accionCerrarSesion } from "@/lib/auth/actions";
import { ETIQUETAS_ROL } from "@/lib/tema";

const { Header, Sider, Content } = Layout;

interface AppShellProps {
  usuario: { email: string; rol: string };
  children: ReactNode;
}

const ITEMS_MENU = [
  { key: "/usuarios", label: <Link href="/usuarios">Usuarios</Link> },
];

export function AppShell({ usuario, children }: AppShellProps) {
  const pathname = usePathname();
  const { token } = theme.useToken();
  const pantallas = Grid.useBreakpoint();
  const [colapsado, setColapsado] = useState(false);
  const [cerrandoSesion, iniciarCierre] = useTransition();

  const rol = ETIQUETAS_ROL[usuario.rol] ?? usuario.rol;
  const inicial = Array.from(usuario.email)[0]?.toUpperCase() ?? "?";

  const itemsCuenta: MenuProps["items"] = [
    {
      key: "identidad",
      type: "group",
      label: (
        <div style={{ maxWidth: 260 }}>
          <Typography.Text
            strong
            style={{ display: "block", overflowWrap: "anywhere" }}
          >
            {usuario.email}
          </Typography.Text>
          <Typography.Text type="secondary">{rol}</Typography.Text>
        </div>
      ),
    },
    { type: "divider" },
    {
      key: "cerrar-sesion",
      icon: <LogoutOutlined />,
      label: "Cerrar sesión",
      disabled: cerrandoSesion,
      onClick: () => iniciarCierre(() => accionCerrarSesion()),
    },
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        breakpoint="lg"
        collapsedWidth={0}
        collapsed={colapsado}
        onBreakpoint={setColapsado}
        trigger={null}
      >
        <div
          style={{
            height: 64,
            paddingInline: 24,
            display: "flex",
            alignItems: "center",
            color: token.colorWhite,
            fontWeight: 600,
            fontSize: token.fontSizeLG,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
          }}
        >
          SCORE
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[pathname]}
          items={ITEMS_MENU}
          onClick={() => {
            if (!pantallas.lg) setColapsado(true);
          }}
        />
      </Sider>
      <Layout style={{ minWidth: 0 }}>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            borderBottom: `1px solid ${token.colorSplit}`,
          }}
        >
          {colapsado && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              aria-label="Abrir menú"
              onClick={() => setColapsado(false)}
            />
          )}
          <div style={{ flex: 1 }} />
          <Dropdown
            menu={{ items: itemsCuenta }}
            trigger={["click"]}
            placement="bottomRight"
          >
            <Button
              type="text"
              aria-label="Cuenta"
              style={{ height: 40, paddingInline: 8, maxWidth: "100%" }}
            >
              <Avatar
                size="small"
                style={{ background: token.colorPrimary, flexShrink: 0 }}
              >
                {inicial}
              </Avatar>
              {pantallas.md && (
                <Typography.Text ellipsis style={{ maxWidth: 220 }}>
                  {usuario.email}
                </Typography.Text>
              )}
              <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
        </Header>
        <Content style={{ padding: 24, minWidth: 0 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
