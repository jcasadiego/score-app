"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, Layout, Menu, Typography } from "antd";
import { LogoutOutlined } from "@ant-design/icons";
import { accionCerrarSesion } from "@/lib/auth/actions";

const { Header, Sider, Content } = Layout;

interface AppShellProps {
  usuario: { email: string; rol: string };
  children: ReactNode;
}

export function AppShell({ usuario, children }: AppShellProps) {
  const pathname = usePathname();

  const itemsMenu = [
    { key: "/", label: <Link href="/">Inicio</Link> },
    { key: "/usuarios", label: <Link href="/usuarios">Usuarios</Link> },
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider breakpoint="lg" collapsedWidth={0}>
        <div
          style={{
            height: 48,
            margin: 16,
            color: "#fff",
            fontWeight: 600,
            fontSize: 16,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          SCORE — Panel
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[pathname]} items={itemsMenu} />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 16,
            paddingInline: 24,
          }}
        >
          <Typography.Text>{usuario.email}</Typography.Text>
          <Typography.Text type="secondary">({usuario.rol})</Typography.Text>
          <form action={accionCerrarSesion}>
            <Button icon={<LogoutOutlined />} htmlType="submit">
              Cerrar sesión
            </Button>
          </form>
        </Header>
        <Content style={{ margin: 24 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
