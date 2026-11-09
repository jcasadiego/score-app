"use client";

import { Tag, Typography } from "antd";
import type { ReviewAssignee } from "@/lib/api/reviews";
import {
  REVIEW_STATUS_COLORS,
  REVIEW_STATUS_LABELS,
  type ReviewStatus,
} from "@/lib/reviews/labels";

export function ReviewStatusTag({ status }: { status: ReviewStatus }) {
  return (
    <Tag color={REVIEW_STATUS_COLORS[status]} style={{ marginInlineEnd: 0 }}>
      {REVIEW_STATUS_LABELS[status]}
    </Tag>
  );
}

/** Quién tiene el caso; avisa si esa persona ya no tiene acceso. */
export function AssigneeText({
  assignee,
  meId,
}: {
  assignee: ReviewAssignee | null;
  meId: string;
}) {
  if (!assignee) {
    return <Typography.Text type="secondary">Sin tomar</Typography.Text>;
  }
  return (
    <span style={{ overflowWrap: "anywhere" }}>
      {assignee.id === meId ? "Tú" : assignee.name}
      {!assignee.active && (
        <Typography.Text type="secondary"> (desactivado)</Typography.Text>
      )}
    </span>
  );
}

export function reviewHref(id: string) {
  return `/reviews/${encodeURIComponent(id)}`;
}

/** Qué puede hacer cada quien con la toma del caso (la API lo valida igual). */
export function assignmentActions(
  assignee: ReviewAssignee | null,
  me: { id: string; isApprover: boolean },
) {
  const mine = assignee?.id === me.id;
  return {
    mine,
    canTake: !assignee || (!assignee.active && !mine),
    canRelease: Boolean(assignee) && (mine || me.isApprover),
    releasesOther: Boolean(assignee) && !mine,
  };
}
