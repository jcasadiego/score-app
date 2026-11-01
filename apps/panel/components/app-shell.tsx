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
import { logoutAction } from "@/lib/auth/actions";
import { ROLE_LABELS } from "@/lib/theme";

const { Header, Sider, Content } = Layout;

interface AppShellProps {
  user: { email: string; role: string };
  children: ReactNode;
}

const MENU_ITEMS = [
  { key: "/leads", label: <Link href="/leads">Leads</Link> },
  { key: "/users", label: <Link href="/users">Usuarios</Link> },
];

export function AppShell({ user, children }: AppShellProps) {
  const pathname = usePathname();
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, startLogout] = useTransition();

  const role = ROLE_LABELS[user.role] ?? user.role;
  const initial = Array.from(user.email)[0]?.toUpperCase() ?? "?";

  const accountItems: MenuProps["items"] = [
    {
      key: "identity",
      type: "group",
      label: (
        <div style={{ maxWidth: 260 }}>
          <Typography.Text
            strong
            style={{ display: "block", overflowWrap: "anywhere" }}
          >
            {user.email}
          </Typography.Text>
          <Typography.Text type="secondary">{role}</Typography.Text>
        </div>
      ),
    },
    { type: "divider" },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "Cerrar sesión",
      disabled: loggingOut,
      onClick: () => startLogout(() => logoutAction()),
    },
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        breakpoint="lg"
        collapsedWidth={0}
        collapsed={collapsed}
        onBreakpoint={setCollapsed}
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
          items={MENU_ITEMS}
          onClick={() => {
            if (!screens.lg) setCollapsed(true);
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
          {collapsed && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              aria-label="Abrir menú"
              onClick={() => setCollapsed(false)}
            />
          )}
          <div style={{ flex: 1 }} />
          <Dropdown
            menu={{ items: accountItems }}
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
                {initial}
              </Avatar>
              {screens.md && (
                <Typography.Text ellipsis style={{ maxWidth: 220 }}>
                  {user.email}
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
