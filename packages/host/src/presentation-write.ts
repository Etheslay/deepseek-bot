/**
 * Create a workspace .pptx from titled slides.
 *
 * The package is a designed 16:9 deck. One palette covers the file. Cover,
 * section, and summary slides are dark; the middle stays light. Layouts include
 * agenda, cards, steps, split, metrics, table, chart, quote, and bullets.
 * PowerPoint and the pptx reader see the same text. Chinese stays in the XML
 * and embeds that CJK face, plus a Latin face when one is installed. Slides can
 * carry an icon, a png/jpeg, and a fade-in. An optional PDF is the same deck
 * rendered by the Harness LibreOffice engine.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { EngineError } from "@deepseek-bot/runtime";
import {
  MAX_BULLET_CHARS,
  MAX_PRESENTATION_SLIDES,
  MAX_SLIDE_BULLETS,
  MAX_SLIDE_TITLE,
  PRESENTATION_PALETTES,
  type PresentationSlideInput,
  type WrittenPresentation,
} from "@deepseek-bot/agent-tools";
import { getBot, getWorkspace, type OpenedDatabase } from "@deepseek-bot/storage";
import { resolveInsideWorkspace } from "./artifacts.js";
import { parseAndStoreAttachment } from "./attachment-parse.js";
import { embeddedFaces, type EmbeddedFace } from "./presentation-font.js";
import { convertOfficeToPdf } from "./office-pdf.js";

const MAX_PRESENTATION_BYTES = 8 * 1024 * 1024;
const MAX_SLIDE_IMAGE_BYTES = 1_500_000;

let latinFamily = "Calibri";
let cjkFamily = "Microsoft YaHei";

function invalid(message: string): EngineError {
  return new EngineError({ code: "INVALID_INPUT", message, retryable: false });
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

interface DeckTone {
  readonly ink: string;
  readonly paper: string;
  readonly accent: string;
  readonly card: string;
  readonly cream: string;
  readonly muted: string;
  readonly mist: string;
}

const PALETTES = {
  ink: { ink: "1C1917", paper: "F7F7F5", accent: "C2410C", card: "F3F1EC", cream: "FFFBF5", muted: "5C564E", mist: "D6D0C6" },
  harbor: { ink: "0E3A4D", paper: "F4F7F8", accent: "1F6F8B", card: "E6EEF2", cream: "F7FBFC", muted: "4E6670", mist: "C5D4DC" },
  grove: { ink: "1B3A2F", paper: "F4F7F4", accent: "3E7A5A", card: "E5EFE8", cream: "F8FBF8", muted: "4E6356", mist: "C9D9CE" },
  clay: { ink: "3E2A24", paper: "F8F4F0", accent: "C4654A", card: "F1E6DE", cream: "FBF8F5", muted: "6A5348", mist: "E4D2C6" },
  dusk: { ink: "241C38", paper: "F6F5F8", accent: "7A5EA7", card: "E9E4F0", cream: "F8F7FB", muted: "5C5468", mist: "D5D0DE" },
  tide: { ink: "12343A", paper: "F3F7F7", accent: "0E8A86", card: "E3F0EF", cream: "F7FBFA", muted: "4A6564", mist: "C5DDDB" },
};

let tone: DeckTone = PALETTES.ink;

function titlePt(title: string, preferred: number): number {
  if (title.length > 24) return Math.min(preferred, 2800);
  if (title.length > 16) return Math.min(preferred, 3200);
  return preferred;
}

function run(text: string, size: number, bold: boolean, color: string): string {
  return (
    `<a:r><a:rPr lang="zh-CN" sz="${size}"${bold ? ` b="1"` : ""} dirty="0">` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` +
    `<a:latin typeface="${xmlEscape(latinFamily)}"/><a:ea typeface="${xmlEscape(cjkFamily)}"/>` +
    `</a:rPr><a:t>${xmlEscape(text)}</a:t></a:r>`
  );
}

function paragraph(
  text: string,
  size: number,
  bold: boolean,
  color: string,
  options?: { readonly bullet?: boolean; readonly align?: "l" | "ctr"; readonly before?: number },
): string {
  const before = options?.before ?? 0;
  const bullet = options?.bullet === true
    ? `<a:buFont typeface="${xmlEscape(latinFamily)}"/><a:buClr><a:srgbClr val="${tone.accent}"/></a:buClr><a:buChar char="•"/>`
    : `<a:buNone/>`;
  const margin = options?.bullet === true ? ` marL="285750" indent="-171450"` : "";
  return (
    `<a:p><a:pPr algn="${options?.align ?? "l"}"${margin}>` +
    `<a:lnSpc><a:spcPct val="115000"/></a:lnSpc>` +
    `<a:spcBef><a:spcPts val="${before}"/></a:spcBef>${bullet}</a:pPr>` +
    `${run(text, size, bold, color)}<a:endParaRPr lang="zh-CN" sz="${size}"/></a:p>`
  );
}

function textBox(
  id: number,
  name: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  body: string,
  anchor: "t" | "ctr" = "t",
): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/>` +
    `<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${anchor}"/>` +
    `<a:lstStyle/>${body}</p:txBody></p:sp>`
  );
}

function panel(id: number, x: number, y: number, cx: number, cy: number, color: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Panel ${id}"/>` +
    `<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`
  );
}

function backdrop(color: string): string {
  return `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
}

function cell(text: string, fill: string, color: string, bold: boolean): string {
  return (
    `<a:tc><a:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>` +
    paragraph(text, 1400, bold, color, { align: "ctr" }) +
    `</a:txBody><a:tcPr><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`
  );
}

function tableFrame(id: number, headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const width = Math.floor(10800000 / headers.length);
  const grid = headers.map(() => `<a:gridCol w="${width}"/>`).join("");
  const headerRow = `<a:tr h="460000">${headers.map((header) => cell(header, tone.ink, tone.cream, true)).join("")}</a:tr>`;
  const body = rows.map((row, index) => {
    const fill = index % 2 === 0 ? tone.card : tone.paper;
    return `<a:tr h="420000">${row.map((value) => cell(value, fill, tone.ink, false)).join("")}</a:tr>`;
  }).join("");
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table"/>` +
    `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="700000" y="1600000"/><a:ext cx="10800000" cy="4600000"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
    `<a:tbl><a:tblPr/><a:tblGrid>${grid}</a:tblGrid>${headerRow}${body}</a:tbl>` +
    `</a:graphicData></a:graphic></p:graphicFrame>`
  );
}

function chartFrame(id: number): string {
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart"/>` +
    `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="700000" y="1500000"/><a:ext cx="10800000" cy="4800000"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
    `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId2"/>` +
    `</a:graphicData></a:graphic></p:graphicFrame>`
  );
}

function chartXml(slide: PresentationSlideInput): string {
  const categories = slide.categories ?? [];
  const series = slide.series ?? [];
  const cats = categories.map((item, index) => `<c:pt idx="${index}"><c:v>${xmlEscape(item)}</c:v></c:pt>`).join("");
  const bars = series.map((item, index) => {
    const points = item.values.map((value, point) => `<c:pt idx="${point}"><c:v>${value}</c:v></c:pt>`).join("");
    const color = index === 0 ? tone.accent : tone.ink;
    return (
      `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>` +
      `<c:tx><c:v>${xmlEscape(item.name)}</c:v></c:tx>` +
      `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>` +
      `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>` +
      `<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>` +
      `<c:cat><c:strLit><c:ptCount val="${categories.length}"/>${cats}</c:strLit></c:cat>` +
      `<c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${item.values.length}"/>${points}</c:numLit></c:val>` +
      `</c:ser>`
    );
  }).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>` +
    `${bars}<c:axId val="1"/><c:axId val="2"/></c:barChart>` +
    `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>` +
    `<c:axPos val="b"/><c:crossAx val="2"/></c:catAx>` +
    `<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>` +
    `<c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea>` +
    `<c:legend><c:legendPos val="b"/></c:legend>` +
    `<c:plotVisOnly val="1"/></c:chart></c:chartSpace>`
  );
}

const ICON_PRESET: Record<string, string> = {
  arrow: "rightArrow",
  star: "star5",
  alert: "triangle",
  spark: "lightningBolt",
  target: "donut",
};

function disc(id: number, x: number, y: number, size: number, color: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Disc"/>` +
    `<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${size}" cy="${size}"/></a:xfrm>` +
    `<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`
  );
}

function roundPanel(id: number, x: number, y: number, cx: number, cy: number, color: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Card ${id}"/>` +
    `<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 8000"/></a:avLst></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`
  );
}

function iconShape(id: number, kind: string, color: string, x: number, y: number, size: number): string {
  const check = kind === "check";
  const geom = check
    ? `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/>` +
      `<a:pathLst><a:path w="100" h="100">` +
      `<a:moveTo><a:pt x="16" y="52"/></a:moveTo><a:lnTo><a:pt x="40" y="78"/></a:lnTo>` +
      `<a:lnTo><a:pt x="86" y="20"/></a:lnTo></a:path></a:pathLst></a:custGeom>`
    : `<a:prstGeom prst="${ICON_PRESET[kind] ?? "ellipse"}"><a:avLst/></a:prstGeom>`;
  const fill = check ? `<a:noFill/>` : `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
  const line = check
    ? `<a:ln w="45000" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>`
    : `<a:ln><a:noFill/></a:ln>`;
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Icon"/>` +
    `<p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="${x + Math.round(size * 0.24)}" y="${y + Math.round(size * 0.24)}"/>` +
    `<a:ext cx="${Math.round(size * 0.52)}" cy="${Math.round(size * 0.52)}"/></a:xfrm>` +
    `${geom}${fill}${line}</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`
  );
}

function pictureShape(id: number): string {
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture"/>` +
    `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="9000000" y="3900000"/><a:ext cx="2500000" cy="2200000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

function fadeTiming(shapeIds: readonly number[]): string {
  if (shapeIds.length === 0) return "";
  let next = 10;
  const effects = shapeIds.map((shapeId) => {
    const group = next++;
    const effect = next++;
    return (
      `<p:par><p:cTn id="${group}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst>` +
      `<p:childTnLst><p:animEffect transition="in" filter="fade"><p:cBhvr>` +
      `<p:cTn id="${effect}" dur="450"/><p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl>` +
      `</p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`
    );
  }).join("");
  return (
    `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">` +
    `<p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq">` +
    `<p:childTnLst>${effects}</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>` +
    `</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`
  );
}

interface SlideImage {
  readonly ext: "png" | "jpeg";
  readonly bytes: Uint8Array;
}

function slideDocument(
  slide: PresentationSlideInput,
  image: SlideImage | undefined,
): { readonly xml: string; readonly chartXml?: string; readonly image?: SlideImage } {
  const layout = slide.layout ?? "bullets";
  const parts: string[] = [];
  const motion: number[] = [];
  let nextId = 2;
  const add = (shape: string): void => {
    parts.push(shape);
    if (shape.includes('name="Panel')) return;
    const match = /<p:cNvPr id="(\d+)"/.exec(shape);
    if (match?.[1] !== undefined) motion.push(Number(match[1]));
  };
  const badge = (kind: string, x: number, y: number, size: number): void => {
    add(disc(nextId++, x, y, size, tone.accent));
    add(iconShape(nextId++, kind, tone.cream, x, y, size));
  };
  const dark = layout === "cover" || layout === "section" || layout === "summary";
  if (layout === "cover" || layout === "section") {
    const lines = [
      slide.kicker === undefined ? "" : paragraph(slide.kicker, 1400, true, tone.cream, { before: 0 }),
      paragraph(slide.title, titlePt(slide.title, layout === "cover" ? 4000 : 3600), true, tone.cream),
      slide.subtitle === undefined ? "" : paragraph(slide.subtitle, 1800, false, tone.mist, { before: 800 }),
    ].join("");
    add(textBox(nextId++, "Title", 720000, 2000000, 10400000, 2800000, lines));
    if (slide.icon === undefined) add(disc(nextId++, 720000, 1500000, 220000, tone.accent));
  } else if (layout === "summary") {
    const lines = [
      paragraph(slide.title, titlePt(slide.title, 3600), true, tone.cream),
      ...(slide.bullets ?? []).map((line) => paragraph(line, 2000, false, tone.cream, { bullet: true, before: 700 })),
    ].join("");
    add(textBox(nextId++, "Title", 900000, 1500000, 10000000, 4200000, lines));
    if (slide.icon === undefined) add(disc(nextId++, 720000, 980000, 220000, tone.accent));
  } else if (layout === "agenda") {
    add(textBox(nextId++, "Title", 640000, 420000, 10800000, 900000, paragraph(slide.title, titlePt(slide.title, 3600), true, tone.ink)));
    (slide.bullets ?? []).forEach((line, index) => {
      const y = 1600000 + index * 780000;
      add(disc(nextId++, 640000, y, 420000, tone.accent));
      add(textBox(nextId++, `N${index + 1}`, 640000, y, 420000, 420000, paragraph(String(index + 1), 1600, true, tone.cream, { align: "ctr" }), "ctr"));
      add(roundPanel(nextId++, 1220000, y, 10200000, 420000, tone.card));
      add(textBox(nextId++, `Item ${index + 1}`, 1400000, y, 9800000, 420000, paragraph(line, 1800, false, tone.ink), "ctr"));
    });
  } else if (layout === "steps") {
    const steps = slide.bullets ?? [];
    add(textBox(nextId++, "Title", 640000, 420000, 10800000, 900000, paragraph(slide.title, titlePt(slide.title, 3600), true, tone.ink)));
    const gap = 200000;
    const span = 10900000;
    const width = Math.floor((span - gap * (steps.length - 1)) / steps.length);
    steps.forEach((line, index) => {
      const x = 640000 + index * (width + gap);
      add(roundPanel(nextId++, x, 1900000, width, 3600000, tone.card));
      add(disc(nextId++, x + Math.floor((width - 520000) / 2), 2140000, 520000, tone.accent));
      add(textBox(
        nextId++,
        `N${index + 1}`,
        x + Math.floor((width - 520000) / 2),
        2140000,
        520000,
        520000,
        paragraph(String(index + 1), 1800, true, tone.cream, { align: "ctr" }),
        "ctr",
      ));
      add(textBox(nextId++, `Step ${index + 1}`, x + 120000, 2900000, width - 240000, 1800000, paragraph(line, 1800, true, tone.ink, { align: "ctr" }), "ctr"));
    });
  } else if (layout === "cards") {
    const cards = slide.cards ?? [];
    add(textBox(nextId++, "Title", 640000, 420000, 10800000, 900000, paragraph(slide.title, titlePt(slide.title, 3600), true, tone.ink)));
    const columns = cards.length === 4 ? 2 : cards.length;
    const gap = 200000;
    const span = 10900000;
    const width = Math.floor((span - gap * (columns - 1)) / columns);
    cards.forEach((card, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = 640000 + column * (width + gap);
      const y = 1600000 + row * (cards.length === 4 ? 2300000 : 0);
      const height = cards.length === 4 ? 2100000 : 2400000;
      add(roundPanel(nextId++, x, y, width, height, tone.card));
      const body = paragraph(card.title, 2000, true, tone.ink) +
        (card.text === undefined ? "" : paragraph(card.text, 1500, false, tone.muted, { before: 400 }));
      add(textBox(nextId++, `Card ${index + 1}`, x + 160000, y + 200000, width - 320000, height - 360000, body));
    });
  } else if (layout === "quote") {
    const hero = slide.quote ?? slide.title;
    const lines = [
      hero === slide.title ? "" : paragraph(slide.title, 1400, true, tone.accent),
      paragraph(hero, 3200, false, tone.ink, { before: hero === slide.title ? 0 : 800 }),
      slide.attribution === undefined ? "" : paragraph(slide.attribution, 1400, false, tone.muted, { before: 1000 }),
    ].join("");
    add(textBox(nextId++, "Quote", 1100000, 1800000, 10000000, 3200000, lines, "ctr"));
  } else if (layout === "split") {
    add(roundPanel(nextId++, 640000, 1700000, 5300000, 4400000, tone.card));
    add(roundPanel(nextId++, 6240000, 1700000, 5300000, 4400000, tone.card));
    add(textBox(nextId++, "Title", 640000, 420000, 10800000, 900000, paragraph(slide.title, titlePt(slide.title, 3600), true, tone.ink)));
    const column = (side: PresentationSlideInput["left"]): string => {
      const heading = side?.title === undefined ? "" : paragraph(side.title, 1800, true, tone.ink);
      const bullets = (side?.bullets ?? []).map((line) => paragraph(line, 1600, false, tone.ink, { bullet: true, before: 400 })).join("");
      return `${heading}${bullets}`;
    };
    add(textBox(nextId++, "Left", 820000, 1900000, 4940000, 3900000, column(slide.left)));
    add(textBox(nextId++, "Right", 6420000, 1900000, 4940000, 3900000, column(slide.right)));
  } else if (layout === "metrics") {
    const metrics = slide.metrics ?? [];
    add(textBox(nextId++, "Title", 640000, 420000, 10800000, 900000, paragraph(slide.title, titlePt(slide.title, 3600), true, tone.ink)));
    const gap = 180000;
    const span = 10800000;
    const cardWidth = Math.floor((span - gap * (metrics.length - 1)) / metrics.length);
    metrics.forEach((metric, index) => {
      const x = 640000 + index * (cardWidth + gap);
      add(panel(nextId++, x, 1900000, cardWidth, 3200000, tone.ink));
      add(textBox(
        nextId++,
        `Metric ${index + 1}`,
        x + 120000,
        2300000,
        cardWidth - 240000,
        2400000,
        paragraph(metric.value, 4000, true, tone.cream, { align: "ctr" }) +
          paragraph(metric.label, 1400, false, tone.mist, { align: "ctr", before: 600 }),
        "ctr",
      ));
    });
  } else if (layout === "table") {
    add(textBox(nextId++, "Title", 640000, 420000, 10800000, 900000, paragraph(slide.title, titlePt(slide.title, 3600), true, tone.ink)));
    add(tableFrame(nextId++, slide.headers ?? [], slide.rows ?? []));
  } else if (layout === "chart") {
    add(textBox(nextId++, "Title", 640000, 360000, 10800000, 800000, paragraph(slide.title, titlePt(slide.title, 3600), true, tone.ink)));
    add(chartFrame(nextId++));
  } else {
    const heading = [
      slide.kicker === undefined ? "" : paragraph(slide.kicker, 1400, true, tone.accent),
      paragraph(slide.title, titlePt(slide.title, 3600), true, tone.ink),
      slide.subtitle === undefined ? "" : paragraph(slide.subtitle, 1600, false, tone.muted, { before: 200 }),
    ].join("");
    add(textBox(nextId++, "Title", 640000, 420000, slide.icon === undefined ? 10800000 : 9800000, 1400000, heading));
    const bullets = (slide.bullets ?? []).map((line) => paragraph(line, 1600, false, tone.ink, { bullet: true, before: 500 })).join("");
    add(textBox(
      nextId++,
      "Body",
      640000,
      1760000,
      10800000,
      image === undefined ? 4500000 : 2000000,
      bullets.length > 0 ? bullets : `<a:p><a:endParaRPr lang="zh-CN" sz="1800"/></a:p>`,
    ));
  }
  if (slide.icon !== undefined) badge(slide.icon, 11020000, 380000, 560000);
  if (image !== undefined && layout !== "cards" && layout !== "steps" && layout !== "agenda") add(pictureShape(nextId++));
  const background = dark ? tone.ink : tone.paper;
  return {
    xml:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
      `<p:cSld>${backdrop(background)}<p:spTree>` +
      `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
      `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
      parts.join("") +
      `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
      `${fadeTiming(motion)}</p:sld>`,
    ...(layout === "chart" ? { chartXml: chartXml(slide) } : {}),
    ...(image !== undefined && layout !== "cards" && layout !== "steps" && layout !== "agenda" ? { image } : {}),
  };
}

const THEME_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">` +
  `<a:themeElements><a:clrScheme name="Office">` +
  `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
  `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="1F4E79"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="5B9BD5"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>` +
  `<a:accent3><a:srgbClr val="A9D08E"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="4472C4"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>` +
  `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>` +
  `</a:clrScheme><a:fontScheme name="Office">` +
  `<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>` +
  `</a:fontScheme><a:fmtScheme name="Office">` +
  `<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
  `<a:lnStyleLst>` +
  `<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
  `<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
  `<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
  `</a:lnStyleLst><a:effectStyleLst>` +
  `<a:effectStyle><a:effectLst/></a:effectStyle>` +
  `<a:effectStyle><a:effectLst/></a:effectStyle>` +
  `<a:effectStyle><a:effectLst/></a:effectStyle>` +
  `</a:effectStyleLst><a:bgFillStyleLst>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>` +
  `</a:bgFillStyleLst></a:fmtScheme></a:themeElements>` +
  `<a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

const LAYOUT_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
  `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="obj" preserve="1">` +
  `<p:cSld name="Title and Content"><p:spTree>` +
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
  `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
  `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const MASTER_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
  `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
  `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
  `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
  `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>` +
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ` +
  `accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
  `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

function normalizeSlides(slides: readonly PresentationSlideInput[]): PresentationSlideInput[] {
  if (slides.length < 1 || slides.length > MAX_PRESENTATION_SLIDES) {
    throw invalid(`presentation must contain 1 to ${MAX_PRESENTATION_SLIDES} slides`);
  }
  return slides.map((slide) => {
    const title = slide.title.trim();
    if (title.length < 1 || title.length > MAX_SLIDE_TITLE) {
      throw invalid(`slide title must be 1 to ${MAX_SLIDE_TITLE} characters`);
    }
    const layout = slide.layout ?? "bullets";
    const bullets = (slide.bullets ?? []).map((line) => line.trim()).filter((line) => line.length > 0);
    if (bullets.length > MAX_SLIDE_BULLETS) {
      throw invalid(`a slide can have at most ${MAX_SLIDE_BULLETS} bullets`);
    }
    if (bullets.some((line) => line.length > MAX_BULLET_CHARS)) {
      throw invalid(`a bullet can be at most ${MAX_BULLET_CHARS} characters`);
    }
    const column = (side: PresentationSlideInput["left"]): PresentationSlideInput["left"] => {
      if (side === undefined) return undefined;
      const columnBullets = (side.bullets ?? []).map((line) => line.trim()).filter((line) => line.length > 0);
      if (columnBullets.length > MAX_SLIDE_BULLETS) {
        throw invalid(`a slide can have at most ${MAX_SLIDE_BULLETS} bullets`);
      }
      return {
        ...(side.title !== undefined && side.title.trim().length > 0 ? { title: side.title.trim() } : {}),
        ...(columnBullets.length > 0 ? { bullets: columnBullets } : {}),
      };
    };
    if (layout === "quote" && (slide.quote === undefined || slide.quote.trim().length === 0)) {
      throw invalid("quote layout needs quote");
    }
    const left = column(slide.left);
    const right = column(slide.right);
    if (layout === "split" && (left?.bullets?.length ?? 0) + (right?.bullets?.length ?? 0) < 1) {
      throw invalid("split layout needs a column");
    }
    const metrics = (slide.metrics ?? []).map((metric) => ({ value: metric.value.trim(), label: metric.label.trim() }));
    if (layout === "metrics" && (metrics.length < 2 || metrics.length > 4)) {
      throw invalid("metrics layout needs 2 to 4 figures");
    }
    const headers = (slide.headers ?? []).map((header) => header.trim());
    const rows = (slide.rows ?? []).map((row) => row.map((cellText) => cellText.trim()));
    if (layout === "table" && (headers.length < 2 || rows.length < 1 || rows.some((row) => row.length !== headers.length))) {
      throw invalid("table rows must match its headers");
    }
    const categories = (slide.categories ?? []).map((item) => item.trim());
    const series = (slide.series ?? []).map((item) => ({ name: item.name.trim(), values: [...item.values] }));
    if (
      layout === "chart" &&
      (categories.length < 2 || series.length < 1 || series.some((item) => item.values.length !== categories.length))
    ) {
      throw invalid("chart series must match its categories");
    }
    if (layout === "agenda" && (bullets.length < 2 || bullets.some((line) => line.length > 40))) {
      throw invalid("agenda needs 2 to 6 short items");
    }
    if (layout === "steps" && (bullets.length < 3 || bullets.length > 4 || bullets.some((line) => line.length > 16))) {
      throw invalid("steps needs 3 or 4 short labels");
    }
    if (layout === "summary" && bullets.length < 1) throw invalid("summary needs bullets");
    const cards = (slide.cards ?? []).map((card) => ({
      title: card.title.trim(),
      ...(card.text !== undefined && card.text.trim().length > 0 ? { text: card.text.trim() } : {}),
    }));
    if (layout === "cards" && (cards.length < 2 || cards.length > 4)) {
      throw invalid("cards layout needs 2 to 4 cards");
    }
    const notes = slide.notes?.trim();
    return {
      layout,
      title,
      ...(slide.kicker !== undefined && slide.kicker.trim().length > 0 ? { kicker: slide.kicker.trim() } : {}),
      ...(slide.subtitle !== undefined && slide.subtitle.trim().length > 0 ? { subtitle: slide.subtitle.trim() } : {}),
      ...(bullets.length > 0 ? { bullets } : {}),
      ...(left !== undefined ? { left } : {}),
      ...(right !== undefined ? { right } : {}),
      ...(slide.quote !== undefined && slide.quote.trim().length > 0 ? { quote: slide.quote.trim() } : {}),
      ...(slide.attribution !== undefined && slide.attribution.trim().length > 0
        ? { attribution: slide.attribution.trim() }
        : {}),
      ...(metrics.length > 0 ? { metrics } : {}),
      ...(headers.length > 0 ? { headers } : {}),
      ...(rows.length > 0 ? { rows } : {}),
      ...(categories.length > 0 ? { categories } : {}),
      ...(series.length > 0 ? { series } : {}),
      ...(cards.length > 0 ? { cards } : {}),
      ...(notes !== undefined && notes.length > 0 ? { notes } : {}),
      ...(slide.icon !== undefined ? { icon: slide.icon } : {}),
      ...(slide.image !== undefined ? { image: slide.image } : {}),
    };
  });
}

function deckText(slides: readonly PresentationSlideInput[]): string {
  return slides.map((slide) => [
    slide.kicker, slide.title, slide.subtitle, ...(slide.bullets ?? []),
    slide.left?.title, ...(slide.left?.bullets ?? []),
    slide.right?.title, ...(slide.right?.bullets ?? []),
    slide.quote, slide.attribution,
    ...(slide.metrics ?? []).flatMap((metric) => [metric.value, metric.label]),
    ...(slide.headers ?? []), ...(slide.rows ?? []).flat(),
    ...(slide.categories ?? []), ...(slide.series ?? []).flatMap((item) => [item.name, ...item.values.map(String)]),
    ...(slide.cards ?? []).flatMap((card) => [card.title, card.text]),
    slide.notes,
  ].filter((item) => item !== undefined).join("")).join("");
}

function embeddedFontXml(faces: readonly EmbeddedFace[], firstRel: number): {
  readonly xml: string;
  readonly rels: string;
  readonly files: Record<string, Uint8Array>;
} {
  const files: Record<string, Uint8Array> = {};
  const rels: string[] = [];
  const entries: string[] = [];
  let rel = firstRel;
  let file = 1;
  for (const face of faces) {
    const regularId = `rId${rel++}`;
    files[`ppt/fonts/font${file}.fntdata`] = face.regular;
    rels.push(
      `<Relationship Id="${regularId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${file}.fntdata"/>`,
    );
    file += 1;
    let boldId = "";
    if (face.bold !== undefined) {
      boldId = `rId${rel++}`;
      files[`ppt/fonts/font${file}.fntdata`] = face.bold;
      rels.push(
        `<Relationship Id="${boldId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${file}.fntdata"/>`,
      );
      file += 1;
    }
    entries.push(
      `<p:embeddedFont><p:font typeface="${xmlEscape(face.family)}" pitchFamily="34" charset="0"/>` +
      `<p:regular r:id="${regularId}"/>${boldId === "" ? "" : `<p:bold r:id="${boldId}"/>`}</p:embeddedFont>`,
    );
  }
  return {
    xml: entries.length === 0 ? "" : `<p:embeddedFontLst>${entries.join("")}</p:embeddedFontLst>`,
    rels: rels.join(""),
    files,
  };
}

/** One 16:9 deck. Slide text round-trips through the pptx reader. */
export async function buildPptx(
  slides: readonly PresentationSlideInput[],
  images?: ReadonlyMap<number, SlideImage>,
  palette?: (typeof PRESENTATION_PALETTES)[number],
): Promise<Uint8Array> {
  const deck = normalizeSlides(slides);
  tone = palette === "harbor" ? PALETTES.harbor
    : palette === "grove" ? PALETTES.grove
      : palette === "clay" ? PALETTES.clay
        : palette === "dusk" ? PALETTES.dusk
          : palette === "tide" ? PALETTES.tide
            : PALETTES.ink;
  const faces = await embeddedFaces(deckText(deck));
  latinFamily = faces.latin?.family ?? "Calibri";
  cjkFamily = faces.cjk?.family ?? "Microsoft YaHei";
  const files: Record<string, Uint8Array> = {
    "ppt/theme/theme1.xml": strToU8(
      THEME_XML
        .replaceAll('typeface="Calibri Light"', `typeface="${xmlEscape(latinFamily)}"`)
        .replaceAll('typeface="Calibri"', `typeface="${xmlEscape(latinFamily)}"`)
        .replaceAll('<a:ea typeface=""/>', `<a:ea typeface="${xmlEscape(cjkFamily)}"/>`),
    ),
    "ppt/slideLayouts/slideLayout1.xml": strToU8(LAYOUT_XML),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
        `</Relationships>`,
    ),
    "ppt/slideMasters/slideMaster1.xml": strToU8(MASTER_XML),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>` +
        `</Relationships>`,
    ),
    "docProps/core.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
        `<dc:title>Presentation</dc:title><dc:creator>DeepSeek Bot</dc:creator></cp:coreProperties>`,
    ),
    "docProps/app.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
        `<Application>DeepSeek Bot</Application><Slides>${deck.length}</Slides>` +
        `<PresentationFormat>Widescreen</PresentationFormat></Properties>`,
    ),
  };
  const slideIds: string[] = [];
  const presentationRels: string[] = [
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
  ];
  const overrides: string[] = [
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
  ];
  const notesMaster =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ` +
    `accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `</p:notesMaster>`;
  let notesMasterId: string | undefined;
  if (deck.some((slide) => slide.notes !== undefined)) {
    notesMasterId = `rId${deck.length + 2}`;
    files["ppt/notesMasters/notesMaster1.xml"] = strToU8(notesMaster);
    files["ppt/notesMasters/_rels/notesMaster1.xml.rels"] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>` +
        `</Relationships>`,
    );
    presentationRels.push(
      `<Relationship Id="${notesMasterId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>`,
    );
    overrides.push(
      `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`,
    );
  }
  let usesPng = false;
  let usesJpeg = false;
  deck.forEach((slide, index) => {
    const number = index + 1;
    const rel = `rId${number + 1}`;
    const image = images?.get(index);
    if (slide.image !== undefined && image === undefined) throw invalid("slide image was not loaded");
    const built = slideDocument(slide, image);
    files[`ppt/slides/slide${number}.xml`] = strToU8(built.xml);
    const rels = [
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
    ];
    if (built.chartXml !== undefined) {
      files[`ppt/charts/chart${number}.xml`] = strToU8(built.chartXml);
      rels.push(
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${number}.xml"/>`,
      );
      overrides.push(
        `<Override PartName="/ppt/charts/chart${number}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
      );
    }
    if (built.image !== undefined) {
      const extension = built.image.ext === "png" ? "png" : "jpeg";
      if (extension === "png") usesPng = true;
      else usesJpeg = true;
      files[`ppt/media/image${number}.${extension}`] = built.image.bytes;
      rels.push(
        `<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${number}.${extension}"/>`,
      );
    }
    if (slide.notes !== undefined) {
      const noteRel = built.chartXml === undefined ? "rId2" : "rId3";
      files[`ppt/notesSlides/notesSlide${number}.xml`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
          `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
          `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
          `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
          `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
          `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
          textBox(2, "Notes", 400000, 400000, 6000000, 8000000, paragraph(slide.notes, 1400, false, tone.ink)) +
          `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`,
      );
      files[`ppt/notesSlides/_rels/notesSlide${number}.xml.rels`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>` +
          `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${number}.xml"/>` +
          `</Relationships>`,
      );
      rels.push(
        `<Relationship Id="${noteRel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${number}.xml"/>`,
      );
      overrides.push(
        `<Override PartName="/ppt/notesSlides/notesSlide${number}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
      );
    }
    files[`ppt/slides/_rels/slide${number}.xml.rels`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `${rels.join("")}</Relationships>`,
    );
    slideIds.push(`<p:sldId id="${256 + index}" r:id="${rel}"/>`);
    presentationRels.push(
      `<Relationship Id="${rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${number}.xml"/>`,
    );
    overrides.push(
      `<Override PartName="/ppt/slides/slide${number}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    );
  });
  const fontFaces = [faces.latin, faces.cjk].filter((face): face is EmbeddedFace => face !== undefined);
  let maxRel = 1;
  for (const rel of presentationRels) {
    const match = /Id="rId(\d+)"/.exec(rel);
    if (match?.[1] !== undefined) maxRel = Math.max(maxRel, Number(match[1]));
  }
  const embedded = embeddedFontXml(fontFaces, maxRel + 1);
  Object.assign(files, embedded.files);
  if (embedded.rels.length > 0) presentationRels.push(embedded.rels);
  files["ppt/presentation.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" embedTrueTypeFonts="1" saveSubsetFonts="1">` +
      `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      (notesMasterId === undefined ? "" : `<p:notesMasterIdLst><p:notesMasterId r:id="${notesMasterId}"/></p:notesMasterIdLst>`) +
      `<p:sldIdLst>${slideIds.join("")}</p:sldIdLst>` +
      `<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>` +
      `<p:notesSz cx="6858000" cy="9144000"/>${embedded.xml}</p:presentation>`,
  );
  files["ppt/_rels/presentation.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `${presentationRels.join("")}</Relationships>`,
  );
  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      (fontFaces.length > 0 ? `<Default Extension="fntdata" ContentType="application/x-fontdata"/>` : "") +
      (usesPng ? `<Default Extension="png" ContentType="image/png"/>` : "") +
      (usesJpeg ? `<Default Extension="jpeg" ContentType="image/jpeg"/>` : "") +
      `${overrides.join("")}</Types>`,
  );
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
      `</Relationships>`,
  );
  return zipSync(files);
}

