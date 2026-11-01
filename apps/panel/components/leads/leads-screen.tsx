"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Segmented,
  Select,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import type { Lead, PaginatedLeads } from "@/lib/api/leads";
import {
  LEAD_STATUS_COLORS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  FAMILY_LABELS,
  FAMILIES,
  type LeadStatus,
  type DiagnosticFamily,
} from "@/lib/leads/labels";
import { updateLeadStatusAction } from "@/app/(panel)/leads/actions";
import { ReactiveSearch } from "@/components/reactive-search";
import { LocalDate } from "@/components/local-date";

interface LeadScreenFilters {
  q: string;
  family?: DiagnosticFamily;
  status?: LeadStatus;
}

interface LeadsScreenProps {
  page: PaginatedLeads;
  filters: LeadScreenFilters;
}

const pluralLeads = new Intl.PluralRules("es");

function totalText(total: number): string {
  const count = new Intl.NumberFormat("es").format(total);
  return `${count} ${pluralLeads.select(total) === "one" ? "lead" : "leads"}`;
}

const FAMILY_OPTIONS = FAMILIES.map((f) => ({
  value: f,
  label: FAMILY_LABELS[f],
}));

const STATUS_OPTIONS = LEAD_STATUSES.map((e) => ({
  value: e,
  label: LEAD_STATUS_LABELS[e],
}));

