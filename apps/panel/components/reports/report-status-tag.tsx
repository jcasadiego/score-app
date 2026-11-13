"use client";

import { Tag } from "antd";
import type { ReviewReportSummary } from "@/lib/api/reviews";
import { reportStatusView } from "@/lib/reports/labels";

/** Estado del informe del caso: en la bandeja, el caso y la pantalla del informe. */
export function ReportStatusTag({ report }: { report: ReviewReportSummary | null }) {
  const { label, color } = reportStatusView(report);
  return (
    <Tag color={color} style={{ marginInlineEnd: 0 }}>
      {label}
    </Tag>
  );
}
