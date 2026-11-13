"use client";

import { ReportStatusTag } from "@/components/reports/report-status-tag";
import { useState, useTransition, type MouseEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  App,
  Button,
  Empty,
  Segmented,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import type { PaginatedReviews, ReviewListItem } from "@/lib/api/reviews";
import {
  REVIEW_VIEWS,
  REVIEW_VIEW_LABELS,
  type ReviewStatus,
  type ReviewView,
} from "@/lib/reviews/labels";
import { FAMILY_LABELS, type DiagnosticFamily } from "@/lib/leads/labels";
import { LocalDate } from "@/components/local-date";
import {
  releaseReviewAction,
  takeReviewAction,
} from "@/app/(panel)/reviews/actions";
import {
  AssigneeText,
  ReviewStatusTag,
  assignmentActions,
  reviewHref,
} from "./review-tags";

interface ReviewsScreenProps {
  page: PaginatedReviews;
  view?: ReviewView;
  me: { id: string; isApprover: boolean };
}

const plural = new Intl.PluralRules("es");

function totalText(total: number): string {
  const count = new Intl.NumberFormat("es").format(total);
  return `${count} ${plural.select(total) === "one" ? "caso" : "casos"}`;
}

const VIEW_OPTIONS = [
  { value: "all", label: REVIEW_VIEW_LABELS.all },
  ...REVIEW_VIEWS.map((v) => ({ value: v, label: REVIEW_VIEW_LABELS[v] })),
];

const EMPTY_TEXT: Record<ReviewView | "all", string> = {
  all: "Todavía no hay casos: llegan aquí cuando un diagnóstico enviado tiene su resultado del motor.",
  unassigned: "No hay casos sin tomar.",
  mine: "No tienes casos tomados.",
  approved: "Todavía no hay casos aprobados.",
};

/** Bandeja de revisión (PF-40). Los datos llegan del Server Component. */
export function ReviewsScreen({ page, view, me }: ReviewsScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { message, modal } = App.useApp();
  const [navigating, startNavigation] = useTransition();
  const [busy, startBusy] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function navigate(changes: { view?: ReviewView; page?: number }) {
    const params = new URLSearchParams(searchParams);
    if ("view" in changes) {
      if (changes.view) params.set("view", changes.view);
      else params.delete("view");
    }
    const newPage = changes.page ?? 1;
    if (newPage > 1) params.set("page", String(newPage));
    else params.delete("page");
    const query = params.toString();
    startNavigation(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  function run(review: ReviewListItem, take: boolean) {
    setBusyId(review.id);
    startBusy(async () => {
      const result = take
        ? await takeReviewAction(review.id)
        : await releaseReviewAction(review.id);
      setBusyId(null);
      if (result.ok) {
        message.success(take ? "Tomaste el caso." : "Caso liberado.");
      } else {
        message.error(result.error ?? "No pudimos completar la acción.");
      }
    });
  }

  function release(review: ReviewListItem, releasesOther: boolean) {
    if (!releasesOther) return run(review, false);
    modal.confirm({
      title: "¿Liberar un caso de otra persona?",
      content: `${review.assignee?.name ?? "Otra persona"} lo tiene tomado. Al liberarlo, cualquiera podrá tomarlo.`,
      okText: "Liberar",
      cancelText: "Cancelar",
      onOk: () => run(review, false),
    });
  }

  const columns: TableColumnsType<ReviewListItem> = [
    {
      title: "Lead",
      key: "lead",
      width: 220,
      render: (_, review) => (
        <Typography.Link
          href={reviewHref(review.id)}
          style={{ overflowWrap: "anywhere" }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            router.push(reviewHref(review.id));
          }}
        >
          {review.diagnostic.leadName}
        </Typography.Link>
      ),
    },
    {
      title: "Familia",
      key: "family",
      width: 130,
      render: (_, review) =>
        FAMILY_LABELS[review.diagnostic.family as DiagnosticFamily],
    },
    {
      title: "Estado",
      dataIndex: "status",
      key: "status",
      width: 130,
      render: (status: ReviewStatus) => <ReviewStatusTag status={status} />,
    },
    {
      title: "Revisor",
      key: "assignee",
      width: 180,
      render: (_, review) => (
        <AssigneeText assignee={review.assignee} meId={me.id} />
      ),
    },
    {
      title: "Alertas",
      dataIndex: "openFlags",
      key: "openFlags",
      width: 120,
      render: (count: number) =>
        count > 0 ? (
          <Tag color="red" style={{ marginInlineEnd: 0 }}>
            {count === 1 ? "1 abierta" : `${count} abiertas`}
          </Tag>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "Informe",
      key: "report",
      width: 170,
      render: (_, review) => <ReportStatusTag report={review.report} />,
    },
    {
      title: "Enviado",
      key: "completedAt",
      width: 170,
      render: (_, review) =>
        review.diagnostic.completedAt ? (
          <LocalDate iso={review.diagnostic.completedAt} />
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "Acción",
      key: "action",
      width: 120,
      render: (_, review) => {
        const actions = assignmentActions(review.assignee, me);
        const loading = busy && busyId === review.id;
        // Sin propagar el clic: la fila abre el caso.
        const stop = (e: MouseEvent) => e.stopPropagation();
        if (actions.canTake) {
          return (
            <span onClick={stop}>
              <Button
                size="small"
                type="primary"
                loading={loading}
                disabled={busy && !loading}
                onClick={() => run(review, true)}
              >
                Tomar
              </Button>
            </span>
          );
        }
        if (actions.canRelease) {
          return (
            <span onClick={stop}>
              <Button
                size="small"
                loading={loading}
                disabled={busy && !loading}
                onClick={() => release(review, actions.releasesOther)}
              >
                Liberar
              </Button>
            </span>
          );
        }
        return <Typography.Text type="secondary">—</Typography.Text>;
      },
    },
  ];

  return (
    <div>
      <Typography.Title
        level={3}
        style={{ margin: 0, marginBottom: 16, letterSpacing: "-0.01em" }}
      >
        Bandeja de revisión
      </Typography.Title>

      <div style={{ marginBottom: 16, maxWidth: "100%", overflowX: "auto" }}>
        <Segmented
          aria-label="Filtrar casos"
          value={view ?? "all"}
          options={VIEW_OPTIONS}
          onChange={(value) =>
            navigate({ view: value === "all" ? undefined : (value as ReviewView) })
          }
        />
      </div>

      <Table<ReviewListItem>
        rowKey="id"
        size="middle"
        dataSource={page.data}
        columns={columns}
        loading={navigating}
        scroll={{ x: 1180 }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={EMPTY_TEXT[view ?? "all"]}
            >
              {view && (
                <Button onClick={() => navigate({ view: undefined })}>
                  Ver todos
                </Button>
              )}
            </Empty>
          ),
        }}
        onRow={(review) => ({
          onClick: () => router.push(reviewHref(review.id)),
          style: { cursor: "pointer" },
        })}
        pagination={{
          current: page.page,
          pageSize: page.pageSize,
          total: page.total,
          showSizeChanger: false,
          hideOnSinglePage: true,
          showTotal: totalText,
          onChange: (nextPage) => navigate({ page: nextPage }),
        }}
      />
    </div>
  );
}
