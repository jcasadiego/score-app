import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider } from "antd";
import esES from "antd/locale/es_ES";
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
          <ConfigProvider locale={esES}>{children}</ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