/** "instagram · lanzamiento-2026", o null si el lead no trae UTM. */
function leadSource(lead: Lead): string | null {
  const parts = [lead.utmSource, lead.utmCampaign].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function NoData() {
  return <Typography.Text type="secondary">—</Typography.Text>;
}

function StatusTag({ status }: { status: LeadStatus }) {
  return (
    <Tag color={LEAD_STATUS_COLORS[status]} style={{ marginInlineEnd: 0 }}>
      {LEAD_STATUS_LABELS[status]}
    </Tag>
  );
}

/**
 * Los datos llegan del Server Component; filtros y página viven en la URL.
 * El cambio de estado es una Server Action con `revalidatePath`, que trae
 * la lista actualizada en la misma respuesta — no hay copia local.
 */
export function LeadsScreen({ page, filters }: LeadsScreenProps) {
  const { message } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNavigation] = useTransition();
  const [saving, startSaving] = useTransition();

  // Último lead abierto, solo por si deja de estar en la página actual
  // (p. ej. al cambiarle el estado con un filtro por estado activo). Si
  // sigue en la página, manda la versión del servidor.
  const [lastOpenedLead, setLastOpenedLead] = useState<Lead | null>(null);
  // Vacía el buscador al limpiar los filtros.
  const [searchReset, setSearchReset] = useState(0);
  const openLead = lastOpenedLead
    ? (page.data.find((l) => l.id === lastOpenedLead.id) ?? lastOpenedLead)
    : null;

  const hasFilters = Boolean(filters.q || filters.family || filters.status);

  /**
   * Cambia filtros/página en la URL; cualquier filtro nuevo vuelve a la
   * página 1. `replace` no agrega una entrada al historial: es para la
   * búsqueda mientras se escribe.
   */
  function navigate(
    changes: Partial<LeadScreenFilters> & { page?: number },
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

  function changeStatus(lead: Lead, status: LeadStatus) {
    startSaving(async () => {
      const result = await updateLeadStatusAction(lead.id, status);
      if (!result.ok) {
        message.error(result.error ?? "No pudimos cambiar el estado.");
        return;
      }
      if (result.lead) setLastOpenedLead(result.lead);
      message.success(
        `${lead.name} quedó como ${LEAD_STATUS_LABELS[status].toLowerCase()}.`,
      );
    });
  }

  const columns: TableColumnsType<Lead> = [
    {
      title: "Nombre",
      dataIndex: "name",
      key: "name",
      render: (name: string, lead) => (
        <Typography.Link
          onClick={(e) => {
            e.stopPropagation();
            setLastOpenedLead(lead);
          }}
          style={{ overflowWrap: "anywhere" }}
        >
          {name}
        </Typography.Link>
      ),
    },
    {
      title: "Correo",
      dataIndex: "email",
      key: "email",
      render: (email: string) => (
        <span style={{ overflowWrap: "anywhere" }}>{email}</span>
      ),
    },
    {
      title: "Teléfono",
      dataIndex: "phone",
      key: "phone",
      render: (phone: string | null) =>
        phone ? (
          <span style={{ whiteSpace: "nowrap" }}>{phone}</span>
        ) : (
          <NoData />
        ),
    },
    {
      title: "Familia",
      dataIndex: "family",
      key: "family",
      render: (family: DiagnosticFamily) => FAMILY_LABELS[family],
    },
    {
      title: "Origen",
      key: "source",
      render: (_, lead) => {
        const text = leadSource(lead);
        return text ? (
          <span style={{ overflowWrap: "anywhere" }}>{text}</span>
        ) : (
          <NoData />
        );
      },
    },
    {
      title: "Estado",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (status: LeadStatus) => <StatusTag status={status} />,
    },
    {
      title: "Fecha",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 170,
      render: (createdAt: string) => <LocalDate iso={createdAt} />,
    },
  ];

  const emptyState = hasFilters ? (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="Ningún lead coincide con los filtros."
    >
      <Button onClick={clearFilters}>Limpiar filtros</Button>
    </Empty>
  ) : (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="Aún no llegan leads del formulario de precalificación."
    />
  );

  return (
    <div>
      <Typography.Title
        level={3}
        style={{ margin: 0, marginBottom: 16, letterSpacing: "-0.01em" }}
      >
        Leads
      </Typography.Title>

      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <ReactiveSearch
          resetKey={searchReset}
          initialValue={filters.q}
          onSearch={(q) => navigate({ q }, { replace: true })}
          placeholder="Buscar por nombre o correo"
          ariaLabel="Buscar leads"
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
        <Select<LeadStatus>
          value={filters.status}
          placeholder="Todos los estados"
          aria-label="Filtrar por estado"
          allowClear
          options={STATUS_OPTIONS}
          onChange={(status) => navigate({ status })}
          style={{ width: 200 }}
        />
      </Flex>

      <Table<Lead>
        rowKey="id"
        size="middle"
        dataSource={page.data}
        columns={columns}
        loading={navigating}
        scroll={{ x: 960 }}
        locale={{ emptyText: emptyState }}
        onRow={(lead) => ({
          onClick: () => setLastOpenedLead(lead),
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

      <Drawer
        title={openLead?.name}
        open={openLead !== null}
        onClose={() => setLastOpenedLead(null)}
        size="large"
        destroyOnHidden
      >
        {openLead && (
          <Flex vertical gap={24}>
            <div>
              <Typography.Text
                type="secondary"
                style={{ display: "block", marginBottom: 8 }}
              >
                Estado
              </Typography.Text>
              <Segmented<LeadStatus>
                value={openLead.status}
                options={STATUS_OPTIONS.map((o) => ({
                  ...o,
                  disabled: saving,
                }))}
                onChange={(status) => changeStatus(openLead, status)}
              />
            </div>

            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Correo">
                <Typography.Text
                  copyable
                  style={{ overflowWrap: "anywhere" }}
                >
                  {openLead.email}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Teléfono">
                {openLead.phone ? (
                  <Typography.Text copyable>
                    {openLead.phone}
                  </Typography.Text>
                ) : (
                  <NoData />
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Familia">
                {FAMILY_LABELS[openLead.family]}
              </Descriptions.Item>
              <Descriptions.Item label="Fuente (utm_source)">
                {openLead.utmSource ?? <NoData />}
              </Descriptions.Item>
              <Descriptions.Item label="Medio (utm_medium)">
                {openLead.utmMedium ?? <NoData />}
              </Descriptions.Item>
              <Descriptions.Item label="Campaña (utm_campaign)">
                {openLead.utmCampaign ?? <NoData />}
              </Descriptions.Item>
              <Descriptions.Item label="Recibido">
                <LocalDate iso={openLead.createdAt} />
              </Descriptions.Item>
              <Descriptions.Item label="Última actualización">
                <LocalDate iso={openLead.updatedAt} />
              </Descriptions.Item>
            </Descriptions>
          </Flex>
        )}
      </Drawer>
    </div>
  );
}
