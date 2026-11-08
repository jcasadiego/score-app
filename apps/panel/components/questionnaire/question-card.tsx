"use client";

import { Button, Card, Flex, Space, Tag, Tooltip, Typography } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
} from "@ant-design/icons";
import type { QuestionnaireQuestion } from "@/lib/api/questionnaire";
import { QUESTION_TYPE_LABELS } from "@/lib/questionnaire/labels";

interface QuestionCardProps {
  question: QuestionnaireQuestion;
  index: number;
  total: number;
  editable: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (delta: -1 | 1) => void;
}

/** Una pregunta con su tipo, ayuda y opciones. El texto se muestra escapado. */
export function QuestionCard({
  question,
  index,
  total,
  editable,
  busy,
  onEdit,
  onDelete,
  onMove,
}: QuestionCardProps) {
  const n = index + 1;
  return (
    <Card size="small">
      <Flex gap={12} justify="space-between" align="flex-start" wrap>
        <Flex vertical gap={6} style={{ flex: "1 1 320px", minWidth: 0 }}>
          <Typography.Text strong style={{ overflowWrap: "anywhere" }}>
            {n}. {question.text}
          </Typography.Text>
          <Space wrap size={[6, 6]}>
            <Tag>{QUESTION_TYPE_LABELS[question.type]}</Tag>
            <Tag color={question.required ? "blue" : "default"}>
              {question.required ? "Obligatoria" : "Opcional"}
            </Tag>
            {question.type === "FREE_TEXT" && question.maxLength && (
              <Tag>Hasta {question.maxLength} caracteres</Tag>
            )}
            <Typography.Text type="secondary" code>
              {question.code}
            </Typography.Text>
          </Space>
          {question.helpText && (
            <Typography.Text type="secondary" style={{ overflowWrap: "anywhere" }}>
              Ayuda: {question.helpText}
            </Typography.Text>
          )}
          {question.options.length > 0 && (
            <ol style={{ margin: 0, paddingInlineStart: 20 }}>
              {question.options.map((option) => (
                <li key={option.id} style={{ overflowWrap: "anywhere" }}>
                  {option.text}{" "}
                  <Typography.Text type="secondary" code>
                    {option.value}
                  </Typography.Text>
                </li>
              ))}
            </ol>
          )}
        </Flex>

        {editable && (
          <Space size={4}>
            <Tooltip title="Subir">
              <Button
                icon={<ArrowUpOutlined />}
                aria-label={`Subir la pregunta ${n}`}
                disabled={busy || index === 0}
                onClick={() => onMove(-1)}
              />
            </Tooltip>
            <Tooltip title="Bajar">
              <Button
                icon={<ArrowDownOutlined />}
                aria-label={`Bajar la pregunta ${n}`}
                disabled={busy || index === total - 1}
                onClick={() => onMove(1)}
              />
            </Tooltip>
            <Tooltip title="Editar">
              <Button
                icon={<EditOutlined />}
                aria-label={`Editar la pregunta ${n}`}
                disabled={busy}
                onClick={onEdit}
              />
            </Tooltip>
            <Tooltip title="Quitar">
              <Button
                danger
                icon={<DeleteOutlined />}
                aria-label={`Quitar la pregunta ${n}`}
                disabled={busy}
                onClick={onDelete}
              />
            </Tooltip>
          </Space>
        )}
      </Flex>
    </Card>
  );
}
