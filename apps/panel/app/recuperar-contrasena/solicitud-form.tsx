"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Alert, Button, Card, Form, Input, Result, Typography } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { EMAIL_MAX } from "@/lib/usuarios/limites";
import { accionSolicitarRecuperacion } from "./actions";

export function FormularioSolicitud() {
  const [pendiente, iniciarTransicion] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  function enviar({ email }: { email: string }) {
    setError(null);
    iniciarTransicion(async () => {
      const resultado = await accionSolicitarRecuperacion(email);
      if (resultado.ok) {
        setEnviado(true);
      } else {
        setError(resultado.error ?? "Ocurrió un error inesperado.");
      }
    });
  }

  if (enviado) {
    // Mismo mensaje exista o no el correo: no delata qué cuentas existen.
    return (
      <Card>
        <Result
          status="success"
          title="Revisa tu correo"
          subTitle="Si el correo está registrado, te enviamos un enlace para restablecer la contraseña. Vence en 1 hora."
          extra={
            <Button type="primary" href="/login">
              Volver al inicio de sesión
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
        Recuperar contraseña
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Escribe el correo de tu cuenta y te enviaremos un enlace para elegir una
        contraseña nueva.
      </Typography.Paragraph>

      <Form layout="vertical" onFinish={enviar} disabled={pendiente}>
        {error && (
          <Form.Item>
            <Alert type="error" showIcon title={error} />
          </Form.Item>
        )}

        <Form.Item
          name="email"
          label="Correo"
          rules={[
            { required: true, message: "Ingresa tu correo." },
            { type: "email", message: "Ingresa un correo válido." },
          ]}
        >
          <Input
            type="email"
            maxLength={EMAIL_MAX}
            autoComplete="username"
            autoFocus
            prefix={<UserOutlined />}
            placeholder="tucorreo@musicfinancepro.com"
          />
        </Form.Item>

        <Form.Item style={{ marginTop: 24, marginBottom: 8 }}>
          <Button type="primary" htmlType="submit" block loading={pendiente}>
            Enviar enlace
          </Button>
        </Form.Item>
        <Link href="/login">Volver al inicio de sesión</Link>
      </Form>
    </Card>
  );
}
