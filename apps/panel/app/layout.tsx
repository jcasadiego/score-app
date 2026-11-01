import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { AntdProvider } from "@/components/antd-provider";
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
          <AntdProvider>{children}</AntdProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
