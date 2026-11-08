"use client";

import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type { QuestionType } from "@/lib/diagnostics/labels";
import type { QuestionnaireQuestion } from "@/lib/api/questionnaire";
import type { ApiFieldError } from "@/lib/api/errors";
import {
  CODE_MAX,
  CODE_PATTERN,
  DEFAULT_FREE_TEXT_LENGTH,
  FREE_TEXT_MAX_LENGTH,
  HELP_TEXT_MAX,
  MAX_OPTIONS,
  MIN_CHOICE_OPTIONS,
  OPTION_TEXT_MAX,
  QUESTION_TEXT_MAX,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  suggestCode,
} from "@/lib/questionnaire/labels";
import { saveQuestionAction } from "@/app/(panel)/questionnaire/actions";

const FORM_ID = "question-form";

interface QuestionFormValues {
  text: string;
  code: string;
  type: QuestionType;
  helpText?: string;
  required: boolean;
  maxLength?: number;
  options: { text: string; value: string }[];
}

const CODE_RULES = [
  { required: true, message: "Ingresa el código." },
  {
    pattern: CODE_PATTERN,
    message:
      "Solo minúsculas sin tildes, dígitos y guion bajo, empezando por una letra.",
  },
];

interface QuestionModalProps {
  versionId: string;
  /** `null` para crear una pregunta nueva. */
  question: QuestionnaireQuestion | null;
  onClose: () => void;
  /** Tras guardar con éxito, antes de cerrar. */
  onSaved: () => void;
}

/**
 * Crear o editar una pregunta del borrador, con sus opciones. Se monta de nuevo
 * en cada apertura (`key` en el padre), así que su `Form` nunca arrastra los
 * valores de otra pregunta.
 */
