"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Flex,
  Form,
  Input,
  QRCode,
  Typography,
} from "antd";
import type { MfaEnrollment } from "@/lib/api/auth";
import { HOME_ROUTE } from "@/lib/auth/constants";
import {
  confirmEnrollmentAction,
  startEnrollmentAction,
  type ConfirmState,
} from "../actions";

const initialConfirmState: ConfirmState = {};

/**
 * El secreto se pide con un botón y no al cargar: cada pedido lo reemplaza, y una
 * recarga no debe invalidar lo que ya se escaneó.
 */
export function SetupFlow() {
  const [enrollment, setEnrollment] = useState<MfaEnrollment>();
  const [startError, setStartError] = useState<string>();
  const [starting, startTransition] = useTransition();
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmEnrollmentAction,
    initialConfirmState,
  );

  function start() {
    startTransition(async () => {
      const result = await startEnrollmentAction();
      setEnrollment(result.enrollment);
      setStartError(result.error);
    });
  }

  if (confirmState.recoveryCodes) {
    return <RecoveryCodes codes={confirmState.recoveryCodes} />;
  }

  return (
    <Card>
      <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
        Protege tu cuenta
      </Typography.Title>

      {!enrollment ? (
        <>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
            El panel exige verificación en dos pasos. Necesitas una app de
            autenticación en tu teléfono, como Google Authenticator, Microsoft
            Authenticator o 1Password.
          </Typography.Paragraph>
          {startError && (
            <Alert
              type="error"
              showIcon
              title={startError}
              style={{ marginBottom: 16 }}
            />
          )}
          <Button type="primary" block loading={starting} onClick={start}>
            Configurar
          </Button>
        </>
      ) : (
        <>
          <Typography.Paragraph type="secondary">
            Escanea este código con tu app. Si no puedes, escribe la clave a
            mano.
          </Typography.Paragraph>
          <Flex justify="center" style={{ marginBottom: 16 }}>
            <QRCode value={enrollment.otpauthUri} size={200} />
          </Flex>
          <Typography.Paragraph
            copyable
            code
            style={{ overflowWrap: "anywhere", textAlign: "center" }}
          >
            {enrollment.secret}
          </Typography.Paragraph>

          <form action={confirmAction}>
            <Form component={false} layout="vertical" disabled={confirming}>
              {confirmState.error && (
                <Form.Item>
                  <Alert type="error" showIcon title={confirmState.error} />
                </Form.Item>
              )}
              <Form.Item
                label="Código de 6 dígitos que muestra la app"
                htmlFor="mfa-setup-code"
                required
              >
                <Input
                  id="mfa-setup-code"
                  name="code"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoFocus
                />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  loading={confirming}
                >
                  Activar
                </Button>
              </Form.Item>
            </Form>
          </form>
        </>
      )}
    </Card>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);

  // Recargar lleva al panel y los códigos no se pueden volver a pedir.
  useEffect(() => {
    if (saved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saved]);

  return (
    <Card>
      <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
        Guarda tus códigos de recuperación
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Te permiten entrar si pierdes el teléfono. Cada uno sirve una sola vez y
        no se volverán a mostrar. Guárdalos en un gestor de contraseñas.
      </Typography.Paragraph>
      <Typography.Paragraph copyable={{ text: codes.join("\n") }}>
        <pre style={{ margin: 0 }}>{codes.join("\n")}</pre>
      </Typography.Paragraph>
      <Checkbox
        checked={saved}
        onChange={(event) => setSaved(event.target.checked)}
        style={{ marginBottom: 16 }}
      >
        Ya los guardé en un lugar seguro
      </Checkbox>
      <Button
        type="primary"
        block
        disabled={!saved}
        onClick={() => router.replace(HOME_ROUTE)}
      >
        Continuar al panel
      </Button>
    </Card>
  );
}
