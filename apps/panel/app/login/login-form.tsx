"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm({ notice }: { notice?: string }) {
  const [state, formAction, pending] = useActionState(
    loginAction,
    initialState,
  );

  return (
    <Card>
      <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
        Panel SCORE
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Inicia sesión con tu cuenta del equipo Music Finance Pro.
      </Typography.Paragraph>

      <form action={formAction}>
        <Form component={false} layout="vertical" disabled={pending}>
          {notice && !state.error && (
            <Form.Item>
              <Alert type="success" showIcon title={notice} />
            </Form.Item>
          )}

          {state.error && (
            <Form.Item>
              <Alert type="error" showIcon title={state.error} />
            </Form.Item>
          )}

          <Form.Item label="Correo" htmlFor="login-email" required>
            <Input
              id="login-email"
              name="email"
              type="email"
              required
              autoComplete="username"
              autoFocus
              prefix={<UserOutlined />}
              placeholder="tucorreo@musicfinancepro.com"
            />
          </Form.Item>

          <Form.Item label="Contraseña" htmlFor="login-password" required>
            <Input.Password
              id="login-password"
              name="password"
              required
              autoComplete="current-password"
              prefix={<LockOutlined />}
              placeholder="••••••••"
            />
          </Form.Item>

          <Link href="/forgot-password">¿Olvidaste tu contraseña?</Link>

          <Form.Item style={{ marginTop: 24, marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={pending}>
              Iniciar sesión
            </Button>
          </Form.Item>
        </Form>
      </form>
    </Card>
  );
}
