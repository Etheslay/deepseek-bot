/**
 * Create a workspace .pptx from titled slides.
 *
 * The package is a real OOXML presentation (16:9, title plus bullets) so
 * PowerPoint and the existing pptx reader both see the same text. Chinese
 * stays in the XML; the deck names Microsoft YaHei for East Asian runs and
 * does not embed a font.
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

function run(text: string, size: number, bold: boolean): string {
  return (
    `<a:r><a:rPr lang="zh-CN" sz="${size}"${bold ? ` b="1"` : ""} dirty="0">` +
    `<a:solidFill><a:srgbClr val="1B1B1F"/></a:solidFill>` +
    `<a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/>` +
    `</a:rPr><a:t>${xmlEscape(text)}</a:t></a:r>`
  );
}

function titleParagraph(text: string): string {
  return `<a:p><a:pPr algn="l"/>${run(text, 3200, true)}<a:endParaRPr lang="zh-CN" sz="3200"/></a:p>`;
}

function bulletParagraph(text: string): string {
  return (
    `<a:p><a:pPr marL="342900" indent="-171450">` +
    `<a:buFont typeface="Arial"/><a:buChar char="•"/>` +
    `</a:pPr>${run(text, 2000, false)}<a:endParaRPr lang="zh-CN" sz="2000"/></a:p>`
  );
}

function textBox(id: number, name: string, x: number, y: number, cx: number, cy: number, body: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/>` +
    `<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" rtlCol="0"/><a:lstStyle/>${body}</p:txBody></p:sp>`
  );
}

function slideXml(slide: PresentationSlideInput): string {
  const bullets = (slide.bullets ?? []).map((line) => bulletParagraph(line)).join("");
  const body = bullets.length > 0 ? bullets : `<a:p><a:endParaRPr lang="zh-CN" sz="2000"/></a:p>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    textBox(2, "Title", 838200, 365125, 10515600, 1325563, titleParagraph(slide.title)) +
    textBox(3, "Body", 838200, 1825625, 10515600, 4351338, body) +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
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
    const bullets = (slide.bullets ?? []).map((line) => line.trim()).filter((line) => line.length > 0);
    if (bullets.length > MAX_SLIDE_BULLETS) {
      throw invalid(`a slide can have at most ${MAX_SLIDE_BULLETS} bullets`);
    }
    if (bullets.some((line) => line.length > MAX_BULLET_CHARS)) {
      throw invalid(`a bullet can be at most ${MAX_BULLET_CHARS} characters`);
    }
    return bullets.length > 0 ? { title, bullets } : { title };
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
  deck.forEach((slide, index) => {
    const number = index + 1;
    const rel = `rId${number + 1}`;
    files[`ppt/slides/slide${number}.xml`] = strToU8(slideXml(slide));
    files[`ppt/slides/_rels/slide${number}.xml.rels`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
        `</Relationships>`,
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

export async function writePresentationAt(
  root: string,
  relativePath: string,
  slides: readonly PresentationSlideInput[],
): Promise<WrittenPresentation> {
  if (!/\.pptx$/i.test(relativePath)) {
    throw invalid("path must end with .pptx");
  }
  const segments = relativePath.split(/[\\/]/);
  if (
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.some((segment) => segment.startsWith("."))
  ) {
    throw invalid("presentation path must stay inside the bot workspace");
  }
  const located = resolveInsideWorkspace(root, relativePath);
  const bytes = buildPptx(slides);
  if (bytes.byteLength > MAX_PRESENTATION_BYTES) {
    throw invalid("written presentation exceeds 2 MB");
  }
  fs.mkdirSync(path.dirname(located.absolute), { recursive: true });
  const temporary = `${located.absolute}.tmp-${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, located.absolute);
  const stored = path.relative(root, located.absolute).split(path.sep).join("/");
  return { path: stored, bytes: bytes.byteLength, format: "pptx", slides: slides.length };
}

export async function writeBotPresentation(
  db: OpenedDatabase,
  botId: string,
  relativePath: string,
  slides: readonly PresentationSlideInput[],
): Promise<WrittenPresentation> {
  const bot = getBot(db, botId);
  if (bot === undefined) throw invalid(`bot '${botId}' was not found`);
  if (bot.archivedAt !== null) throw invalid("archived bots have no workspace");
  const workspace = getWorkspace(db, bot.workspaceId);
  if (workspace === undefined) throw invalid(`workspace '${bot.workspaceId}' was not found`);
  const written = await writePresentationAt(workspace.canonicalPath, relativePath, slides);
  const checksum = createHash("sha256").update(fs.readFileSync(
    path.resolve(workspace.canonicalPath, ...written.path.split("/")),
  )).digest("hex");
  await parseAndStoreAttachment(db, botId, written.path, checksum);
  return written;
}
