"use client";

import { useEffect, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  Space,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type {
  CalculationSummary,
  CalculationsPage,
  ScoringEngineStatus,
} from "@/lib/api/calculations";
import {
  CALCULATION_STATUS_COLORS,
  CALCULATION_STATUS_LABELS,
  ENGINE_DISABLED_MESSAGE,
  HIDDEN_OUTPUT_KEYS,
  OUTPUT_LABELS,
  POLL_DELAYS_MS,
  isCalculationInProgress,
} from "@/lib/diagnostics/calculation-labels";
import { LocalDate } from "@/components/local-date";
import {
  latestCalculationAction,
  requestCalculationAction,
} from "@/app/(panel)/diagnostics/actions";

export interface CalculationData {
  engine: ScoringEngineStatus;
  /** El vigente: el último exitoso. */
  current: CalculationSummary | null;
  /** El último intento, en cualquier estado. */
  latest: CalculationSummary | null;
  history: CalculationsPage;
}

function SimulatedTag() {
  return (
    <Tag color="volcano" style={{ fontWeight: 600 }}>
      SIMULADO
    </Tag>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return value.toLocaleString("es");
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  return String(value);
}

/**
 * La salida del motor, legible: cada clave con su nombre y los objetos
 * anidados (como las dimensiones) como etiquetas. Todo se muestra como texto.
 */
export function CalculationOutput({
  output,
}: {
  output: Record<string, unknown>;
}) {
  // Primero las claves conocidas, en el orden del brief; después el resto.
  const known = Object.keys(OUTPUT_LABELS);
  const rank = (key: string) =>
    known.includes(key) ? known.indexOf(key) : known.length;
  const entries = Object.entries(output)
    .filter(([key]) => !HIDDEN_OUTPUT_KEYS.has(key))
    .sort(([a], [b]) => rank(a) - rank(b));
  if (entries.length === 0) {
    return <Typography.Text type="secondary">Sin datos.</Typography.Text>;
  }
  return (
    <Descriptions
      size="small"
      bordered
      column={1}
      items={entries.map(([key, value]) => ({
        key,
        label: OUTPUT_LABELS[key] ?? key,
        children:
          value && typeof value === "object" && !Array.isArray(value) ? (
            <Space wrap size={[6, 6]}>
              {Object.entries(value as Record<string, unknown>).map(
                ([k, v]) => (
                  <Tag key={k}>
                    {k}: {formatValue(v)}
                  </Tag>
                ),
              )}
            </Space>
          ) : (
            <span style={{ overflowWrap: "anywhere" }}>
              {formatValue(value)}
            </span>
          ),
      }))}
    />
  );
}

function StatusTag({ calculation }: { calculation: CalculationSummary }) {
  return (
    <Tag color={CALCULATION_STATUS_COLORS[calculation.status]}>
      {CALCULATION_STATUS_LABELS[calculation.status]}
    </Tag>
  );
}

const HISTORY_COLUMNS: TableColumnsType<CalculationSummary> = [
  {
    title: "Pedido",
    dataIndex: "createdAt",
    key: "createdAt",
    render: (iso: string) => <LocalDate iso={iso} />,
  },
  {
    title: "Estado",
    key: "status",
    render: (_, calculation) => (
      <Space size={4} wrap>
        <StatusTag calculation={calculation} />
        {calculation.isSimulated && <SimulatedTag />}
      </Space>
    ),
  },
  {
    title: "Origen",
    key: "requestedBy",
    render: (_, calculation) =>
      calculation.requestedBy?.name ?? (
        <Typography.Text type="secondary">Al enviar el diagnóstico</Typography.Text>
      ),
  },
  {
    title: "Reglas",
    key: "ruleSetVersion",
    render: (_, calculation) =>
      calculation.ruleSetVersion ? `v${calculation.ruleSetVersion.number}` : "—",
  },
];

/**
 * Resultado del motor en el detalle del diagnóstico (PF-25): el cálculo
 * vigente, el estado del último intento si es otro, el historial y
 * recalcular. Mientras haya uno en curso consulta solo el último intento, y al
 * terminar recarga la pantalla una vez.
 */
export function CalculationSection({
  diagnosticId,
  data,
  canRecalculate = true,
  recalculateWarning,
}: {
  diagnosticId: string;
  data: CalculationData | null;
  /** La revisión lo oculta al Revisor en un caso aprobado (la API da 409). */
  canRecalculate?: boolean;
  /** Se suma a la confirmación, p. ej. que se anula la aprobación vigente. */
  recalculateWarning?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { modal, message } = App.useApp();
  const [requesting, startRequest] = useTransition();

  const latest = data?.latest ?? null;
  const inProgress = latest !== null && isCalculationInProgress(latest.status);
  const latestId = latest?.id;

  // Solo mientras hay un cálculo en curso, y se corta al salir de la pantalla.
  useEffect(() => {
    if (!inProgress || !latestId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (attempt: number) => {
      const result = await latestCalculationAction(diagnosticId);
      if (cancelled) return;
      const now = result.latest;
      if (
        result.ok &&
        (!now || now.id !== latestId || !isCalculationInProgress(now.status))
      ) {
        router.refresh();
        return;
      }
      if (attempt + 1 < POLL_DELAYS_MS.length) {
        timer = setTimeout(() => void check(attempt + 1), POLL_DELAYS_MS[attempt + 1]);
      }
    };
    timer = setTimeout(() => void check(0), POLL_DELAYS_MS[0]);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inProgress, latestId, diagnosticId, router]);

  if (!data) {
    return (
      <Card title="Resultado" size="small">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Todavía no hay resultado: el cliente aún no envía el diagnóstico."
        />
      </Card>
    );
  }

  const { engine, current, history } = data;
  const latestDiffers = latest !== null && latest.id !== current?.id;

  function request() {
    startRequest(async () => {
      const result = await requestCalculationAction(diagnosticId);
      if (result.ok) {
        message.info("Cálculo en curso. El resultado aparecerá aquí al terminar.");
      } else if (result.reason === "in-progress") {
        message.info("Ya hay un cálculo en curso para este diagnóstico.");
      } else {
        message.error(result.error ?? "No pudimos pedir el cálculo.");
      }
    });
  }

  function confirm() {
    modal.confirm({
      title: current ? "¿Recalcular el resultado?" : "¿Calcular el resultado?",
      content: [
        "Se pide un cálculo nuevo al motor con las respuestas actuales. El resultado anterior se conserva en el historial.",
        recalculateWarning,
      ]
        .filter(Boolean)
        .join(" "),
      okText: current ? "Recalcular" : "Calcular",
      cancelText: "Cancelar",
      onOk: request,
    });
  }

  const retry = latest?.status === "FAILED";

  return (
    <Card
      title="Resultado"
      size="small"
      extra={
        canRecalculate && (
          <Button
            icon={<ReloadOutlined />}
            onClick={confirm}
            loading={requesting}
            disabled={!engine.enabled || inProgress || requesting}
          >
            {retry ? "Reintentar" : current ? "Recalcular" : "Calcular"}
          </Button>
        )
      }
    >
      <Flex vertical gap={16}>
        {!engine.enabled && (
          <Alert type="info" showIcon title={ENGINE_DISABLED_MESSAGE} />
        )}

        {latestDiffers && latest && inProgress && (
          <Alert
            type="info"
            showIcon
            title="Hay un cálculo en curso."
            description={
              current
                ? "Mientras termina, se muestra el último resultado exitoso. Esta sección se actualiza sola."
                : "Esta sección se actualiza sola al terminar."
            }
          />
        )}
        {latestDiffers && latest?.status === "FAILED" && (
          <Alert
            type="warning"
            showIcon
            title="El último intento de cálculo falló."
            description={
              <>
                {latest.error ?? "El motor no devolvió un resultado."}
                {current && " Se muestra el último resultado exitoso."}
              </>
            }
          />
        )}

        {current?.output ? (
          <Flex vertical gap={8}>
            <Space wrap size={8}>
              <Typography.Text strong>Cálculo vigente</Typography.Text>
              {current.isSimulated && <SimulatedTag />}
              {current.ruleSetVersion && (
                <Tag>Reglas v{current.ruleSetVersion.number}</Tag>
              )}
              {current.finishedAt && (
                <Typography.Text type="secondary">
                  <LocalDate iso={current.finishedAt} />
                </Typography.Text>
              )}
            </Space>
            {current.isSimulated && (
              <Typography.Text type="secondary">
                Resultado del motor simulado de prueba: no es un resultado real
                de SCORE.
              </Typography.Text>
            )}
            <CalculationOutput output={current.output} />
          </Flex>
        ) : (
          !inProgress && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Este diagnóstico todavía no tiene un resultado del motor."
            />
          )
        )}

        {history.total > 0 && (
          <Flex vertical gap={8}>
            <Typography.Text strong>Historial de cálculos</Typography.Text>
            <Table<CalculationSummary>
              rowKey="id"
              size="small"
              columns={HISTORY_COLUMNS}
              dataSource={history.data}
              scroll={{ x: true }}
              expandable={{
                rowExpandable: (c) => c.output !== null || c.error !== null,
                expandedRowRender: (c) =>
                  c.output ? (
                    <CalculationOutput output={c.output} />
                  ) : (
                    <Typography.Text type="danger">{c.error}</Typography.Text>
                  ),
              }}
              pagination={{
                current: history.page,
                pageSize: history.pageSize,
                total: history.total,
                hideOnSinglePage: true,
                showSizeChanger: false,
                onChange: (page) =>
                  router.push(`${pathname}?calcPage=${page}`, { scroll: false }),
              }}
            />
          </Flex>
        )}
      </Flex>
    </Card>
  );
}
