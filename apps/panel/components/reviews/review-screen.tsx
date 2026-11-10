"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  Space,
  Tag,
  Typography,
} from "antd";
import type {
  AnswerCorrection,
  ReviewDetail,
  ReviewNote,
} from "@/lib/api/reviews";
import type { DiagnosticQuestion } from "@/lib/api/diagnostics";
import type { DiagnosticDetailData } from "@/lib/diagnostics/load-detail";
import {
  AI_EXCEPTION_BLOCKER,
  recalculationOptions,
} from "@/lib/reviews/labels";
import { LocalDate } from "@/components/local-date";
import {
  AnswerValue,
  AnswerView,
  DiagnosticDetail,
} from "@/components/diagnostics/diagnostic-detail";
import { requestCalculationAction } from "@/app/(panel)/diagnostics/actions";
import {
  releaseReviewAction,
  takeReviewAction,
  type ReviewActionResult,
} from "@/app/(panel)/reviews/actions";
import {
  AssigneeText,
  ReviewStatusTag,
  assignmentActions,
} from "./review-tags";
import { CorrectionModal } from "./correction-modal";
import { ApproveModal, ReopenModal } from "./approval-modals";
import { CorrectionsCard } from "./corrections-card";
import { NotesCard } from "./notes-card";

interface Me {
  id: string;
  isApprover: boolean;
}

/** La última corrección de cada pregunta: la respuesta efectiva. */
function latestByQuestion(corrections: AnswerCorrection[]) {
  const latest = new Map<string, AnswerCorrection>();
  for (const correction of corrections) {
    const current = latest.get(correction.question.id);
    if (!current || correction.sequence > current.sequence) {
      latest.set(correction.question.id, correction);
    }
  }
  return latest;
}

function BlockerList({ blockers }: { blockers: ReviewDetail["approvalBlockers"] }) {
  return (
    <ul style={{ margin: 0, paddingInlineStart: 20 }}>
      {blockers.map((blocker) => (
        <li key={blocker.code}>{blocker.message}</li>
      ))}
    </ul>
  );
}

/**
 * Pantalla de revisión (PF-40): el detalle del diagnóstico con la toma del
 * caso, las correcciones, las notas y la aprobación. Ocultar un botón no
 * reemplaza la validación de la API, que decide con el rol leído de la base.
 */
