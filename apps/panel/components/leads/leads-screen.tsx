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
import type { Lead, PaginaLeads } from "@/lib/api/leads";
import {
  COLORES_ESTADO_LEAD,
  ESTADOS_LEAD,
  ETIQUETAS_ESTADO_LEAD,
  ETIQUETAS_FAMILIA,
  FAMILIAS,
  type EstadoLead,
  type FamiliaDiagnostico,
} from "@/lib/leads/etiquetas";
import { accionCambiarEstadoLead } from "@/app/(panel)/leads/actions";
import { BuscadorReactivo } from "@/components/buscador-reactivo";
import { FechaLocal } from "@/components/fecha-local";

interface FiltrosLeads {
  q: string;
  familia?: FamiliaDiagnostico;
  estado?: EstadoLead;
}

interface LeadsScreenProps {
  pagina: PaginaLeads;
  filtros: FiltrosLeads;
}

const pluralLeads = new Intl.PluralRules("es");

function textoTotal(total: number): string {
  const cantidad = new Intl.NumberFormat("es").format(total);
  return `${cantidad} ${pluralLeads.select(total) === "one" ? "lead" : "leads"}`;
}

const OPCIONES_FAMILIA = FAMILIAS.map((f) => ({
  value: f,
  label: ETIQUETAS_FAMILIA[f],
}));

const OPCIONES_ESTADO = ESTADOS_LEAD.map((e) => ({
  value: e,
  label: ETIQUETAS_ESTADO_LEAD[e],
}));

/** "instagram · lanzamiento-2026", o null si el lead no trae UTM. */
function origen(lead: Lead): string | null {
  const partes = [lead.utmSource, lead.utmCampaign].filter(Boolean);
  return partes.length > 0 ? partes.join(" · ") : null;
}

function SinDato() {
  return <Typography.Text type="secondary">—</Typography.Text>;
}

function TagEstado({ estado }: { estado: EstadoLead }) {
  return (
    <Tag color={COLORES_ESTADO_LEAD[estado]} style={{ marginInlineEnd: 0 }}>
      {ETIQUETAS_ESTADO_LEAD[estado]}
    </Tag>
  );
}

/**
 * Los datos llegan del Server Component; filtros y página viven en la URL.
 * El cambio de estado es una Server Action con `revalidatePath`, que trae
 * la lista actualizada en la misma respuesta — no hay copia local.
 */
