"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  Button,
  Card,
  Divider,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Space,
  Tag,
  Typography,
} from "antd";
import type { Flag, FlagsList } from "@/lib/api/flags";
import {
  AI_FLAG_TITLE,
  ANALYSIS_FAILURE_LABELS,
  FLAG_SEVERITY_COLORS,
  FLAG_SEVERITY_LABELS,
  FLAG_SEVERITY_ORDER,
  FLAG_SOURCE_LABELS,
  FLAG_STATUS_COLORS,
  FLAG_STATUS_LABELS,
  REVIEW_NOTE_MAX,
  isAnalysisInProgress,
} from "@/lib/diagnostics/flag-labels";
import { POLL_DELAYS_MS } from "@/lib/diagnostics/calculation-labels";
import { LocalDate } from "@/components/local-date";
import {
  flagAnalysisInProgressAction,
  requestFlagAnalysisAction,
  reviewFlagAction,
} from "@/app/(panel)/diagnostics/actions";

/** `list` nulo con `error`: no se pudieron cargar. */
export interface FlagsData {
  list: FlagsList | null;
  error?: string;
}

/** Id del elemento de cada pregunta en la sección Respuestas. */
export function questionAnchor(questionId: string): string {
  return `question-${questionId}`;
}

/** La IA ya antepone "Posible contradicción": el título lo dice. */
function displayMessage(flag: Flag): string {
  if (flag.source !== "AI") return flag.message;
  const text = flag.message.replace(/^posible contradicci[oó]n:\s*/i, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type ReviewTarget = { flag: Flag; status: "REVIEWED" | "DISMISSED" };

/**
 * Marcar revisada (nota opcional) o descartar (nota obligatoria). Cada
 * apertura monta un `Form` nuevo (`key`), y el botón lo envía con `form`
 * (CLAUDE.md 9, PF-48).
 */
function ReviewModal({
  target,
  pending,
  onCancel,
  onSubmit,
}: {
  target: ReviewTarget | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}) {
  const dismissing = target?.status === "DISMISSED";
  const formId = "flag-review-form";
  return (
    <Modal
      open={target !== null}
      title={dismissing ? "Descartar alerta" : "Marcar alerta como revisada"}
      onCancel={onCancel}
      destroyOnHidden
      mask={{ closable: !pending }}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>,
        <Button
          key="submit"
          type="primary"
          htmlType="submit"
          form={formId}
          loading={pending}
        >
          {dismissing ? "Descartar" : "Marcar revisada"}
        </Button>,
      ]}
    >
      {target && (
        <Form
          key={`${target.flag.id}-${target.status}`}
          id={formId}
          layout="vertical"
          initialValues={{ note: "" }}
          onFinish={({ note }: { note: string }) => onSubmit(note)}
        >
          <Typography.Paragraph type="secondary">
            {dismissing
              ? "Explica por qué no aplica: queda registrada junto a quién la descartó."
              : "Puedes dejar una nota de lo que verificaste."}
          </Typography.Paragraph>
          <Form.Item
            name="note"
            label={dismissing ? "Nota (obligatoria)" : "Nota (opcional)"}
            rules={
              dismissing
                ? [
                    {
                      required: true,
                      whitespace: true,
                      message: "Escribe por qué la descartas.",
                    },
                  ]
                : []
            }
          >
            <Input.TextArea
              rows={4}
              maxLength={REVIEW_NOTE_MAX}
              showCount
              autoFocus
            />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}

function FlagItem({
  flag,
  busy,
  onReview,
  onReopen,
}: {
  flag: Flag;
  busy: boolean;
  onReview: (status: "REVIEWED" | "DISMISSED") => void;
  onReopen: () => void;
}) {
  return (
    <Flex vertical gap={8} style={{ minWidth: 0 }}>
      <Flex justify="space-between" align="start" gap={8} wrap>
        <Space wrap size={[4, 4]}>
          <Tag color={FLAG_SEVERITY_COLORS[flag.severity]}>
            Severidad {FLAG_SEVERITY_LABELS[flag.severity].toLowerCase()}
          </Tag>
          <Tag>{FLAG_SOURCE_LABELS[flag.source]}</Tag>
          <Tag color={FLAG_STATUS_COLORS[flag.status]}>
            {FLAG_STATUS_LABELS[flag.status]}
          </Tag>
        </Space>
        <Space wrap size={8}>
          {flag.status === "OPEN" ? (
            <>
              <Button
                size="small"
                disabled={busy}
                onClick={() => onReview("REVIEWED")}
              >
                Marcar revisada
              </Button>
              <Button
                size="small"
                disabled={busy}
                onClick={() => onReview("DISMISSED")}
              >
                Descartar
              </Button>
            </>
          ) : (
            <Button size="small" disabled={busy} onClick={onReopen}>
              Reabrir
            </Button>
          )}
        </Space>
      </Flex>

      <Typography.Text strong>
        {flag.source === "AI" ? AI_FLAG_TITLE : "Alerta del motor de cálculo"}
      </Typography.Text>
      {/* Texto plano: puede reflejar lo que escribió el cliente. */}
      <Typography.Paragraph
        style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 0 }}
      >
        {displayMessage(flag)}
      </Typography.Paragraph>

      {flag.questions.length > 0 && (
        <Flex vertical gap={2}>
          <Typography.Text type="secondary">Preguntas involucradas:</Typography.Text>
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            {flag.questions.map((question) => (
              <li key={question.id}>
                <Typography.Link
                  href={`#${questionAnchor(question.id)}`}
                  style={{ overflowWrap: "anywhere" }}
                >
                  {question.text}
                </Typography.Link>
              </li>
            ))}
          </ul>
        </Flex>
      )}

      {flag.status !== "OPEN" && flag.reviewedAt && (
        <Typography.Text type="secondary" style={{ overflowWrap: "anywhere" }}>
          {FLAG_STATUS_LABELS[flag.status]}
          {flag.reviewedBy && ` por ${flag.reviewedBy.name}`} ·{" "}
          <LocalDate iso={flag.reviewedAt} />
          {flag.reviewNote && (
            <>
              {": "}
              <span style={{ whiteSpace: "pre-wrap" }}>{flag.reviewNote}</span>
            </>
          )}
        </Typography.Text>
      )}
    </Flex>
  );
}

/** Estado del análisis con IA. Nunca dice "sin alertas" si no terminó bien. */
function AnalysisStatus({
  list,
  retrying,
  onRetry,
}: {
  list: FlagsList;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { analysis } = list;
  if (!analysis) {
    return (
      <Alert
        type="info"
        showIcon
        title="Este resultado no tiene análisis con IA."
        description="Es anterior a las alertas. Puedes pedirlo ahora."
        action={
          <Button size="small" loading={retrying} onClick={onRetry}>
            Analizar
          </Button>
        }
      />
    );
  }
  if (analysis.status === "PENDING") {
    return (
      <Alert
        type="info"
        showIcon
        title="Análisis con IA pendiente."
        description="Empieza en cuanto la IA esté disponible. Mientras tanto puede haber posibles contradicciones sin detectar. Esta sección se actualiza sola."
      />
    );
  }
  if (analysis.status === "RUNNING") {
    return (
      <Alert
        type="info"
        showIcon
        title="Análisis con IA en curso."
        description="Esta sección se actualiza sola al terminar."
      />
    );
  }
  if (analysis.status === "FAILED") {
    const reason =
      (analysis.failureReason &&
        ANALYSIS_FAILURE_LABELS[analysis.failureReason]) ??
      "ocurrió un error inesperado";
    return (
      <Alert
        type="warning"
        showIcon
        title={`El análisis con IA falló: ${reason}.`}
        description="Puede haber posibles contradicciones sin detectar. Las alertas del motor se muestran igual."
        action={
          <Button size="small" loading={retrying} onClick={onRetry}>
            Reintentar
          </Button>
        }
      />
    );
  }
  return (
    <Space wrap size={8}>
      <Typography.Text type="secondary">
        Análisis con IA completo
        {analysis.finishedAt && (
          <>
            {" · "}
            <LocalDate iso={analysis.finishedAt} />
          </>
        )}
      </Typography.Text>
      {analysis.isSimulated && (
        <Tag color="volcano" style={{ fontWeight: 600 }}>
          SIMULADO
        </Tag>
      )}
    </Space>
  );
}

/**
 * Alertas del cálculo vigente en el detalle del diagnóstico (PF-35): flags del
 * motor y posibles contradicciones de la IA, para revisar o descartar. Mientras
 * el análisis está en curso consulta solo su estado, y al terminar recarga la
 * pantalla una vez.
 */
export function FlagsSection({
  diagnosticId,
  data,
}: {
  diagnosticId: string;
  /** Nulo si el diagnóstico todavía no se envió. */
  data: FlagsData | null;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [target, setTarget] = useState<ReviewTarget | null>(null);
  const [saving, startSaving] = useTransition();
  const [retrying, startRetry] = useTransition();

  const list = data?.list ?? null;
  const calculationId = list?.calculationId ?? null;
  const inProgress =
    list?.analysis != null && isAnalysisInProgress(list.analysis.status);

  useEffect(() => {
    if (!inProgress || !calculationId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (attempt: number) => {
      const result = await flagAnalysisInProgressAction(calculationId);
      if (cancelled) return;
      if (result.ok && !result.inProgress) {
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
  }, [inProgress, calculationId, router]);

  if (!data) {
    return (
      <Card title="Alertas" size="small">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Todavía no hay alertas: el cliente aún no envía el diagnóstico."
        />
      </Card>
    );
  }

  if (!list) {
    return (
      <Card title="Alertas" size="small">
        <Alert
          type="error"
          showIcon
          title={data.error ?? "No pudimos cargar las alertas. Recarga la página."}
        />
      </Card>
    );
  }

  function save(flag: Flag, status: Flag["status"], note: string) {
    startSaving(async () => {
      const result = await reviewFlagAction(diagnosticId, flag.id, status, note);
      if (result.ok) {
        setTarget(null);
        message.success(
          status === "OPEN"
            ? "Alerta reabierta."
            : status === "DISMISSED"
              ? "Alerta descartada."
              : "Alerta marcada como revisada.",
        );
      } else {
        message.error(result.error ?? "No pudimos guardar el cambio.");
      }
    });
  }

  function retry() {
    if (!calculationId) return;
    startRetry(async () => {
      const result = await requestFlagAnalysisAction(diagnosticId, calculationId);
      if (result.ok) {
        message.info("Análisis en curso. Las alertas aparecerán aquí al terminar.");
      } else {
        message.error(result.error ?? "No pudimos reintentar el análisis.");
      }
    });
  }

  const flags = [...list.flags].sort(
    (a, b) => FLAG_SEVERITY_ORDER[a.severity] - FLAG_SEVERITY_ORDER[b.severity],
  );
  const analysisSucceeded = list.analysis?.status === "SUCCEEDED";

  return (
    <Card
      title="Alertas"
      size="small"
      extra={
        list.openCount > 0 && (
          <Tag color="red" style={{ marginInlineEnd: 0 }}>
            {list.openCount === 1 ? "1 abierta" : `${list.openCount} abiertas`}
          </Tag>
        )
      }
    >
      {!calculationId ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Las alertas aparecen cuando el diagnóstico tiene un resultado del motor."
        />
      ) : (
        <Flex vertical gap={16}>
          <AnalysisStatus list={list} retrying={retrying} onRetry={retry} />

          {flags.length === 0 ? (
            analysisSucceeded ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Sin alertas: el análisis terminó y no encontró nada que revisar."
              />
            ) : null
          ) : (
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {flags.map((flag, index) => (
                <li key={flag.id}>
                  {index > 0 && <Divider style={{ margin: "12px 0" }} />}
                  <FlagItem
                    flag={flag}
                    busy={saving}
                    onReview={(status) => setTarget({ flag, status })}
                    onReopen={() => save(flag, "OPEN", "")}
                  />
                </li>
              ))}
            </ol>
          )}
        </Flex>
      )}

      <ReviewModal
        target={target}
        pending={saving}
        onCancel={() => !saving && setTarget(null)}
        onSubmit={(note) => target && save(target.flag, target.status, note)}
      />
    </Card>
  );
}
