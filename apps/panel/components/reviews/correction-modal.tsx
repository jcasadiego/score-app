"use client";

import { useTransition } from "react";
import {
  Button,
  Checkbox,
  Flex,
  Form,
  Input,
  Modal,
  Radio,
  Typography,
} from "antd";
import type { DiagnosticQuestion } from "@/lib/api/diagnostics";
import type { AnswerCorrection } from "@/lib/api/reviews";
import { REVIEW_REASON_MAX } from "@/lib/reviews/labels";
import { AnswerView } from "@/components/diagnostics/diagnostic-detail";
import {
  correctAnswerAction,
  type ReviewActionResult,
} from "@/app/(panel)/reviews/actions";

interface CorrectionValues {
  text?: string;
  optionIds?: string[];
  single?: string;
  reason: string;
}

const FORM_ID = "correction-form";

/**
 * Corrige una respuesta según el tipo de pregunta, con motivo obligatorio.
 * Arranca con el valor efectivo (la última corrección o la original). El
 * padre la monta con una `key` por apertura y la mantiene abierta ante un 412,
 * para no perder lo escrito.
 */
export function CorrectionModal({
  question,
  current,
  reviewId,
  version,
  diagnosticId,
  onDone,
  onCancel,
}: {
  question: DiagnosticQuestion;
  current: AnswerCorrection | null;
  reviewId: string;
  version: number;
  diagnosticId: string;
  onDone: (result: ReviewActionResult) => void;
  onCancel: () => void;
}) {
  const [saving, startSaving] = useTransition();
  const answer = question.answer;

  const effectiveText = current ? current.textValue : (answer?.text ?? null);
  const effectiveOptions = current
    ? current.options.map(({ id }) => id)
    : (answer?.optionIds ?? []);
  const initialValues: CorrectionValues = {
    reason: "",
    ...(question.type === "FREE_TEXT" && { text: effectiveText ?? "" }),
    ...(question.type === "SINGLE_CHOICE" && { single: effectiveOptions[0] }),
    ...(question.type === "MULTIPLE_CHOICE" && { optionIds: effectiveOptions }),
  };

  function submit(values: CorrectionValues) {
    if (!answer) return;
    const value =
      question.type === "FREE_TEXT"
        ? { text: values.text ?? "" }
        : {
            optionIds:
              question.type === "SINGLE_CHOICE"
                ? values.single
                  ? [values.single]
                  : []
                : (values.optionIds ?? []),
          };
    startSaving(async () => {
      onDone(
        await correctAnswerAction(reviewId, version, diagnosticId, {
          answerId: answer.id,
          ...value,
          reason: values.reason,
        }),
      );
    });
  }

  const options = question.options.map((option) => ({
    value: option.id,
    label: <span style={{ overflowWrap: "anywhere" }}>{option.text}</span>,
  }));

  return (
    <Modal
      open
      title="Corregir respuesta"
      onCancel={() => !saving && onCancel()}
      mask={{ closable: !saving }}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>,
        <Button
          key="submit"
          type="primary"
          htmlType="submit"
          form={FORM_ID}
          loading={saving}
        >
          Guardar corrección
        </Button>,
      ]}
    >
      <Flex vertical gap={12}>
        <Typography.Text strong style={{ overflowWrap: "anywhere" }}>
          {question.text}
        </Typography.Text>
        <Flex vertical gap={4}>
          <Typography.Text type="secondary">Original del cliente</Typography.Text>
          <AnswerView question={question} />
        </Flex>

        <Form<CorrectionValues>
          id={FORM_ID}
          layout="vertical"
          initialValues={initialValues}
          onFinish={submit}
          disabled={saving}
        >
          {question.type === "FREE_TEXT" && (
            <Form.Item
              name="text"
              label="Valor corregido"
              rules={[
                { required: true, whitespace: true, message: "Escribe el valor corregido." },
              ]}
            >
              <Input.TextArea rows={4} autoFocus />
            </Form.Item>
          )}
          {question.type === "SINGLE_CHOICE" && (
            <Form.Item
              name="single"
              label="Valor corregido"
              rules={[{ required: true, message: "Elige una opción." }]}
            >
              <Radio.Group
                options={options}
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              />
            </Form.Item>
          )}
          {question.type === "MULTIPLE_CHOICE" && (
            <Form.Item
              name="optionIds"
              label="Valor corregido"
              rules={[
                { required: true, type: "array", min: 1, message: "Elige al menos una opción." },
              ]}
            >
              <Checkbox.Group
                options={options}
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              />
            </Form.Item>
          )}
          <Typography.Paragraph type="secondary">
            El motivo queda registrado junto a quién corrigió y cuándo. La
            respuesta original no se pierde.
          </Typography.Paragraph>
          <Form.Item
            name="reason"
            label="Motivo (obligatorio)"
            rules={[
              { required: true, whitespace: true, message: "Escribe por qué corriges." },
            ]}
          >
            <Input.TextArea rows={3} maxLength={REVIEW_REASON_MAX} showCount />
          </Form.Item>
        </Form>
      </Flex>
    </Modal>
  );
}