function readSlideImage(root: string, relativePath: string): SlideImage {
  if (!/\.(png|jpe?g)$/i.test(relativePath)) throw invalid("slide image must be a png or jpeg");
  const segments = relativePath.split(/[\\/]/);
  if (
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.some((segment) => segment.startsWith("."))
  ) {
    throw invalid("slide image must stay inside the bot workspace");
  }
  const absolute = resolveInsideWorkspace(root, relativePath).absolute;
  if (!fs.existsSync(absolute)) throw invalid("slide image was not found");
  const bytes = fs.readFileSync(absolute);
  if (bytes.byteLength > MAX_SLIDE_IMAGE_BYTES) throw invalid("slide image exceeds 1.5 MB");
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) throw invalid("slide image must be a png or jpeg");
  return { ext: png ? "png" : "jpeg", bytes };
}

function workspaceFile(root: string, relativePath: string, extension: "pptx" | "pdf"): string {
  if (!new RegExp(`\\.${extension}$`, "i").test(relativePath)) {
    throw invalid(`path must end with .${extension}`);
  }
  const segments = relativePath.split(/[\\/]/);
  if (
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.some((segment) => segment.startsWith("."))
  ) {
    throw invalid("presentation path must stay inside the bot workspace");
  }
  return resolveInsideWorkspace(root, relativePath).absolute;
}