export function ReviewScreen({
  review,
  detail,
  corrections,
  notes,
  me,
}: {
  review: ReviewDetail;
  detail: DiagnosticDetailData;
  corrections: AnswerCorrection[];
  notes: ReviewNote[];
  me: Me;
}) {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [busy, startBusy] = useTransition();
  // Sube en cada apertura: cada modal monta un formulario nuevo (CLAUDE.md 9).
  const [openCount, setOpenCount] = useState(0);
  const [correcting, setCorrecting] = useState<DiagnosticQuestion | null>(null);
  const [approving, setApproving] = useState(false);
  const [reopening, setReopening] = useState(false);

  const approved = review.status === "APPROVED";
  const assignment = assignmentActions(review.assignee, me);
  const canCorrect = assignment.mine && !approved;
  const latest = latestByQuestion(corrections);
  const blockers = review.approvalBlockers;
  const needsException =
    blockers.length > 0 &&
    blockers.every((blocker) => blocker.code === AI_EXCEPTION_BLOCKER);
  const canApprove = me.isApprover && !approved && (blockers.length === 0 || needsException);
  const pendingRecalculation =
    review.latestCalculation !== null &&
    review.latestCalculation.correctionSequence < review.lastCorrectionSequence;

  function open(setter: () => void) {
    setOpenCount((n) => n + 1);
    setter();
  }

  /** 412: recarga los datos; el modal sigue abierto con lo escrito. */
  function handle(result: ReviewActionResult, success: string): boolean {
    if (result.ok) {
      message.success(success);
      return true;
    }
    if (result.stale) {
      message.warning(result.error);
      router.refresh();
      return false;
    }
    message.error(result.error ?? "No pudimos completar la acción.");
    return false;
  }

  function take() {
    startBusy(async () => {
      handle(await takeReviewAction(review.id), "Tomaste el caso.");
    });
  }

  function release() {
    const doRelease = () =>
      startBusy(async () => {
        handle(await releaseReviewAction(review.id), "Caso liberado.");
      });
    if (!assignment.releasesOther) return doRelease();
    modal.confirm({
      title: "¿Liberar un caso de otra persona?",
      content: `${review.assignee?.name ?? "Otra persona"} lo tiene tomado. Al liberarlo, cualquiera podrá tomarlo.`,
      okText: "Liberar",
      cancelText: "Cancelar",
      onOk: doRelease,
    });
  }

  function recalculate() {
    startBusy(async () => {
      const result = await requestCalculationAction(review.diagnostic.id);
      if (result.ok) {
        message.info("Cálculo en curso. El resultado se actualiza solo al terminar.");
      } else if (result.reason === "in-progress") {
        message.info("Ya hay un cálculo en curso.");
      } else {
        message.error(result.error ?? "No pudimos pedir el cálculo.");
      }
    });
  }

  const header = (
    <Card
      title="Revisión del caso"
      size="small"
      extra={<ReviewStatusTag status={review.status} />}
    >
      <Flex vertical gap={16}>
        <Descriptions column={{ xs: 1, md: 2 }} size="small">
          <Descriptions.Item label="Revisor">
            <Space wrap size={8}>
              <AssigneeText assignee={review.assignee} meId={me.id} />
              {review.assignedAt && (
                <Typography.Text type="secondary">
                  desde <LocalDate iso={review.assignedAt} />
                </Typography.Text>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Correcciones">
            {corrections.length === 0 ? "Ninguna" : corrections.length}
          </Descriptions.Item>
        </Descriptions>

        <Space wrap size={8}>
          {assignment.canTake && (
            <Button type="primary" loading={busy} onClick={take}>
              {review.assignee ? "Tomar el caso (el revisor está desactivado)" : "Tomar el caso"}
            </Button>
          )}
          {assignment.canRelease && (
            <Button disabled={busy} onClick={release}>
              Liberar
            </Button>
          )}
          {canApprove && (
            <Button
              type="primary"
              disabled={busy}
              onClick={() => open(() => setApproving(true))}
            >
              {needsException ? "Aprobar con excepción de IA" : "Aprobar"}
            </Button>
          )}
          {approved && me.isApprover && (
            <Button disabled={busy} onClick={() => open(() => setReopening(true))}>
              Reabrir
            </Button>
          )}
        </Space>

        {pendingRecalculation && (
          <Alert
            type="warning"
            showIcon
            title="Hay correcciones que el resultado del motor no incluye."
            description="Recalcula para que el resultado y las alertas usen las respuestas corregidas. Hasta entonces no se puede aprobar."
            action={
              <Button size="small" loading={busy} onClick={recalculate}>
                Recalcular
              </Button>
            }
          />
        )}

        {approved && review.approval && (
          <Alert
            type="success"
            showIcon
            title={
              <>
                Aprobado por {review.approval.approvedBy.name} ·{" "}
                <LocalDate iso={review.approval.approvedAt} />
              </>
            }
            description={
              <>
                Queda atado al resultado del motor de esta pantalla. Para
                corregir, un Aprobador debe reabrirlo.
                {review.approval.aiExceptionReason && (
                  <span style={{ display: "block", overflowWrap: "anywhere" }}>
                    Aprobado sin análisis con IA. Motivo:{" "}
                    {review.approval.aiExceptionReason}
                  </span>
                )}
              </>
            }
          />
        )}

        {!approved && blockers.length > 0 && (
          <Alert
            type={me.isApprover ? "warning" : "info"}
            showIcon
            title={
              me.isApprover
                ? "Todavía no se puede aprobar:"
                : "Pendiente de aprobación. Falta:"
            }
            description={
              <>
                <BlockerList blockers={blockers} />
                {needsException && me.isApprover && (
                  <Typography.Text
                    type="secondary"
                    style={{ display: "block", marginTop: 8 }}
                  >
                    Si la IA no está disponible, puedes aprobar registrando una
                    excepción con motivo.
                  </Typography.Text>
                )}
              </>
            }
          />
        )}
        {!approved && blockers.length === 0 && !me.isApprover && (
          <Alert
            type="info"
            showIcon
            title="Pendiente de aprobación."
            description="El caso cumple todo lo necesario: falta que un Aprobador lo apruebe."
          />
        )}

        {!approved && !assignment.mine && (
          <Typography.Text type="secondary">
            {review.assignee
              ? `${review.assignee.name} tiene tomado el caso: las respuestas se ven en solo lectura.`
              : "Toma el caso para corregir respuestas."}
          </Typography.Text>
        )}
      </Flex>
    </Card>
  );

  function renderAnswer(question: DiagnosticQuestion) {
    const correction = latest.get(question.id);
    const correctButton = canCorrect && question.answer && (
      <div>
        <Button
          size="small"
          disabled={busy}
          onClick={() => open(() => setCorrecting(question))}
        >
          Corregir
        </Button>
      </div>
    );
    if (!correction) {
      return (
        <>
          <AnswerView question={question} />
          {correctButton}
        </>
      );
    }
    return (
      <>
        <Flex gap={16} wrap>
          <Flex vertical gap={4} style={{ flex: "1 1 260px", minWidth: 0 }}>
            <Typography.Text type="secondary">Original del cliente</Typography.Text>
            <AnswerView question={question} />
          </Flex>
          <Flex vertical gap={4} style={{ flex: "1 1 260px", minWidth: 0 }}>
            <Space size={4} wrap>
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                Corregida
              </Tag>
              <Typography.Text type="secondary">
                por {correction.correctedBy.name} ·{" "}
                <LocalDate iso={correction.createdAt} />
              </Typography.Text>
            </Space>
            <AnswerValue
              type={question.type}
              text={correction.textValue}
              options={correction.options}
            />
          </Flex>
        </Flex>
        {correctButton}
      </>
    );
  }

  return (
    <>
      <DiagnosticDetail
        diagnostic={detail.diagnostic}
        calculations={detail.calculations}
        flags={detail.flags}
        breadcrumb={{ href: "/reviews", label: "Bandeja de revisión" }}
        header={header}
        renderAnswer={renderAnswer}
        // En un caso aprobado, recalcular anula la aprobación: solo el Aprobador.
        calculationOptions={recalculationOptions(approved, me.isApprover)}
      >
        <CorrectionsCard corrections={corrections} />
        <NotesCard reviewId={review.id} notes={notes} />
      </DiagnosticDetail>

      {correcting && (
        <CorrectionModal
          key={`${correcting.id}-${openCount}`}
          question={correcting}
          current={latest.get(correcting.id) ?? null}
          reviewId={review.id}
          version={review.version}
          diagnosticId={review.diagnostic.id}
          onDone={(result) => {
            if (handle(result, "Corrección guardada. Recalcula para usarla.")) {
              setCorrecting(null);
            }
          }}
          onCancel={() => setCorrecting(null)}
        />
      )}
      {approving && (
        <ApproveModal
          key={`approve-${openCount}`}
          review={review}
          needsException={needsException}
          onDone={(result) => {
            if (handle(result, "Caso aprobado.")) setApproving(false);
          }}
          onCancel={() => setApproving(false)}
        />
      )}
      {reopening && (
        <ReopenModal
          key={`reopen-${openCount}`}
          review={review}
          onDone={(result) => {
            if (handle(result, "Caso reabierto.")) setReopening(false);
          }}
          onCancel={() => setReopening(false)}
        />
      )}
    </>
  );
}
