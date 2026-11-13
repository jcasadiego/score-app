"use client";

import { Card, Space, Table, Tag, Typography, type TableColumnsType } from "antd";
import type { ReportDelivery } from "@/lib/api/reports";
import { LocalDate } from "@/components/local-date";

export type DeliveryRow = ReportDelivery & {
  /** Calculado en el servidor al cargar la página. */
  linkStatus: "ACTIVE" | "REVOKED" | "EXPIRED";
};

const LINK_STATUS: Record<DeliveryRow["linkStatus"], { label: string; color: string }> = {
  ACTIVE: { label: "Vigente", color: "green" },
  REVOKED: { label: "Revocado", color: "default" },
  EXPIRED: { label: "Vencido", color: "default" },
};

/**
 * Registro de entregas (PF-43): cuándo, a quién, quién la envió y si el cliente
 * descargó. El correo de destino solo se muestra aquí y al confirmar la entrega.
 */
export function DeliveriesCard({ deliveries }: { deliveries: DeliveryRow[] }) {
  const columns: TableColumnsType<DeliveryRow> = [
    {
      title: "Enviado",
      key: "createdAt",
      width: 170,
      render: (_, delivery) => <LocalDate iso={delivery.createdAt} />,
    },
    {
      title: "Para",
      key: "recipient",
      render: (_, delivery) => (
        <span style={{ overflowWrap: "anywhere" }}>{delivery.recipientEmail}</span>
      ),
    },
    {
      title: "Envió",
      key: "deliveredBy",
      width: 180,
      render: (_, delivery) => delivery.deliveredBy.name,
    },
    {
      title: "Enlace",
      key: "link",
      width: 200,
      render: (_, { link, linkStatus }) => (
        <Space size={4} wrap>
          <Tag color={LINK_STATUS[linkStatus].color} style={{ marginInlineEnd: 0 }}>
            {LINK_STATUS[linkStatus].label}
          </Tag>
          {linkStatus === "ACTIVE" && (
            <Typography.Text type="secondary">
              hasta <LocalDate iso={link.expiresAt} />
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: "Descargas",
      key: "downloads",
      width: 200,
      render: (_, { link }) =>
        link.downloads === 0 ? (
          <Typography.Text type="secondary">Sin descargar</Typography.Text>
        ) : (
          <Space size={4} wrap>
            <span>{link.downloads === 1 ? "1 descarga" : `${link.downloads} descargas`}</span>
            {link.lastDownloadAt && (
              <Typography.Text type="secondary">
                última <LocalDate iso={link.lastDownloadAt} />
              </Typography.Text>
            )}
          </Space>
        ),
    },
  ];

  return (
    <Card title="Entregas al cliente" size="small">
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={deliveries}
        pagination={false}
        scroll={{ x: "max-content" }}
      />
    </Card>
  );
}
