"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  Button,
  Empty,
  Flex,
  Skeleton,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import type { CrmSyncEvent, PaginatedCrmSyncEvents } from "@/lib/api/crm";
import {
  CRM_EVENT_STATUS_COLORS,
  CRM_EVENT_STATUS_LABELS,
  CRM_EVENT_TYPE_LABELS,
  CRM_SYNC_STATUS_COLORS,
  CRM_SYNC_STATUS_LABELS,
  crmErrorMessage,
  type CrmSyncStatus,
} from "@/lib/crm/labels";
import { LocalDate } from "@/components/local-date";
import { retryCrmSyncEventAction } from "@/app/(panel)/leads/actions";

interface CrmSectionProps {
  leadId: string;
  syncStatus: CrmSyncStatus | null;
  events: PaginatedCrmSyncEvents | null;
  eventsError?: string;
  /** `null` si no se pudo saber qué CRM está configurado. */
  simulated: boolean | null;
  /** Mientras llega del servidor la página pedida (o el lead recién abierto). */
  loading: boolean;
  onPageChange: (page: number) => void;
}

export function CrmSyncStatusTag({ status }: { status: CrmSyncStatus | null }) {
  if (!status) {
    return <Typography.Text type="secondary">Sin envíos</Typography.Text>;
  }
  return (
    <Tag color={CRM_SYNC_STATUS_COLORS[status]} style={{ marginInlineEnd: 0 }}>
      {CRM_SYNC_STATUS_LABELS[status]}
    </Tag>
  );
}

/**
 * Un envío fallido detiene los siguientes del mismo lead: el CRM los recibe en
 * orden (PF-80). La lista viene del más reciente al más antiguo, así que los
 * que esperan son los `PENDING` que están antes en la página.
 */
function blocksLaterEvents(events: CrmSyncEvent[], index: number): boolean {
  return events.slice(0, index).some((e) => e.status === "PENDING");
}

/**
 * Envíos de un lead al CRM (PF-81). Ambos roles ven y reintentan; la API lo
 * valida igual. Nada técnico en pantalla: ni token, ni ids de la cuenta, ni el
 * estado HTTP, solo el mensaje traducido del código de error.
 */
export function CrmSection({
  leadId,
  syncStatus,
  events,
  eventsError,
  simulated,
  loading,
  onPageChange,
}: CrmSectionProps) {
  const { message } = App.useApp();
  const router = useRouter();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retrying, startRetry] = useTransition();
  const [refreshing, startRefresh] = useTransition();

  function retry(event: CrmSyncEvent) {
    setRetryingId(event.id);
    startRetry(async () => {
      const result = await retryCrmSyncEventAction(leadId, event.id);
      if (result.ok) {
        message.success("Listo: el envío volvió a la cola.");
      } else {
        message.error(result.error);
      }
      setRetryingId(null);
    });
  }

  const data = events?.data ?? [];
  const failedIds = data.filter((e) => e.status === "FAILED").map((e) => e.id);

  const columns: TableColumnsType<CrmSyncEvent> = [
    {
      title: "Paso",
      dataIndex: "type",
      key: "type",
      render: (type: CrmSyncEvent["type"]) => CRM_EVENT_TYPE_LABELS[type],
    },
    {
      title: "Estado",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (status: CrmSyncEvent["status"]) => (
        <Tag
          color={CRM_EVENT_STATUS_COLORS[status]}
          style={{ marginInlineEnd: 0 }}
        >
          {CRM_EVENT_STATUS_LABELS[status]}
        </Tag>
      ),
    },
    {
      title: "Fecha",
      key: "date",
      width: 170,
      render: (_, event) => <LocalDate iso={event.sentAt ?? event.createdAt} />,
    },
    {
      title: "Intentos",
      dataIndex: "attempts",
      key: "attempts",
      width: 90,
      align: "right",
    },
  ];

  return (
    <div>
      <Flex
        justify="space-between"
        align="center"
        gap={8}
        style={{ marginBottom: 8 }}
      >
        <Typography.Text type="secondary">CRM</Typography.Text>
        <Button
          size="small"
          type="link"
          loading={refreshing}
          onClick={() => startRefresh(() => router.refresh())}
        >
          Actualizar
        </Button>
      </Flex>

      <Flex vertical gap={12}>
        {simulated && (
          <Alert
            type="info"
            showIcon
            title="CRM en modo simulado: los datos no salen de SCORE."
          />
        )}

        <div>
          <CrmSyncStatusTag status={syncStatus} />
        </div>

        {eventsError ? (
          <Alert type="error" showIcon title={eventsError} />
        ) : !events ? (
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        ) : (
          <Table<CrmSyncEvent>
            rowKey="id"
            size="small"
            dataSource={data}
            columns={columns}
            loading={loading}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Este lead todavía no tiene envíos al CRM."
                />
              ),
            }}
            // El detalle del error va siempre abierto bajo cada envío fallido.
            expandable={{
              expandedRowKeys: failedIds,
              showExpandColumn: false,
              rowExpandable: (event) => event.status === "FAILED",
              expandedRowRender: (event, index) => (
                <Flex vertical gap={8} align="flex-start">
                  <Typography.Text type="danger">
                    {crmErrorMessage(event.lastErrorCode)}
                  </Typography.Text>
                  {blocksLaterEvents(data, index) && (
                    <Typography.Text type="secondary">
                      Los envíos siguientes esperan a que este se reintente.
                    </Typography.Text>
                  )}
                  <Button
                    size="small"
                    loading={retrying && retryingId === event.id}
                    disabled={retrying && retryingId !== event.id}
                    onClick={() => retry(event)}
                  >
                    Reintentar
                  </Button>
                </Flex>
              ),
            }}
            pagination={{
              current: events.page,
              pageSize: events.pageSize,
              total: events.total,
              showSizeChanger: false,
              hideOnSinglePage: true,
              onChange: onPageChange,
            }}
          />
        )}
      </Flex>
    </div>
  );
}
