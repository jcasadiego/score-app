"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  App,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import type {
  LeadPaymentSummary,
  PaginatedPayments,
  Payment,
} from "@/lib/api/payments";
import {
  CURRENCIES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
  formatAmount,
  type CurrencyCode,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/payments/labels";
import {
  searchLeadsAction,
  type LeadOption,
} from "@/app/(panel)/diagnostics/actions";
import { LocalDate } from "@/components/local-date";
import { RegisterPaymentModal } from "./register-payment-modal";
import {
  ActivateDiagnosticModal,
  ConfirmPaymentModal,
  VoidPaymentModal,
} from "./payment-modals";

const SEARCH_DEBOUNCE_MS = 300;

export interface PaymentScreenFilters {
  status?: PaymentStatus;
  method?: PaymentMethod;
  currency?: CurrencyCode;
  leadId?: string;
  /** Instantes RFC 3339: el navegador los calcula en su zona horaria. */
  paidFrom?: string;
  paidTo?: string;
}

interface PaymentsScreenProps {
  page: PaginatedPayments;
  filters: PaymentScreenFilters;
  /** Con el filtro por lead: sus datos y su resumen de pagos. */
  lead: {
    id: string;
    name: string;
    email: string;
    summary: LeadPaymentSummary;
  } | null;
}

const pluralPayments = new Intl.PluralRules("es");
function totalText(total: number): string {
  const count = new Intl.NumberFormat("es").format(total);
  return `${count} ${pluralPayments.select(total) === "one" ? "pago" : "pagos"}`;
}

const subscribeNoop = () => () => {};
function useIsClient() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

/** `YYYY-MM-DD` local de un instante, para el selector de fecha. */
function localDay(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** Medianoche local de `YYYY-MM-DD`, más `addDays`, como instante. */
function dayStart(day: string, addDays = 0): string | undefined {
  if (!day) return undefined;
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date + addDays).toISOString();
}

/** El día del pago, sin hora (se registra a medianoche local). */
function PaidOn({ iso }: { iso: string }) {
  const isClient = useIsClient();
  return (
    <time dateTime={iso}>
      {isClient
        ? new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(
            new Date(iso),
          )
        : iso.slice(0, 10)}
    </time>
  );
}

type OpenModal =
  | { kind: "confirm" | "void"; paymentId: string; key: number }
  | { kind: "register" | "activate"; key: number }
  | null;

/**
 * Pagos (solo Aprobador). Filtros y página viven en la URL y los resuelve la
 * API; las acciones son Server Actions con `revalidatePath`, sin copia local.
 */
export function PaymentsScreen({ page, filters, lead }: PaymentsScreenProps) {
  const { message } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isClient = useIsClient();
  const [navigating, startNavigation] = useTransition();
  const [modal, setModal] = useState<OpenModal>(null);
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // El pago del modal, siempre en su versión del servidor: tras un 412 la
  // página se recarga y el reintento va con la versión nueva, sin perder lo
  // escrito en el formulario.
  const modalPayment =
    modal && (modal.kind === "confirm" || modal.kind === "void")
      ? page.data.find((p) => p.id === modal.paymentId)
      : undefined;

  const hasFilters = Object.values(filters).some(Boolean);

  function navigate(changes: Partial<PaymentScreenFilters> & { page?: number }) {
    const params = new URLSearchParams(searchParams);
    for (const key of [
      "status",
      "method",
      "currency",
      "leadId",
      "paidFrom",
      "paidTo",
    ] as const) {
      if (!(key in changes)) continue;
      const value = changes[key];
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const newPage = changes.page ?? 1;
    if (newPage > 1) params.set("page", String(newPage));
    else params.delete("page");
    const query = params.toString();
    startNavigation(() => {
      router.push(query ? `${pathname}?${query}` : pathname);
    });
  }

  function searchLeads(query: string) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      const found = await searchLeadsAction(query);
      setSearching(false);
      setLeadOptions(found.leads);
    }, SEARCH_DEBOUNCE_MS);
  }

  function open(next: NonNullable<OpenModal>) {
    setModal(next);
  }

  function done(text: string) {
    setModal(null);
    message.success(text);
  }

  const leadSelectOptions = [
    ...(lead && !leadOptions.some((o) => o.id === lead.id)
      ? [{ value: lead.id, label: `${lead.name} · ${lead.email}` }]
      : []),
    ...leadOptions.map((o) => ({ value: o.id, label: `${o.name} · ${o.email}` })),
  ];

  const columns: TableColumnsType<Payment> = [
    {
      title: "Fecha del pago",
      dataIndex: "paidAt",
      key: "paidAt",
      width: 140,
      render: (paidAt: string) => <PaidOn iso={paidAt} />,
    },
    {
      title: "Lead",
      key: "lead",
      render: (_, payment) => (
        <Typography.Link
          onClick={() => navigate({ leadId: payment.lead.id })}
          style={{ overflowWrap: "anywhere" }}
        >
          {payment.lead.name}
        </Typography.Link>
      ),
    },
    {
      title: "Monto",
      key: "amount",
      align: "right",
      render: (_, payment) => (
        <span style={{ whiteSpace: "nowrap" }}>
          {formatAmount(payment.amount, payment.currency)}
        </span>
      ),
    },
    {
      title: "Método",
      dataIndex: "method",
      key: "method",
      render: (method: PaymentMethod) => PAYMENT_METHOD_LABELS[method],
    },
    {
      title: "Referencia",
      dataIndex: "reference",
      key: "reference",
      render: (reference: string) => (
        <span style={{ overflowWrap: "anywhere" }}>{reference}</span>
      ),
    },
    {
      title: "Estado",
      key: "status",
      render: (_, payment) => (
        <Flex vertical gap={2}>
          <Tag
            color={PAYMENT_STATUS_COLORS[payment.status]}
            style={{ marginInlineEnd: 0, width: "fit-content" }}
          >
            {PAYMENT_STATUS_LABELS[payment.status]}
          </Tag>
          {payment.status === "CONFIRMED" && payment.confirmedAt && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {payment.confirmedBy?.name} ·{" "}
              <LocalDate iso={payment.confirmedAt} />
            </Typography.Text>
          )}
          {payment.status === "VOIDED" && (
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, overflowWrap: "anywhere" }}
            >
              {payment.voidedBy?.name}: {payment.voidReason}
            </Typography.Text>
          )}
        </Flex>
      ),
    },
    {
      title: "Acciones",
      key: "actions",
      width: 200,
      render: (_, payment) =>
        payment.status === "PENDING" ? (
          <Space size="small">
            <Button
              size="small"
              type="primary"
              onClick={() =>
                open({ kind: "confirm", paymentId: payment.id, key: Date.now() })
              }
            >
              Confirmar
            </Button>
            <Button
              size="small"
              danger
              onClick={() =>
                open({ kind: "void", paymentId: payment.id, key: Date.now() })
              }
            >
              Anular
            </Button>
          </Space>
        ) : null,
    },
  ];

  const emptyState = hasFilters ? (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="Ningún pago coincide con los filtros."
    >
      <Button
        onClick={() =>
          navigate({
            status: undefined,
            method: undefined,
            currency: undefined,
            leadId: undefined,
            paidFrom: undefined,
            paidTo: undefined,
          })
        }
      >
        Limpiar filtros
      </Button>
    </Empty>
  ) : (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="Aún no hay pagos. Se registran desde Leads."
    />
  );

  const summary = lead?.summary;
  const canActivate =
    summary !== undefined &&
    summary.diagnostic === null &&
    summary.confirmedCount > 0;

  return (
    <div>
      <Typography.Title
        level={3}
        style={{ margin: 0, marginBottom: 16, letterSpacing: "-0.01em" }}
      >
        Pagos
      </Typography.Title>

      {lead && summary && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Flex justify="space-between" align="center" gap={16} wrap>
            <div>
              <Typography.Text strong>{lead.name}</Typography.Text>{" "}
              <Typography.Text type="secondary">{lead.email}</Typography.Text>
              <div>
                Total confirmado:{" "}
                {summary.confirmedTotals.length === 0 ? (
                  <Typography.Text type="secondary">sin pagos confirmados</Typography.Text>
                ) : (
                  summary.confirmedTotals.map((total, index) => (
                    <span key={total.currency}>
                      {index > 0 && " + "}
                      <Typography.Text strong>
                        {formatAmount(total.amount, total.currency)}
                      </Typography.Text>
                    </span>
                  ))
                )}
              </div>
              <div>
                {summary.diagnostic ? (
                  <Typography.Text type="secondary">
                    Diagnóstico{" "}
                    {summary.diagnostic.activationType === "PAID"
                      ? "activado con pago"
                      : "generado sin pago"}
                    .
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary">
                    Todavía no tiene diagnóstico.
                  </Typography.Text>
                )}
              </div>
            </div>
            <Space wrap>
              <Button
                disabled={summary.pendingPaymentId !== null}
                title={
                  summary.pendingPaymentId
                    ? "Ya tiene un pago pendiente: confírmalo o anúlalo primero."
                    : undefined
                }
                onClick={() => open({ kind: "register", key: Date.now() })}
              >
                Registrar pago
              </Button>
              {summary.diagnostic ? (
                <Link
                  href={`/diagnostics/${encodeURIComponent(summary.diagnostic.id)}`}
                >
                  <Button>Ver diagnóstico</Button>
                </Link>
              ) : (
                <Button
                  type="primary"
                  disabled={!canActivate}
                  title={
                    canActivate
                      ? undefined
                      : "Confirma al menos un pago para activar el diagnóstico."
                  }
                  onClick={() => open({ kind: "activate", key: Date.now() })}
                >
                  Activar diagnóstico
                </Button>
              )}
            </Space>
          </Flex>
        </Card>
      )}

      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <Select<string>
          value={filters.leadId}
          placeholder="Todos los leads"
          aria-label="Filtrar por lead"
          allowClear
          showSearch={{ filterOption: false, onSearch: searchLeads }}
          loading={searching}
          onOpenChange={(visible) => {
            if (visible && leadOptions.length === 0) searchLeads("");
          }}
          notFoundContent={searching ? "Buscando…" : "Sin resultados"}
          options={leadSelectOptions}
          onChange={(leadId) => navigate({ leadId })}
          style={{ width: 280, maxWidth: "100%" }}
        />
        <Select<PaymentStatus>
          value={filters.status}
          placeholder="Todos los estados"
          aria-label="Filtrar por estado"
          allowClear
          options={PAYMENT_STATUSES.map((s) => ({
            value: s,
            label: PAYMENT_STATUS_LABELS[s],
          }))}
          onChange={(status) => navigate({ status })}
          style={{ width: 170 }}
        />
        <Select<PaymentMethod>
          value={filters.method}
          placeholder="Todos los métodos"
          aria-label="Filtrar por método"
          allowClear
          options={PAYMENT_METHODS.map((m) => ({
            value: m,
            label: PAYMENT_METHOD_LABELS[m],
          }))}
          onChange={(method) => navigate({ method })}
          style={{ width: 170 }}
        />
        <Select<CurrencyCode>
          value={filters.currency}
          placeholder="Todas las monedas"
          aria-label="Filtrar por moneda"
          allowClear
          options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          onChange={(currency) => navigate({ currency })}
          style={{ width: 160 }}
        />
        {/*
          Las fechas se muestran en la zona del navegador: solo en el cliente.
          Sin controlar: el filtro se aplica al salir del campo o con Enter, no
          con cada tecla (un año a medio escribir ya es una fecha válida).
        */}
        <Space.Compact>
          <Input
            key={`from-${isClient}-${filters.paidFrom ?? ""}`}
            type="date"
            aria-label="Pagados desde"
            defaultValue={isClient ? localDay(filters.paidFrom) : ""}
            onBlur={(e) => {
              const paidFrom = dayStart(e.target.value);
              if (paidFrom !== filters.paidFrom) navigate({ paidFrom });
            }}
            onPressEnter={(e) => e.currentTarget.blur()}
            style={{ width: 160 }}
          />
          <Input
            key={`to-${isClient}-${filters.paidTo ?? ""}`}
            type="date"
            aria-label="Pagados hasta"
            // `paidTo` es la medianoche del día siguiente (sin incluirla).
            defaultValue={
              isClient && filters.paidTo
                ? localDay(new Date(Date.parse(filters.paidTo) - 1).toISOString())
                : ""
            }
            onBlur={(e) => {
              const paidTo = dayStart(e.target.value, 1);
              if (paidTo !== filters.paidTo) navigate({ paidTo });
            }}
            onPressEnter={(e) => e.currentTarget.blur()}
            style={{ width: 160 }}
          />
        </Space.Compact>
      </Flex>

      <Table<Payment>
        rowKey="id"
        size="middle"
        dataSource={page.data}
        columns={columns}
        loading={navigating}
        scroll={{ x: 1000 }}
        locale={{ emptyText: emptyState }}
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

      {modal?.kind === "confirm" && modalPayment && (
        <ConfirmPaymentModal
          key={modal.key}
          payment={modalPayment}
          onClose={() => setModal(null)}
          onDone={done}
        />
      )}
      {modal?.kind === "void" && modalPayment && (
        <VoidPaymentModal
          key={modal.key}
          payment={modalPayment}
          onClose={() => setModal(null)}
          onDone={done}
        />
      )}
      {modal?.kind === "register" && lead && (
        <RegisterPaymentModal
          key={modal.key}
          lead={lead}
          onClose={() => setModal(null)}
          onRegistered={() => done("Pago registrado como pendiente.")}
        />
      )}
      {modal?.kind === "activate" && lead && summary && (
        <ActivateDiagnosticModal
          key={modal.key}
          lead={lead}
          summary={summary}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
