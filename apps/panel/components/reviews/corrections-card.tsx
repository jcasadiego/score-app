"use client";

import { Card, Divider, Empty, Flex, Space, Tag, Typography } from "antd";
import type { AnswerCorrection } from "@/lib/api/reviews";
import { LocalDate } from "@/components/local-date";
import { AnswerValue } from "@/components/diagnostics/diagnostic-detail";
import { questionAnchor } from "@/components/diagnostics/flags-section";

/** Historial de correcciones: quién, cuándo, qué y por qué (solo inserción). */
export function CorrectionsCard({
  corrections,
}: {
  corrections: AnswerCorrection[];
}) {
  // La más reciente primero.
  const ordered = [...corrections].sort((a, b) => b.sequence - a.sequence);
  return (
    <Card title="Historial de correcciones" size="small">
      {ordered.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Todavía no hay correcciones."
        />
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {ordered.map((correction, index) => (
            <li key={correction.id}>
              {index > 0 && <Divider style={{ margin: "12px 0" }} />}
              <Flex vertical gap={8} style={{ minWidth: 0 }}>
                <Space wrap size={[8, 4]}>
                  <Tag style={{ marginInlineEnd: 0 }}>#{correction.sequence}</Tag>
                  <Typography.Text type="secondary">
                    {correction.correctedBy.name} ·{" "}
                    <LocalDate iso={correction.createdAt} />
                  </Typography.Text>
                </Space>
                <Typography.Link
                  href={`#${questionAnchor(correction.question.id)}`}
                  strong
                  style={{ overflowWrap: "anywhere" }}
                >
                  {correction.question.text}
                </Typography.Link>
                <Flex gap={16} wrap>
                  <Flex vertical gap={4} style={{ flex: "1 1 240px", minWidth: 0 }}>
                    <Typography.Text type="secondary">Original</Typography.Text>
                    <AnswerValue
                      type={correction.question.type}
                      text={correction.original.textValue}
                      options={correction.original.options}
                    />
                  </Flex>
                  <Flex vertical gap={4} style={{ flex: "1 1 240px", minWidth: 0 }}>
                    <Typography.Text type="secondary">Corregida</Typography.Text>
                    <AnswerValue
                      type={correction.question.type}
                      text={correction.textValue}
                      options={correction.options}
                    />
                  </Flex>
                </Flex>
                <Typography.Text style={{ overflowWrap: "anywhere" }}>
                  <Typography.Text type="secondary">Motivo: </Typography.Text>
                  {correction.reason}
                </Typography.Text>
              </Flex>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
