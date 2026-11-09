"use client";

import { useState, useTransition } from "react";
import {
  App,
  Button,
  Card,
  Divider,
  Empty,
  Flex,
  Form,
  Input,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ReviewNote } from "@/lib/api/reviews";
import {
  REVIEW_NOTE_BODY_MAX,
  REVIEW_NOTE_DIMENSION_MAX,
} from "@/lib/reviews/labels";
import { LocalDate } from "@/components/local-date";
import { addNoteAction } from "@/app/(panel)/reviews/actions";

const FORM_ID = "review-note-form";

/**
 * Notas del revisor, generales o por dimensión, que usará Delivery para el
 * informe. La dimensión es texto libre hasta confirmar D1–D8.
 */
export function NotesCard({
  reviewId,
  notes,
}: {
  reviewId: string;
  notes: ReviewNote[];
}) {
  const { message } = App.useApp();
  const [saving, startSaving] = useTransition();
  // Sube tras guardar: el formulario se monta vacío de nuevo.
  const [formKey, setFormKey] = useState(0);

  function submit({ body, dimension }: { body: string; dimension?: string }) {
    startSaving(async () => {
      const result = await addNoteAction(reviewId, body, dimension ?? "");
      if (result.ok) {
        message.success("Nota guardada.");
        setFormKey((k) => k + 1);
      } else {
        message.error(result.error ?? "No pudimos guardar la nota.");
      }
    });
  }

  return (
    <Card title="Notas del revisor" size="small">
      <Flex vertical gap={16}>
        {notes.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Todavía no hay notas."
          />
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {notes.map((note, index) => (
              <li key={note.id}>
                {index > 0 && <Divider style={{ margin: "12px 0" }} />}
                <Flex vertical gap={4} style={{ minWidth: 0 }}>
                  <Space wrap size={[8, 4]}>
                    <Tag style={{ marginInlineEnd: 0, whiteSpace: "normal" }}>
                      {note.dimension ? `Dimensión ${note.dimension}` : "General"}
                    </Tag>
                    <Typography.Text type="secondary">
                      {note.author.name} · <LocalDate iso={note.createdAt} />
                    </Typography.Text>
                  </Space>
                  <Typography.Paragraph
                    style={{
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      marginBottom: 0,
                    }}
                  >
                    {note.body}
                  </Typography.Paragraph>
                </Flex>
              </li>
            ))}
          </ol>
        )}

        <Form
          key={formKey}
          id={FORM_ID}
          layout="vertical"
          initialValues={{ body: "", dimension: "" }}
          onFinish={submit}
          disabled={saving}
        >
          <Form.Item
            name="dimension"
            label="Dimensión (opcional)"
            extra="Déjala vacía para una nota general."
          >
            <Input
              maxLength={REVIEW_NOTE_DIMENSION_MAX}
              placeholder="Por ejemplo, D3"
              style={{ maxWidth: 240 }}
            />
          </Form.Item>
          <Form.Item
            name="body"
            label="Nota"
            rules={[
              { required: true, whitespace: true, message: "Escribe la nota." },
            ]}
          >
            <Input.TextArea rows={4} maxLength={REVIEW_NOTE_BODY_MAX} showCount />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving}>
            Agregar nota
          </Button>
        </Form>
      </Flex>
    </Card>
  );
}
