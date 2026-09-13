"use client";

import { useActionState } from "react";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { accionLogin, type EstadoLogin } from "./actions";

const estadoInicial: EstadoLogin = {};

export function FormularioLogin() {
  const [estado, accionFormulario, pendiente] = useActionState(
    accionLogin,
    estadoInicial,
  );

  return (
    <Card>
      <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
        Panel SCORE
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Inicia sesión con tu cuenta del equipo Music Finance Pro.
      </Typography.Paragraph>

      <form action={accionFormulario}>
        <Form component={false} layout="vertical" disabled={pendiente}>
          {estado.error && (
            <Form.Item>
              <Alert type="error" showIcon title={estado.error} />
            </Form.Item>
          )}

          <Form.Item label="Correo" required>
            <Input
              name="email"
              type="email"
              required
              autoComplete="username"
              autoFocus
              prefix={<UserOutlined />}
              placeholder="tucorreo@musicfinancepro.com"
            />
          </Form.Item>

          <Form.Item label="Contraseña" required>
            <Input.Password
              name="password"
              required
              autoComplete="current-password"
              prefix={<LockOutlined />}
              placeholder="••••••••"
            />
          </Form.Item>

          <Form.Item style={{ marginTop: 24, marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={pendiente}>
              Iniciar sesión
            </Button>
          </Form.Item>
        </Form>
      </form>
    </Card>
  );
}
