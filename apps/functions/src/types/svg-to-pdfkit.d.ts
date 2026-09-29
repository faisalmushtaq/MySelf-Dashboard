declare module "svg-to-pdfkit" {
  interface SVGtoPDFOptions {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    assumePt?: boolean;
    precision?: number;
    fontCallback?: (family: string, bold: boolean, italic: boolean, options: { fauxBold: boolean; fauxItalic: boolean }) => string;
    warningCallback?: (message: string) => void;
    colorCallback?: (color: [[number, number, number], number], raw: string) => [[number, number, number], number];
  }
  function SVGtoPDF(doc: PDFKit.PDFDocument, svg: string, x: number, y: number, options?: SVGtoPDFOptions): void;
  export default SVGtoPDF;
}
