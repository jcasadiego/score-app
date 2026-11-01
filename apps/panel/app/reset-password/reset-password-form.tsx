"use client";

import { useEffect, useState, useTransition } from "react";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { PASSWORD_MIN } from "@/lib/users/limits";
import {
  confirmPasswordResetAction,
  type ResetPasswordResult,
} from "./actions";

interface FormValues {
  password: string;
  confirmation: string;
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ResetPasswordResult | null>(null);

  // Saca el token de la barra de direcciones y del historial: ya está en
  // memoria y no hace falta que quede a la vista.
  useEffect(() => {
    window.history.replaceState(null, "", "/reset-password");
  }, []);

  function submit({ password }: FormValues) {
    setResult(null);
    startTransition(async () => {
      // Si sale bien, la acción redirige al login.
      setResult(await confirmPasswordResetAction(token, password));
    });
  }

  if (result?.invalidLink) {
    return <InvalidLink message={result.error} />;
  }

  return (
    <Card>
      <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
        Elige una contraseña nueva
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Al guardarla se cerrarán las sesiones que tengas abiertas.
      </Typography.Paragraph>

      {/* Ant Form conserva lo escrito si la API rechaza el cambio. */}
      <Form layout="vertical" onFinish={submit} disabled={pending}>
        {result && (
          <Form.Item>
            <Alert type="error" showIcon title={result.error} />
          </Form.Item>
        )}

        <Form.Item
          name="password"
          label="Contraseña nueva"
          rules={[
            { required: true, message: "Ingresa la contraseña nueva." },
            {
              min: PASSWORD_MIN,
              message: `Debe tener al menos ${PASSWORD_MIN} caracteres.`,
            },
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            autoFocus
            prefix={<LockOutlined />}
          />
        </Form.Item>

        <Form.Item
          name="confirmation"
          label="Confirma la contraseña"
          dependencies={["password"]}
          rules={[
            { required: true, message: "Vuelve a escribir la contraseña." },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || value === getFieldValue("password")
                  ? Promise.resolve()
                  : Promise.reject(new Error("Las contraseñas no coinciden.")),
            }),
          ]}
        >
          <Input.Password
            autoComplete="new-password"
            prefix={<LockOutlined />}
          />
        </Form.Item>

        <Form.Item style={{ marginTop: 24, marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" block loading={pending}>
            Guardar contraseña
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

export function InvalidLink({ message }: { message: string }) {
  return (
    <Card>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Enlace no válido
      </Typography.Title>
      <Alert type="warning" showIcon title={message} />
      <Button
        type="primary"
        block
        href="/forgot-password"
        style={{ marginTop: 24 }}
      >
        Pedir un enlace nuevo
      </Button>
    </Card>
  );
}
