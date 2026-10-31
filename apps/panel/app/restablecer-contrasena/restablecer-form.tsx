"use client";

import { useEffect, useState, useTransition } from "react";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { PASSWORD_MIN } from "@/lib/usuarios/limites";
import {
  accionRestablecerContrasena,
  type ResultadoRestablecer,
} from "./actions";

interface Valores {
  password: string;
  confirmacion: string;
}

export function FormularioRestablecer({ token }: { token: string }) {
  const [pendiente, iniciarTransicion] = useTransition();
  const [resultado, setResultado] = useState<ResultadoRestablecer | null>(null);

  // Saca el token de la barra de direcciones y del historial: ya está en
  // memoria y no hace falta que quede a la vista.
  useEffect(() => {
    window.history.replaceState(null, "", "/restablecer-contrasena");
  }, []);

  function enviar({ password }: Valores) {
    setResultado(null);
    iniciarTransicion(async () => {
      // Si sale bien, la acción redirige al login.
      setResultado(await accionRestablecerContrasena(token, password));
    });
  }

  if (resultado?.enlaceInvalido) {
    return <EnlaceInvalido mensaje={resultado.error} />;
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
      <Form layout="vertical" onFinish={enviar} disabled={pendiente}>
        {resultado && (
          <Form.Item>
            <Alert type="error" showIcon title={resultado.error} />
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
          name="confirmacion"
          label="Confirma la contraseña"
          dependencies={["password"]}
          rules={[
            { required: true, message: "Vuelve a escribir la contraseña." },
            ({ getFieldValue }) => ({
              validator: (_, valor) =>
                !valor || valor === getFieldValue("password")
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
          <Button type="primary" htmlType="submit" block loading={pendiente}>
            Guardar contraseña
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

export function EnlaceInvalido({ mensaje }: { mensaje: string }) {
  return (
    <Card>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Enlace no válido
      </Typography.Title>
      <Alert type="warning" showIcon title={mensaje} />
      <Button
        type="primary"
        block
        href="/recuperar-contrasena"
        style={{ marginTop: 24 }}
      >
        Pedir un enlace nuevo
      </Button>
    </Card>
  );
}
