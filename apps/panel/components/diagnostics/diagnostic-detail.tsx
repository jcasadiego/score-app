"use client";

import Link from "next/link";
import {
  Breadcrumb,
  Card,
  Descriptions,
  Divider,
  Empty,
  Flex,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import type {
  DiagnosticDetail as Diagnostic,
  DiagnosticQuestion,
} from "@/lib/api/diagnostics";
import {
  ACCESS_LINK_ORIGIN_LABELS,
  PLATFORM_LABELS,
} from "@/lib/diagnostics/labels";
import { FAMILY_LABELS } from "@/lib/leads/labels";
import { LocalDate } from "@/components/local-date";
import {
  DiagnosticProgress,
  DiagnosticStatusTag,
} from "./diagnostics-screen";
import { ResendLinkButton } from "./resend-link-button";
import {
  CalculationSection,
  type CalculationData,
} from "./calculation-section";
import { FlagsSection, questionAnchor, type FlagsData } from "./flags-section";

type AccessLinkRow = Diagnostic["accessLinks"][number];

function NoData() {
  return <Typography.Text type="secondary">—</Typography.Text>;
}

/** Vigente, usado, vencido o revocado, en ese orden de prioridad. */
function linkState(link: AccessLinkRow): { label: string; color: string } {
  if (link.revokedAt) return { label: "Revocado", color: "default" };
  if (new Date(link.expiresAt) <= new Date()) {
    return { label: "Vencido", color: "default" };
  }
  return { label: "Vigente", color: "green" };
}

const ACCESS_LINK_COLUMNS: TableColumnsType<AccessLinkRow> = [
  {
    title: "Emitido",
    dataIndex: "createdAt",
    key: "createdAt",
    render: (iso: string) => <LocalDate iso={iso} />,
  },
  {
    title: "Origen",
    dataIndex: "origin",
    key: "origin",
    render: (origin: AccessLinkRow["origin"]) => ACCESS_LINK_ORIGIN_LABELS[origin],
  },
  {
    title: "Primer uso",
    dataIndex: "redeemedAt",
    key: "redeemedAt",
    render: (iso: string | null) => (iso ? <LocalDate iso={iso} /> : <NoData />),
  },
  {
    title: "Vence",
    dataIndex: "expiresAt",
    key: "expiresAt",
    render: (iso: string) => <LocalDate iso={iso} />,
  },
  {
    title: "Estado",
    key: "state",
    render: (_, link) => {
      const state = linkState(link);
      return <Tag color={state.color}>{state.label}</Tag>;
    },
  },
];

/** Solo https: cualquier otra cosa se muestra como texto, sin enlace. */
function ExternalUrl({ url }: { url: string }) {
  if (!url.startsWith("https://")) {
    return <span style={{ overflowWrap: "anywhere" }}>{url}</span>;
  }
  return (
    <Typography.Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ overflowWrap: "anywhere" }}
    >
      {url}
    </Typography.Link>
  );
}

function AnswerView({ question }: { question: DiagnosticQuestion }) {
  if (!question.answer) {
    return <Typography.Text type="secondary">Sin responder</Typography.Text>;
  }
  if (question.type === "FREE_TEXT") {
    return (
      <Typography.Paragraph
        style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 0 }}
      >
        {question.answer.text}
      </Typography.Paragraph>
    );
  }
  const chosen = new Set(question.answer.optionIds);
  return (
    <Flex gap={8} wrap>
      {question.options
        .filter((option) => chosen.has(option.id))
        .map((option) => (
          <Tag key={option.id} style={{ marginInlineEnd: 0 }}>
            {option.text}
          </Tag>
        ))}
    </Flex>
  );
}

