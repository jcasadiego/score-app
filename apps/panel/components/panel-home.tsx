"use client";

import { Typography } from "antd";

interface PanelHomeProps {
  email: string;
}

export function PanelHome({ email }: PanelHomeProps) {
  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Bienvenido
      </Typography.Title>
      <Typography.Paragraph>
        Sesión iniciada como <strong>{email}</strong>.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        Los módulos de revisión de casos se irán agregando aquí. El
        siguiente es Usuarios.
      </Typography.Paragraph>
    </div>
  );
}
