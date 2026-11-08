"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Button,
  Empty,
  Flex,
  Progress,
  Select,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import type {
  DiagnosticSummary,
  PaginatedDiagnostics,
} from "@/lib/api/diagnostics";
import {
  DIAGNOSTIC_STATUSES,
  DIAGNOSTIC_STATUS_COLORS,
  DIAGNOSTIC_STATUS_LABELS,
  type DiagnosticStatus,
} from "@/lib/diagnostics/labels";
import {
  FAMILIES,
  FAMILY_LABELS,
  type DiagnosticFamily,
} from "@/lib/leads/labels";
import { ReactiveSearch } from "@/components/reactive-search";
import { LocalDate } from "@/components/local-date";
import { GenerateDiagnosticModal } from "./generate-diagnostic-modal";

interface DiagnosticsFilters {
  q: string;
  family?: DiagnosticFamily;
  status?: DiagnosticStatus;
}

interface DiagnosticsScreenProps {
  page: PaginatedDiagnostics;
  filters: DiagnosticsFilters;
  /** Generar sin pago es solo del Aprobador; la API lo valida igual. */
  canGenerate: boolean;
}

const plural = new Intl.PluralRules("es");

function totalText(total: number): string {
  const count = new Intl.NumberFormat("es").format(total);
  return `${count} ${plural.select(total) === "one" ? "diagnóstico" : "diagnósticos"}`;
}

const FAMILY_OPTIONS = FAMILIES.map((f) => ({ value: f, label: FAMILY_LABELS[f] }));
const STATUS_OPTIONS = DIAGNOSTIC_STATUSES.map((s) => ({
  value: s,
  label: DIAGNOSTIC_STATUS_LABELS[s],
}));

export function DiagnosticStatusTag({ status }: { status: DiagnosticStatus }) {
  return (
    <Tag color={DIAGNOSTIC_STATUS_COLORS[status]} style={{ marginInlineEnd: 0 }}>
      {DIAGNOSTIC_STATUS_LABELS[status]}
    </Tag>
  );
}

export function DiagnosticProgress({
  progress,
}: {
  progress: DiagnosticSummary["progress"];
}) {
  const percent =
    progress.total > 0 ? Math.round((progress.answered / progress.total) * 100) : 0;
  return (
    <Progress
      percent={percent}
      size="small"
      format={() => `${progress.answered}/${progress.total}`}
      aria-label={`${progress.answered} de ${progress.total} preguntas respondidas`}
    />
  );
}

export function diagnosticHref(id: string) {
  return `/diagnostics/${encodeURIComponent(id)}`;
}

/** Los datos llegan del Server Component; filtros y página viven en la URL. */
export function DiagnosticsScreen({
  page,
  filters,
  canGenerate,
}: DiagnosticsScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNavigation] = useTransition();
  const [searchReset, setSearchReset] = useState(0);
  // Sube en cada apertura: el modal monta un formulario nuevo.
  const [generateKey, setGenerateKey] = useState(0);
  const [generateOpen, setGenerateOpen] = useState(false);

  const hasFilters = Boolean(filters.q || filters.family || filters.status);

  function navigate(
    changes: Partial<DiagnosticsFilters> & { page?: number },
    { replace = false } = {},
  ) {
    const params = new URLSearchParams(searchParams);
    for (const key of ["q", "family", "status"] as const) {
      if (!(key in changes)) continue;
      const value = changes[key];
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const newPage = changes.page ?? 1;
    if (newPage > 1) params.set("page", String(newPage));
    else params.delete("page");

    const query = params.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    startNavigation(() => {
      if (replace) router.replace(target);
      else router.push(target);
    });
  }

  function clearFilters() {
    setSearchReset((n) => n + 1);
    navigate({ q: "", family: undefined, status: undefined });
  }

  const columns: TableColumnsType<DiagnosticSummary> = [
    {
      title: "Lead",
      key: "lead",
      render: (_, diagnostic) => (
        <div style={{ overflowWrap: "anywhere" }}>
          <Typography.Link
            href={diagnosticHref(diagnostic.id)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              router.push(diagnosticHref(diagnostic.id));
            }}
          >
            {diagnostic.lead.name}
          </Typography.Link>
          <Typography.Text type="secondary" style={{ display: "block" }}>
            {diagnostic.lead.email}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: "Familia",
      dataIndex: "family",
      key: "family",
      width: 130,
      render: (family: DiagnosticFamily) => FAMILY_LABELS[family],
    },
    {
      title: "Estado",
      dataIndex: "status",
      key: "status",
      width: 130,
      render: (status: DiagnosticStatus) => <DiagnosticStatusTag status={status} />,
    },
    {
      title: "Progreso",
      key: "progress",
      width: 170,
      render: (_, diagnostic) => (
        <DiagnosticProgress progress={diagnostic.progress} />
      ),
    },
    {
      title: "Última actividad",
      dataIndex: "lastActivityAt",
      key: "lastActivityAt",
      width: 180,
      render: (iso: string) => <LocalDate iso={iso} />,
    },
  ];

  const emptyState = hasFilters ? (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="Ningún diagnóstico coincide con los filtros."
    >
      <Button onClick={clearFilters}>Limpiar filtros</Button>
    </Empty>
  ) : (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        canGenerate
          ? "Todavía no hay diagnósticos. Genera el primero para un lead."
          : "Todavía no hay diagnósticos. Los genera un Aprobador."
      }
    />
  );

  return (
    <div>
      <Flex
        justify="space-between"
        align="center"
        gap={12}
        wrap
        style={{ marginBottom: 16 }}
      >
        <Typography.Title level={3} style={{ margin: 0, letterSpacing: "-0.01em" }}>
          Diagnósticos
        </Typography.Title>
        {canGenerate && (
          <Button
            type="primary"
            onClick={() => {
              setGenerateKey((k) => k + 1);
              setGenerateOpen(true);
            }}
          >
            Generar diagnóstico
          </Button>
        )}
      </Flex>

      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <ReactiveSearch
          resetKey={searchReset}
          initialValue={filters.q}
          onSearch={(q) => navigate({ q }, { replace: true })}
          placeholder="Buscar por nombre o correo del lead"
          ariaLabel="Buscar diagnósticos"
          loading={navigating}
          style={{ width: 320, maxWidth: "100%" }}
        />
        <Select<DiagnosticFamily>
          value={filters.family}
          placeholder="Todas las familias"
          aria-label="Filtrar por familia"
          allowClear
          options={FAMILY_OPTIONS}
          onChange={(family) => navigate({ family })}
          style={{ width: 200 }}
        />
        <Select<DiagnosticStatus>
          value={filters.status}
          placeholder="Todos los estados"
          aria-label="Filtrar por estado"
          allowClear
          options={STATUS_OPTIONS}
          onChange={(status) => navigate({ status })}
          style={{ width: 200 }}
        />
      </Flex>

      <Table<DiagnosticSummary>
        rowKey="id"
        size="middle"
        dataSource={page.data}
        columns={columns}
        loading={navigating}
        scroll={{ x: 900 }}
        locale={{ emptyText: emptyState }}
        onRow={(diagnostic) => ({
          onClick: () => router.push(diagnosticHref(diagnostic.id)),
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

      {canGenerate && (
        <GenerateDiagnosticModal
          key={generateKey}
          open={generateOpen}
          onClose={() => setGenerateOpen(false)}
        />
      )}
    </div>
  );
}