/** Solo lectura: corregir respuestas es del módulo de Revisión. */
export function DiagnosticDetail({
  diagnostic,
  calculations,
  flags,
}: {
  diagnostic: Diagnostic;
  /** Nulo si el diagnóstico todavía no se envió. */
  calculations: CalculationData | null;
  flags: FlagsData | null;
}) {
  const completed = diagnostic.status === "COMPLETED";
  // Cuántas alertas abiertas involucran cada pregunta, para resaltarla.
  const openFlagsByQuestion = new Map<string, number>();
  for (const flag of flags?.list?.flags ?? []) {
    if (flag.status !== "OPEN") continue;
    for (const question of flag.questions) {
      openFlagsByQuestion.set(
        question.id,
        (openFlagsByQuestion.get(question.id) ?? 0) + 1,
      );
    }
  }

  return (
    <Flex vertical gap={24}>
      <Breadcrumb
        items={[
          { title: <Link href="/diagnostics">Diagnósticos</Link> },
          { title: diagnostic.lead.name },
        ]}
      />

      <Flex justify="space-between" align="start" gap={12} wrap>
        <div style={{ minWidth: 0 }}>
          <Typography.Title
            level={3}
            style={{ margin: 0, letterSpacing: "-0.01em", overflowWrap: "anywhere" }}
          >
            {diagnostic.lead.name}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ overflowWrap: "anywhere" }}>
            {diagnostic.lead.email}
          </Typography.Text>
        </div>
        <div style={{ textAlign: "end" }}>
          <ResendLinkButton
            diagnosticId={diagnostic.id}
            email={diagnostic.lead.email}
            disabled={completed}
          />
          {completed && (
            <Typography.Text
              type="secondary"
              style={{ display: "block", marginTop: 4, fontSize: 12 }}
            >
              Ya fue enviado: no admite enlaces nuevos.
            </Typography.Text>
          )}
        </div>
      </Flex>

      <Descriptions column={{ xs: 1, md: 2 }} bordered size="small">
        <Descriptions.Item label="Estado">
          <DiagnosticStatusTag status={diagnostic.status} />
        </Descriptions.Item>
        <Descriptions.Item label="Progreso">
          <div style={{ maxWidth: 220 }}>
            <DiagnosticProgress progress={diagnostic.progress} />
          </div>
        </Descriptions.Item>
        <Descriptions.Item label="Familia">
          {FAMILY_LABELS[diagnostic.family]} · versión{" "}
          {diagnostic.questionnaireVersion.versionNumber}
        </Descriptions.Item>
        <Descriptions.Item label="Última actividad">
          <LocalDate iso={diagnostic.lastActivityAt} />
        </Descriptions.Item>
        <Descriptions.Item label="Generado">
          <LocalDate iso={diagnostic.createdAt} />
          {diagnostic.createdBy && ` por ${diagnostic.createdBy.name}`}
        </Descriptions.Item>
        <Descriptions.Item label="Enviado">
          {diagnostic.completedAt ? (
            <LocalDate iso={diagnostic.completedAt} />
          ) : (
            <NoData />
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Motivo (sin pago)" span="filled">
          {diagnostic.creationReason ? (
            <span style={{ overflowWrap: "anywhere" }}>
              {diagnostic.creationReason}
            </span>
          ) : (
            <NoData />
          )}
        </Descriptions.Item>
      </Descriptions>

      <CalculationSection
        diagnosticId={diagnostic.id}
        data={calculations}
      />

      <FlagsSection diagnosticId={diagnostic.id} data={flags} />

      <Card title="Respuestas" size="small">
        {diagnostic.questions.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Esta versión no tiene preguntas."
          />
        ) : (
          // Lista ordenada simple: `List` de Ant Design está deprecado, y
          // `Listy` es una lista virtual que aquí no hace falta.
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {diagnostic.questions.map((question, index) => (
              <li
                key={question.id}
                id={questionAnchor(question.id)}
                style={{ scrollMarginTop: 80 }}
              >
                {index > 0 && <Divider style={{ margin: "12px 0" }} />}
                <Flex vertical gap={6} style={{ width: "100%", minWidth: 0 }}>
                  <Typography.Text strong style={{ overflowWrap: "anywhere" }}>
                    {index + 1}. {question.text}
                    {question.required && (
                      <Typography.Text
                        type="secondary"
                        style={{ fontWeight: 400 }}
                      >
                        {" "}
                        (obligatoria)
                      </Typography.Text>
                    )}
                  </Typography.Text>
                  {openFlagsByQuestion.has(question.id) && (
                    <div>
                      <Tag color="red">
                        {openFlagsByQuestion.get(question.id) === 1
                          ? "1 alerta abierta"
                          : `${openFlagsByQuestion.get(question.id)} alertas abiertas`}
                      </Tag>
                    </div>
                  )}
                  <AnswerView question={question} />
                </Flex>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="Enlaces externos" size="small">
        {diagnostic.externalLinks.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="El cliente no agregó enlaces."
          />
        ) : (
          <Descriptions column={1} size="small">
            {diagnostic.externalLinks.map((link) => (
              <Descriptions.Item key={link.platform} label={PLATFORM_LABELS[link.platform]}>
                <ExternalUrl url={link.url} />
              </Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </Card>

      <Card title="Enlaces de acceso del cliente" size="small">
        <Table<AccessLinkRow>
          rowKey="id"
          size="small"
          dataSource={diagnostic.accessLinks}
          columns={ACCESS_LINK_COLUMNS}
          pagination={false}
          scroll={{ x: 640 }}
        />
      </Card>
    </Flex>
  );
}
