"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Flex,
  Segmented,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type {
  QuestionnaireQuestion,
  QuestionnaireVersionDetail,
} from "@/lib/api/questionnaire";
import type { ApiFieldError } from "@/lib/api/errors";
import {
  FAMILIES,
  FAMILY_LABELS,
  type DiagnosticFamily,
} from "@/lib/leads/labels";
import { LocalDate } from "@/components/local-date";
import {
  createDraftAction,
  deleteQuestionAction,
  publishVersionAction,
  reorderQuestionsAction,
} from "@/app/(panel)/questionnaire/actions";
import { QuestionCard } from "./question-card";
import { QuestionModal } from "./question-modal";

interface QuestionnaireScreenProps {
  family: DiagnosticFamily;
  draft: QuestionnaireVersionDetail | null;
  published: QuestionnaireVersionDetail | null;
  view: "draft" | "published";
  /** Solo Aprobador. Ocultar es cortesía: quien valida el permiso es la API. */
  canEdit: boolean;
}

/** Lo que devolvió la API al fallar algo de la versión, con su detalle. */
interface VersionError {
  title: string;
  errors?: ApiFieldError[];
}

/**
 * Administración del cuestionario (PF-14). Una pestaña por familia; en cada
 * una, el borrador (editable por el Aprobador) y la última versión publicada
 * (solo lectura). Los datos vienen del servidor y cada cambio los recarga con
 * `revalidatePath`: aquí no se copian a estado.
 */