export async function writePresentationAt(
  root: string,
  relativePath: string,
  slides: readonly PresentationSlideInput[],
  pdfPath?: string,
  palette?: (typeof PRESENTATION_PALETTES)[number],
): Promise<WrittenPresentation> {
  const absolute = workspaceFile(root, relativePath, "pptx");
  const pdfAbsolute = pdfPath === undefined ? undefined : workspaceFile(root, pdfPath, "pdf");
  if (pdfAbsolute !== undefined && pdfAbsolute === absolute) {
    throw invalid("pdf path must be a different file");
  }
  const images = new Map<number, SlideImage>();
  for (const [index, slide] of slides.entries()) {
    if (slide.image === undefined) continue;
    images.set(index, readSlideImage(root, slide.image));
  }
  const bytes = await buildPptx(slides, images, palette);
  if (bytes.byteLength > MAX_PRESENTATION_BYTES) {
    throw invalid("written presentation exceeds 8 MB");
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, absolute);
  const stored = path.relative(root, absolute).split(path.sep).join("/");
  if (pdfAbsolute === undefined) {
    return { path: stored, bytes: bytes.byteLength, format: "pptx", slides: slides.length };
  }
  const pdfBytes = await convertOfficeToPdf(absolute, pdfAbsolute);
  const storedPdf = path.relative(root, pdfAbsolute).split(path.sep).join("/");
  return {
    path: stored,
    bytes: bytes.byteLength,
    format: "pptx",
    slides: slides.length,
    pdfPath: storedPdf,
    pdfBytes,
  };
}

