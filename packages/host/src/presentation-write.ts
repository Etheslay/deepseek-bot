/**
 * Create a workspace .pptx from titled slides.
 *
 * The package is a designed 16:9 deck: cover, section, bullets, split, quote,
 * metrics, table, and a column chart. Speaker notes stay off the slide.
 * PowerPoint and the pptx reader see the same text. Chinese stays in the XML
 * and names Microsoft YaHei. An optional PDF is the same deck rendered by the
 * Harness LibreOffice engine.
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
  type PresentationSlideInput,
  type WrittenPresentation,
} from "@deepseek-bot/agent-tools";
import { getBot, getWorkspace, type OpenedDatabase } from "@deepseek-bot/storage";
import { resolveInsideWorkspace } from "./artifacts.js";
import { parseAndStoreAttachment } from "./attachment-parse.js";
import { convertOfficeToPdf } from "./office-pdf.js";

const MAX_PRESENTATION_BYTES = 2 * 1024 * 1024;

function invalid(message: string): EngineError {
  return new EngineError({ code: "INVALID_INPUT", message, retryable: false });
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const INK = "1C1917";
const PAPER = "F7F3EC";
const EMBER = "C2410C";
const CREAM = "FFFBF5";
const MUTED = "6F675E";
const CARD = "FFFBF7";

function run(text: string, size: number, bold: boolean, color: string): string {
  return (
    `<a:r><a:rPr lang="zh-CN" sz="${size}"${bold ? ` b="1"` : ""} dirty="0">` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` +
    `<a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/>` +
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
    ? `<a:buFont typeface="Arial"/><a:buClr><a:srgbClr val="${EMBER}"/></a:buClr><a:buChar char="•"/>`
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
  const headerRow = `<a:tr h="460000">${headers.map((header) => cell(header, INK, CREAM, true)).join("")}</a:tr>`;
  const body = rows.map((row, index) => {
    const fill = index % 2 === 0 ? CARD : PAPER;
    return `<a:tr h="420000">${row.map((value) => cell(value, fill, INK, false)).join("")}</a:tr>`;
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
    const color = index === 0 ? EMBER : INK;
    return (
      `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>` +
      `<c:tx><c:v>${xmlEscape(item.name)}</c:v></c:tx>` +
      `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>` +
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
    `<c:legend><c:legendPos val="b"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`
  );
}

function slideDocument(slide: PresentationSlideInput): { readonly xml: string; readonly chartXml?: string } {
  const layout = slide.layout ?? "bullets";
  const parts: string[] = [];
  let nextId = 2;
  const add = (shape: string): void => {
    parts.push(shape);
  };
  if (layout === "cover") {
    add(panel(nextId++, 0, 0, 150000, 6858000, EMBER));
    const lines = [
      slide.kicker === undefined ? "" : paragraph(slide.kicker, 1400, true, EMBER, { before: 0 }),
      paragraph(slide.title, 4400, true, CREAM),
      slide.subtitle === undefined ? "" : paragraph(slide.subtitle, 1800, false, "D6D0C6", { before: 800 }),
    ].join("");
    add(textBox(nextId++, "Title", 720000, 1860000, 10600000, 2800000, lines, "ctr"));
  } else if (layout === "section") {
    add(panel(nextId++, 0, 0, 420000, 6858000, EMBER));
    const lines = [
      slide.kicker === undefined ? "" : paragraph(slide.kicker, 1400, true, EMBER),
      paragraph(slide.title, 4000, true, INK),
      slide.subtitle === undefined ? "" : paragraph(slide.subtitle, 1800, false, MUTED, { before: 600 }),
    ].join("");
    add(textBox(nextId++, "Title", 1100000, 2200000, 9800000, 2400000, lines, "ctr"));
  } else if (layout === "quote") {
    const hero = slide.quote ?? slide.title;
    const lines = [
      hero === slide.title ? "" : paragraph(slide.title, 1400, true, EMBER),
      paragraph(hero, 3200, false, INK, { before: hero === slide.title ? 0 : 800 }),
      slide.attribution === undefined ? "" : paragraph(slide.attribution, 1400, false, MUTED, { before: 1000 }),
    ].join("");
    add(textBox(nextId++, "Quote", 1100000, 1800000, 10000000, 3200000, lines, "ctr"));
  } else if (layout === "split") {
    add(panel(nextId++, 0, 0, 12192000, 90000, EMBER));
    add(panel(nextId++, 640000, 2100000, 5300000, 4000000, CARD));
    add(panel(nextId++, 6240000, 2100000, 5300000, 4000000, CARD));
    add(textBox(nextId++, "Title", 640000, 280000, 10800000, 900000, paragraph(slide.title, 2800, true, INK)));
    const column = (side: PresentationSlideInput["left"]): string => {
      const heading = side?.title === undefined ? "" : paragraph(side.title, 1800, true, INK);
      const bullets = (side?.bullets ?? []).map((line) => paragraph(line, 1600, false, INK, { bullet: true, before: 400 })).join("");
      return `${heading}${bullets}`;
    };
    add(textBox(nextId++, "Left", 820000, 2280000, 4940000, 3600000, column(slide.left)));
    add(textBox(nextId++, "Right", 6420000, 2280000, 4940000, 3600000, column(slide.right)));
  } else if (layout === "metrics") {
    const metrics = slide.metrics ?? [];
    add(textBox(nextId++, "Title", 640000, 480000, 10800000, 900000, paragraph(slide.title, 3000, true, INK)));
    const gap = 180000;
    const span = 10800000;
    const cardWidth = Math.floor((span - gap * (metrics.length - 1)) / metrics.length);
    metrics.forEach((metric, index) => {
      const x = 640000 + index * (cardWidth + gap);
      add(panel(nextId++, x, 1900000, cardWidth, 3200000, INK));
      add(textBox(
        nextId++,
        `Metric ${index + 1}`,
        x + 120000,
        2300000,
        cardWidth - 240000,
        2400000,
        paragraph(metric.value, 4000, true, CREAM, { align: "ctr" }) +
          paragraph(metric.label, 1400, false, "D6D0C6", { align: "ctr", before: 600 }),
        "ctr",
      ));
    });
  } else if (layout === "table") {
    add(textBox(nextId++, "Title", 640000, 360000, 10800000, 900000, paragraph(slide.title, 3000, true, INK)));
    add(tableFrame(nextId++, slide.headers ?? [], slide.rows ?? []));
  } else if (layout === "chart") {
    add(textBox(nextId++, "Title", 640000, 280000, 10800000, 900000, paragraph(slide.title, 3000, true, INK)));
    add(chartFrame(nextId++));
  } else {
    add(panel(nextId++, 0, 0, 12192000, 90000, EMBER));
    const heading = [
      slide.kicker === undefined ? "" : paragraph(slide.kicker, 1200, true, EMBER),
      paragraph(slide.title, 3000, true, INK),
      slide.subtitle === undefined ? "" : paragraph(slide.subtitle, 1600, false, MUTED, { before: 200 }),
    ].join("");
    add(textBox(nextId++, "Title", 640000, 280000, 10800000, 1400000, heading));
    const bullets = (slide.bullets ?? []).map((line) => paragraph(line, 1800, false, INK, { bullet: true, before: 500 })).join("");
    add(textBox(
      nextId++,
      "Body",
      640000,
      1760000,
      10800000,
      4500000,
      bullets.length > 0 ? bullets : `<a:p><a:endParaRPr lang="zh-CN" sz="1800"/></a:p>`,
    ));
  }
  const background = layout === "cover" ? INK : PAPER;
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
      `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    ...(layout === "chart" ? { chartXml: chartXml(slide) } : {}),
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
      ...(notes !== undefined && notes.length > 0 ? { notes } : {}),
    };
  });
}

/** One 16:9 deck. Slide text round-trips through the pptx reader. */
export function buildPptx(slides: readonly PresentationSlideInput[]): Uint8Array {
  const deck = normalizeSlides(slides);
  const files: Record<string, Uint8Array> = {
    "ppt/theme/theme1.xml": strToU8(THEME_XML),
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
  deck.forEach((slide, index) => {
    const number = index + 1;
    const rel = `rId${number + 1}`;
    const built = slideDocument(slide);
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
          textBox(2, "Notes", 400000, 400000, 6000000, 8000000, paragraph(slide.notes, 1400, false, INK)) +
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
  files["ppt/presentation.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">` +
      `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      (notesMasterId === undefined ? "" : `<p:notesMasterIdLst><p:notesMasterId r:id="${notesMasterId}"/></p:notesMasterIdLst>`) +
      `<p:sldIdLst>${slideIds.join("")}</p:sldIdLst>` +
      `<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>` +
      `<p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
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
): Promise<WrittenPresentation> {
  const absolute = workspaceFile(root, relativePath, "pptx");
  const pdfAbsolute = pdfPath === undefined ? undefined : workspaceFile(root, pdfPath, "pdf");
  if (pdfAbsolute !== undefined && pdfAbsolute === absolute) {
    throw invalid("pdf path must be a different file");
  }
  const bytes = buildPptx(slides);
  if (bytes.byteLength > MAX_PRESENTATION_BYTES) {
    throw invalid("written presentation exceeds 2 MB");
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
): Promise<WrittenPresentation> {
  const bot = getBot(db, botId);
  if (bot === undefined) throw invalid(`bot '${botId}' was not found`);
  if (bot.archivedAt !== null) throw invalid("archived bots have no workspace");
  const workspace = getWorkspace(db, bot.workspaceId);
  if (workspace === undefined) throw invalid(`workspace '${bot.workspaceId}' was not found`);
  const written = await writePresentationAt(workspace.canonicalPath, relativePath, slides, pdfPath);
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