export function QuestionnaireScreen({
  family,
  draft,
  published,
  view,
  canEdit,
}: QuestionnaireScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { message, modal } = App.useApp();
  const [pending, startTransition] = useTransition();
  const [versionError, setVersionError] = useState<VersionError | null>(null);
  // `key` nuevo por apertura: cada una monta su propio Form (lección de PF-48).
  const [editor, setEditor] = useState<{
    key: number;
    question: QuestionnaireQuestion | null;
  } | null>(null);

  const version = view === "draft" ? draft : published;
  const editable = canEdit && view === "draft" && draft !== null;

  function navigate(next: { family?: DiagnosticFamily; view?: string }) {
    const params = new URLSearchParams({ family: next.family ?? family });
    if (next.view) params.set("view", next.view);
    setVersionError(null);
    router.push(`${pathname}?${params}`);
  }

  function run(
    action: () => Promise<{ ok: boolean; error?: string; errors?: ApiFieldError[] }>,
    success: string,
  ) {
    setVersionError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        message.success(success);
      } else {
        setVersionError({
          title: result.error ?? "No pudimos completar la acción.",
          errors: result.errors,
        });
      }
    });
  }

  function createDraft() {
    const source =
      published && !published.isSample
        ? `Copia las ${published.questions.length} preguntas de la versión ${published.versionNumber} publicada.`
        : "Empieza vacío: no hay una versión oficial publicada para copiar.";
    modal.confirm({
      title: `¿Crear un borrador de ${FAMILY_LABELS[family]}?`,
      content: `${source} Lo publicado no cambia hasta que publiques el borrador.`,
      okText: "Crear borrador",
      cancelText: "Cancelar",
      onOk: () =>
        run(() => createDraftAction(family), "Borrador creado."),
    });
  }

  function publish(target: QuestionnaireVersionDetail) {
    modal.confirm({
      title: `¿Publicar la versión ${target.versionNumber} de ${FAMILY_LABELS[family]}?`,
      content:
        "Los diagnósticos nuevos usarán esta versión. Los que ya se crearon conservan la suya, y una versión publicada ya no se puede modificar.",
      okText: "Publicar",
      cancelText: "Cancelar",
      onOk: () =>
        run(() => publishVersionAction(target.id), "Versión publicada."),
    });
  }

  function remove(target: QuestionnaireVersionDetail, question: QuestionnaireQuestion) {
    modal.confirm({
      title: "¿Quitar esta pregunta del borrador?",
      content: question.text,
      okText: "Quitar",
      okButtonProps: { danger: true },
      cancelText: "Cancelar",
      onOk: () =>
        run(
          () => deleteQuestionAction(target.id, question.id),
          "Pregunta quitada.",
        ),
    });
  }

  function move(target: QuestionnaireVersionDetail, index: number, delta: -1 | 1) {
    const ids = target.questions.map(({ id }) => id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    run(() => reorderQuestionsAction(target.id, ids), "Orden guardado.");
  }

  const viewOptions = [
    ...(draft
      ? [{ value: "draft", label: `Borrador · versión ${draft.versionNumber}` }]
      : []),
    ...(published
      ? [
          {
            value: "published",
            label: `Publicada · versión ${published.versionNumber}`,
          },
        ]
      : []),
  ];

  return (
    <Flex vertical gap={16}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Cuestionario
      </Typography.Title>

      <Tabs
        activeKey={family}
        onChange={(key) => navigate({ family: key as DiagnosticFamily })}
        items={FAMILIES.map((f) => ({ key: f, label: FAMILY_LABELS[f] }))}
      />

      <Flex wrap gap={12} justify="space-between" align="center">
        {viewOptions.length > 0 ? (
          <Segmented
            value={view}
            options={viewOptions}
            onChange={(value) => navigate({ view: String(value) })}
            disabled={pending}
          />
        ) : (
          <span />
        )}
        {canEdit && !draft && (
          <Button type="primary" onClick={createDraft} loading={pending}>
            Crear borrador
          </Button>
        )}
      </Flex>

      {versionError && (
        <Alert
          type="error"
          showIcon
          closable={{ onClose: () => setVersionError(null) }}
          title={versionError.title}
          description={
            versionError.errors?.length ? (
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {versionError.errors.map((e, i) => (
                  <li key={`${e.field ?? ""}-${i}`}>{e.message}</li>
                ))}
              </ul>
            ) : undefined
          }
        />
      )}

      {!version ? (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={`Todavía no hay versiones del cuestionario de ${FAMILY_LABELS[family]}.`}
          />
        </Card>
      ) : (
        <Card
          title={
            <Space wrap size={8}>
              <span>Versión {version.versionNumber}</span>
              <Tag color={version.status === "DRAFT" ? "gold" : "green"}>
                {version.status === "DRAFT" ? "Borrador" : "Publicada"}
              </Tag>
              {version.isSample && <Tag>De prueba</Tag>}
            </Space>
          }
          extra={
            editable && (
              <Space wrap>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setEditor({ key: Date.now(), question: null })
                  }
                  disabled={pending}
                >
                  Agregar pregunta
                </Button>
                <Button
                  type="primary"
                  onClick={() => publish(version)}
                  loading={pending}
                >
                  Publicar
                </Button>
              </Space>
            )
          }
        >
          <Typography.Paragraph type="secondary">
            {version.status === "PUBLISHED" && version.publishedAt ? (
              <>
                Publicada el <LocalDate iso={version.publishedAt} />. Solo
                lectura: para cambiarla, crea un borrador.
              </>
            ) : canEdit ? (
              "Los cambios se guardan en el borrador. Los diagnósticos no lo usan hasta que lo publiques."
            ) : (
              "Borrador en preparación. Solo el Aprobador puede editarlo y publicarlo."
            )}
            {version.isSample &&
              " Esta versión es de prueba: un borrador nuevo no copia sus preguntas."}
          </Typography.Paragraph>

          {version.questions.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Esta versión todavía no tiene preguntas."
            />
          ) : (
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {version.questions.map((question, index) => (
                <li key={question.id} style={{ marginTop: index ? 12 : 0 }}>
                  <QuestionCard
                    question={question}
                    index={index}
                    total={version.questions.length}
                    editable={editable}
                    busy={pending}
                    onEdit={() =>
                      setEditor({ key: Date.now(), question })
                    }
                    onDelete={() => remove(version, question)}
                    onMove={(delta) => move(version, index, delta)}
                  />
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {editable && draft && editor && (
        <QuestionModal
          key={editor.key}
          versionId={draft.id}
          question={editor.question}
          onClose={() => setEditor(null)}
          // El aviso anterior (p. ej. lo que faltaba para publicar) ya no vale.
          onSaved={() => setVersionError(null)}
        />
      )}
    </Flex>
  );
}
