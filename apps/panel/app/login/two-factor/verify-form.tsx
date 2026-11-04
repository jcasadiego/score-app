"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { verifyMfaAction, type VerifyState } from "./actions";

const initialState: VerifyState = {};

export function VerifyForm() {
  const [state, formAction, pending] = useActionState(
    verifyMfaAction,
    initialState,
  );
  const [useRecovery, setUseRecovery] = useState(false);

  return (
    <Card>
      <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
        Verificación en dos pasos
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        {useRecovery
          ? "Ingresa uno de tus códigos de recuperación. Cada uno sirve una sola vez."
          : "Ingresa el código de 6 dígitos de tu app de autenticación."}
      </Typography.Paragraph>

      <form action={formAction}>
        <Form component={false} layout="vertical" disabled={pending}>
          {state.error && (
            <Form.Item>
              <Alert type="error" showIcon title={state.error} />
            </Form.Item>
          )}

          {useRecovery ? (
            <Form.Item
              label="Código de recuperación"
              htmlFor="mfa-recovery"
              required
            >
              <Input
                key="recovery"
                id="mfa-recovery"
                name="recoveryCode"
                required
                autoComplete="off"
                autoFocus
                maxLength={32}
              />
            </Form.Item>
          ) : (
            <Form.Item label="Código" htmlFor="mfa-code" required>
              <Input
                key="code"
                id="mfa-code"
                name="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
              />
            </Form.Item>
          )}

          <Form.Item style={{ marginBottom: 12 }}>
            <Button type="primary" htmlType="submit" block loading={pending}>
              Verificar
            </Button>
          </Form.Item>

          <Button
            type="link"
            block
            onClick={() => setUseRecovery((value) => !value)}
          >
            {useRecovery
              ? "Usar mi app de autenticación"
              : "No tengo mi app: usar un código de recuperación"}
          </Button>

          <Link href="/login">Volver al inicio de sesión</Link>
        </Form>
      </form>
    </Card>
  );
}
