import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "AudioScore AI · Tu música, en detalle",
    template: "%s · AudioScore AI",
  },
  description:
    "Estudio musical para escuchar audio, revisar transcripciones, editar MIDI y generar partituras con confianza y archivos temporales.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
