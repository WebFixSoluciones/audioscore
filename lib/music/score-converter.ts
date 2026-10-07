import "server-only";
import createModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { validateMusicXML } from "./notation-validation";
let wasm: Promise<unknown> | undefined;
export async function renderNotation(
  xml: string,
  format: "mei" | "svg" | "pdf",
): Promise<Buffer> {
  validateMusicXML(xml);
  wasm ??= createModule();
  const toolkit = new VerovioToolkit(await wasm);
  try {
    toolkit.setOptions({
      inputFrom: "musicxml",
      pageWidth: 2100,
      pageHeight: 2970,
      scale: 40,
      adjustPageHeight: false,
      footer: "none",
      breaks: "auto",
    });
    if (!toolkit.loadData(xml))
      throw new Error("Verovio no pudo importar MusicXML");
    if (format === "mei") {
      const mei = toolkit.getMEI();
      if (!mei.includes("<mei")) throw new Error("MEI inválido");
      return Buffer.from(mei);
    }
    if (format === "svg") return Buffer.from(toolkit.renderToSVG(1));
    const pages = toolkit.getPageCount();
    if (pages < 1 || pages > 100)
      throw new Error("La partitura excede el límite de 100 páginas");
    const pdf = new PDFDocument({
      size: "A4",
      margin: 0,
      autoFirstPage: false,
      info: { Title: "AudioScore AI · Partitura" },
    });
    const chunks: Buffer[] = [];
    const output = new Promise<Buffer>((resolve, reject) => {
      pdf.on("data", (b) => chunks.push(b));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);
    });
    for (let p = 1; p <= pages; p++) {
      pdf.addPage();
      const svg = toolkit.renderToSVG(p);
      SVGtoPDF(pdf, svg, 0, 0, {
        width: pdf.page.width,
        height: pdf.page.height,
        preserveAspectRatio: "xMinYMin meet",
      });
    }
    pdf.end();
    return await output;
  } finally {
    toolkit.destroy();
  }
}