export async function writeBotPresentation(
  db: OpenedDatabase,
  botId: string,
  relativePath: string,
  slides: readonly PresentationSlideInput[],
  pdfPath?: string,
  palette?: (typeof PRESENTATION_PALETTES)[number],
): Promise<WrittenPresentation> {
  const bot = getBot(db, botId);
  if (bot === undefined) throw invalid(`bot '${botId}' was not found`);
  if (bot.archivedAt !== null) throw invalid("archived bots have no workspace");
  const workspace = getWorkspace(db, bot.workspaceId);
  if (workspace === undefined) throw invalid(`workspace '${bot.workspaceId}' was not found`);
  const written = await writePresentationAt(workspace.canonicalPath, relativePath, slides, pdfPath, palette);
  const checksum = createHash("sha256").update(fs.readFileSync(
    path.resolve(workspace.canonicalPath, ...written.path.split("/")),
  )).digest("hex");
  await parseAndStoreAttachment(db, botId, written.path, checksum);
  if (written.pdfPath !== undefined) {
    const pdfChecksum = createHash("sha256").update(fs.readFileSync(
      path.resolve(workspace.canonicalPath, ...written.pdfPath.split("/")),
    )).digest("hex");
    await parseAndStoreAttachment(db, botId, written.pdfPath, pdfChecksum);
  }
  return written;
}