export function QuestionModal({
  versionId,
  question,
  onClose,
  onSaved,
}: QuestionModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<QuestionFormValues>();
  const type = Form.useWatch("type", form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{
    title: string;
    errors?: ApiFieldError[];
  } | null>(null);

  const isChoice = type !== undefined && type !== "FREE_TEXT";

  async function submit(values: QuestionFormValues) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const isFreeText = values.type === "FREE_TEXT";
    const result = await saveQuestionAction(versionId, question?.id ?? null, {
      code: values.code,
      text: values.text,
      type: values.type,
      helpText: values.helpText,
      required: values.required,
      maxLength: isFreeText ? values.maxLength : undefined,
      options: isFreeText ? [] : (values.options ?? []),
    });
    setSaving(false);
    if (result.ok) {
      message.success(question ? "Pregunta guardada." : "Pregunta agregada.");
      onSaved();
      onClose();
    } else {
      // Lo escrito se queda en el formulario para corregirlo.
      setError({
        title: result.error ?? "No pudimos guardar la pregunta.",
        errors: result.errors,
      });
    }
  }

  /** Propone el código desde el texto si todavía está vacío. */
  function suggest(
    path: ["code"] | ["options", number, "value"],
    from: string,
  ) {
    if (!form.getFieldValue(path)) {
      const code = suggestCode(from);
      if (code) form.setFieldValue(path, code);
    }
  }

  return (
    <Modal
      open
      title={question ? "Editar pregunta" : "Nueva pregunta"}
      onCancel={() => !saving && onClose()}
      mask={{ closable: false }}
      width={720}
      okText={question ? "Guardar" : "Agregar"}
      cancelText="Cancelar"
      confirmLoading={saving}
      okButtonProps={{ htmlType: "submit", form: FORM_ID }}
    >
      {error && (
        <Alert
          type="error"
          showIcon
          title={error.title}
          description={
            error.errors?.length ? (
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {error.errors.map((e, i) => (
                  <li key={`${e.field ?? ""}-${i}`}>{e.message}</li>
                ))}
              </ul>
            ) : undefined
          }
          style={{ marginBottom: 16 }}
        />
      )}
      <Form<QuestionFormValues>
        form={form}
        id={FORM_ID}
        layout="vertical"
        onFinish={submit}
        disabled={saving}
        initialValues={
          question
            ? {
                text: question.text,
                code: question.code,
                type: question.type,
                helpText: question.helpText ?? undefined,
                required: question.required,
                maxLength: question.maxLength ?? DEFAULT_FREE_TEXT_LENGTH,
                options: question.options.map(({ text, value }) => ({
                  text,
                  value,
                })),
              }
            : {
                type: "SINGLE_CHOICE",
                required: true,
                maxLength: DEFAULT_FREE_TEXT_LENGTH,
                options: [
                  { text: "", value: "" },
                  { text: "", value: "" },
                ],
              }
        }
      >
        <Form.Item
          name="text"
          label="Pregunta"
          rules={[
            { required: true, whitespace: true, message: "Escribe la pregunta." },
          ]}
        >
          <Input.TextArea
            autoFocus
            autoSize={{ minRows: 2, maxRows: 5 }}
            maxLength={QUESTION_TEXT_MAX}
            showCount
            onBlur={(e) => suggest(["code"], e.target.value)}
          />
        </Form.Item>

        <Form.Item
          name="code"
          label="Código"
          extra="Identifica la pregunta entre versiones aunque cambie su texto. No lo ve el cliente."
          rules={CODE_RULES}
        >
          <Input maxLength={CODE_MAX} spellCheck={false} />
        </Form.Item>

        <Form.Item name="type" label="Tipo">
          <Radio.Group
            optionType="button"
            options={QUESTION_TYPES.map((t) => ({
              value: t,
              label: QUESTION_TYPE_LABELS[t],
            }))}
          />
        </Form.Item>

        <Form.Item
          name="helpText"
          label="Ayuda o ejemplo (opcional)"
          extra="Se muestra debajo de la pregunta, como texto."
        >
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 5 }}
            maxLength={HELP_TEXT_MAX}
            showCount
          />
        </Form.Item>

        <Form.Item name="required" label="Obligatoria" valuePropName="checked">
          <Switch />
        </Form.Item>

        {type === "FREE_TEXT" && (
          <Form.Item
            name="maxLength"
            label="Largo máximo de la respuesta"
            rules={[{ required: true, message: "Indica el largo máximo." }]}
          >
            <InputNumber
              min={1}
              max={FREE_TEXT_MAX_LENGTH}
              precision={0}
              suffix="caracteres"
              style={{ width: 220 }}
            />
          </Form.Item>
        )}

        {isChoice && (
          <Form.List
            name="options"
            rules={[
              {
                validator: async (_, options?: unknown[]) => {
                  if (!options || options.length < MIN_CHOICE_OPTIONS) {
                    throw new Error(
                      `Una pregunta de selección necesita al menos ${MIN_CHOICE_OPTIONS} opciones.`,
                    );
                  }
                },
              },
            ]}
          >
            {(fields, { add, remove, move }, { errors }) => (
              <Flex vertical gap={8}>
                <Typography.Text strong>Opciones</Typography.Text>
                <Typography.Text type="secondary">
                  El valor es lo que se guarda como respuesta y se mantiene
                  entre versiones.
                </Typography.Text>
                {fields.map((field, i) => (
                  <Flex key={field.key} gap={8} align="flex-start" wrap>
                    <Form.Item
                      name={[field.name, "text"]}
                      rules={[
                        {
                          required: true,
                          whitespace: true,
                          message: "Escribe la opción.",
                        },
                      ]}
                      style={{ flex: "2 1 220px", marginBottom: 0 }}
                    >
                      <Input
                        placeholder={`Opción ${i + 1}`}
                        aria-label={`Texto de la opción ${i + 1}`}
                        maxLength={OPTION_TEXT_MAX}
                        onBlur={(e) =>
                          suggest(["options", field.name, "value"], e.target.value)
                        }
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "value"]}
                      rules={CODE_RULES.map((rule) =>
                        "required" in rule
                          ? { ...rule, message: "Ingresa el valor." }
                          : rule,
                      )}
                      style={{ flex: "1 1 160px", marginBottom: 0 }}
                    >
                      <Input
                        placeholder="valor"
                        aria-label={`Valor de la opción ${i + 1}`}
                        maxLength={CODE_MAX}
                        spellCheck={false}
                      />
                    </Form.Item>
                    <Flex gap={4}>
                      <Tooltip title="Subir">
                        <Button
                          icon={<ArrowUpOutlined />}
                          aria-label={`Subir la opción ${i + 1}`}
                          disabled={i === 0}
                          onClick={() => move(i, i - 1)}
                        />
                      </Tooltip>
                      <Tooltip title="Bajar">
                        <Button
                          icon={<ArrowDownOutlined />}
                          aria-label={`Bajar la opción ${i + 1}`}
                          disabled={i === fields.length - 1}
                          onClick={() => move(i, i + 1)}
                        />
                      </Tooltip>
                      <Tooltip title="Quitar">
                        <Button
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={`Quitar la opción ${i + 1}`}
                          onClick={() => remove(field.name)}
                        />
                      </Tooltip>
                    </Flex>
                  </Flex>
                ))}
                {errors.length > 0 && (
                  <Typography.Text type="danger" role="alert">
                    {errors}
                  </Typography.Text>
                )}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ text: "", value: "" })}
                  disabled={fields.length >= MAX_OPTIONS}
                  style={{ alignSelf: "flex-start" }}
                >
                  Agregar opción
                </Button>
              </Flex>
            )}
          </Form.List>
        )}
      </Form>
    </Modal>
  );
}