export function LeadsScreen({ pagina, filtros }: LeadsScreenProps) {
  const { message } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navegando, iniciarNavegacion] = useTransition();
  const [guardando, iniciarGuardado] = useTransition();

  // Último lead abierto, solo por si deja de estar en la página actual
  // (p. ej. al cambiarle el estado con un filtro por estado activo). Si
  // sigue en la página, manda la versión del servidor.
  const [abierto, setAbierto] = useState<Lead | null>(null);
  // Vacía el buscador al limpiar los filtros.
  const [reinicioBuscador, setReinicioBuscador] = useState(0);
  const leadAbierto = abierto
    ? (pagina.data.find((l) => l.id === abierto.id) ?? abierto)
    : null;

  const hayFiltros = Boolean(filtros.q || filtros.familia || filtros.estado);

  /**
   * Cambia filtros/página en la URL; cualquier filtro nuevo vuelve a la
   * página 1. `reemplazar` no agrega una entrada al historial: es para la
   * búsqueda mientras se escribe.
   */
  function navegar(
    cambios: Partial<FiltrosLeads> & { pagina?: number },
    { reemplazar = false } = {},
  ) {
    const params = new URLSearchParams(searchParams);
    for (const clave of ["q", "familia", "estado"] as const) {
      if (!(clave in cambios)) continue;
      const valor = cambios[clave];
      if (valor) params.set(clave, valor);
      else params.delete(clave);
    }
    const nuevaPagina = cambios.pagina ?? 1;
    if (nuevaPagina > 1) params.set("pagina", String(nuevaPagina));
    else params.delete("pagina");

    const query = params.toString();
    const destino = query ? `${pathname}?${query}` : pathname;
    iniciarNavegacion(() => {
      if (reemplazar) router.replace(destino);
      else router.push(destino);
    });
  }

  function limpiarFiltros() {
    setReinicioBuscador((n) => n + 1);
    navegar({ q: "", familia: undefined, estado: undefined });
  }

  function cambiarEstado(lead: Lead, estado: EstadoLead) {
    iniciarGuardado(async () => {
      const resultado = await accionCambiarEstadoLead(lead.id, estado);
      if (!resultado.ok) {
        message.error(resultado.error ?? "No pudimos cambiar el estado.");
        return;
      }
      if (resultado.lead) setAbierto(resultado.lead);
      message.success(
        `${lead.name} quedó como ${ETIQUETAS_ESTADO_LEAD[estado].toLowerCase()}.`,
      );
    });
  }

  const columnas: TableColumnsType<Lead> = [
    {
      title: "Nombre",
      dataIndex: "name",
      key: "name",
      render: (nombre: string, lead) => (
        <Typography.Link
          onClick={(e) => {
            e.stopPropagation();
            setAbierto(lead);
          }}
          style={{ overflowWrap: "anywhere" }}
        >
          {nombre}
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
      render: (telefono: string | null) =>
        telefono ? (
          <span style={{ whiteSpace: "nowrap" }}>{telefono}</span>
        ) : (
          <SinDato />
        ),
    },
    {
      title: "Familia",
      dataIndex: "family",
      key: "family",
      render: (familia: FamiliaDiagnostico) => ETIQUETAS_FAMILIA[familia],
    },
    {
      title: "Origen",
      key: "origen",
      render: (_, lead) => {
        const texto = origen(lead);
        return texto ? (
          <span style={{ overflowWrap: "anywhere" }}>{texto}</span>
        ) : (
          <SinDato />
        );
      },
    },
    {
      title: "Estado",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (estado: EstadoLead) => <TagEstado estado={estado} />,
    },
    {
      title: "Fecha",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 170,
      render: (creadoEn: string) => <FechaLocal iso={creadoEn} />,
    },
  ];

  const vacio = hayFiltros ? (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="Ningún lead coincide con los filtros."
    >
      <Button onClick={limpiarFiltros}>Limpiar filtros</Button>
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
        <BuscadorReactivo
          reinicio={reinicioBuscador}
          valorInicial={filtros.q}
          onBuscar={(q) => navegar({ q }, { reemplazar: true })}
          placeholder="Buscar por nombre o correo"
          ariaLabel="Buscar leads"
          cargando={navegando}
          style={{ width: 320, maxWidth: "100%" }}
        />
        <Select<FamiliaDiagnostico>
          value={filtros.familia}
          placeholder="Todas las familias"
          aria-label="Filtrar por familia"
          allowClear
          options={OPCIONES_FAMILIA}
          onChange={(familia) => navegar({ familia })}
          style={{ width: 200 }}
        />
        <Select<EstadoLead>
          value={filtros.estado}
          placeholder="Todos los estados"
          aria-label="Filtrar por estado"
          allowClear
          options={OPCIONES_ESTADO}
          onChange={(estado) => navegar({ estado })}
          style={{ width: 200 }}
        />
      </Flex>

      <Table<Lead>
        rowKey="id"
        size="middle"
        dataSource={pagina.data}
        columns={columnas}
        loading={navegando}
        scroll={{ x: 960 }}
        locale={{ emptyText: vacio }}
        onRow={(lead) => ({
          onClick: () => setAbierto(lead),
          style: { cursor: "pointer" },
        })}
        pagination={{
          current: pagina.page,
          pageSize: pagina.pageSize,
          total: pagina.total,
          showSizeChanger: false,
          hideOnSinglePage: true,
          showTotal: textoTotal,
          onChange: (nueva) => navegar({ pagina: nueva }),
        }}
      />

      <Drawer
        title={leadAbierto?.name}
        open={leadAbierto !== null}
        onClose={() => setAbierto(null)}
        size="large"
        destroyOnHidden
      >
        {leadAbierto && (
          <Flex vertical gap={24}>
            <div>
              <Typography.Text
                type="secondary"
                style={{ display: "block", marginBottom: 8 }}
              >
                Estado
              </Typography.Text>
              <Segmented<EstadoLead>
                value={leadAbierto.status}
                options={OPCIONES_ESTADO.map((o) => ({
                  ...o,
                  disabled: guardando,
                }))}
                onChange={(estado) => cambiarEstado(leadAbierto, estado)}
              />
            </div>

            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Correo">
                <Typography.Text
                  copyable
                  style={{ overflowWrap: "anywhere" }}
                >
                  {leadAbierto.email}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Teléfono">
                {leadAbierto.phone ? (
                  <Typography.Text copyable>
                    {leadAbierto.phone}
                  </Typography.Text>
                ) : (
                  <SinDato />
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Familia">
                {ETIQUETAS_FAMILIA[leadAbierto.family]}
              </Descriptions.Item>
              <Descriptions.Item label="Fuente (utm_source)">
                {leadAbierto.utmSource ?? <SinDato />}
              </Descriptions.Item>
              <Descriptions.Item label="Medio (utm_medium)">
                {leadAbierto.utmMedium ?? <SinDato />}
              </Descriptions.Item>
              <Descriptions.Item label="Campaña (utm_campaign)">
                {leadAbierto.utmCampaign ?? <SinDato />}
              </Descriptions.Item>
              <Descriptions.Item label="Recibido">
                <FechaLocal iso={leadAbierto.createdAt} />
              </Descriptions.Item>
              <Descriptions.Item label="Última actualización">
                <FechaLocal iso={leadAbierto.updatedAt} />
              </Descriptions.Item>
            </Descriptions>
          </Flex>
        )}
      </Drawer>
    </div>
  );
}
