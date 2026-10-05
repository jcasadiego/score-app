import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ProveedorAntd } from "@/components/proveedor-antd";
import "./globals.css";

export const metadata: Metadata = {
  title: "SCORE — Panel",
  description: "Panel interno de revisión SCORE (Music Finance Pro)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <body>
        <AntdRegistry>
          <ProveedorAntd>{children}</ProveedorAntd>
        </AntdRegistry>
      </body>
    </html>
  );
}
