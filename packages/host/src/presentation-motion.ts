/**
 * Slide motion that PowerPoint actually plays.
 *
 * The entrance markup follows the visually checked template in
 * github.com/BramAlkema/pptx-animation-skill (`oracle/entr/filter_effect.xml`):
 * a visibility set plus `p:animEffect`, with a preset id from that skill's
 * filter list. The rhythm follows github.com/addsumtech/slides_maker: the
 * title arrives with the slide, later ideas wait for a click, and the only
 * page change is a short fade.
 */
import { strToU8, unzipSync, zipSync } from "fflate";

export interface MotionEffect {
  readonly filter: string;
  readonly presetId: number;
  readonly presetSubtype: number;
  readonly durationMs: number;
}

/** Filters and preset ids taken from that skill's verified vocabulary. */
export const MOTION = {
  fade: { filter: "fade", presetId: 9, presetSubtype: 0, durationMs: 500 },
  wipeUp: { filter: "wipe(up)", presetId: 22, presetSubtype: 1, durationMs: 450 },
  wipeRight: { filter: "wipe(right)", presetId: 22, presetSubtype: 2, durationMs: 450 },
  wipeLeft: { filter: "wipe(left)", presetId: 22, presetSubtype: 8, durationMs: 450 },
} as const satisfies Record<string, MotionEffect>;

export interface MotionGroup {
  readonly shapeIds: readonly number[];
  /** False plays as the slide opens. True waits for the next click. */
  readonly onClick: boolean;
  readonly effect: MotionEffect;
}

export function slideTransitionXml(): string {
  return `<p:transition spd="med"><p:fade/></p:transition>`;
}

/** One timing tree. The first group opens with the slide; later groups are clicks. */
export function slideTimingXml(groups: readonly MotionGroup[]): string {
  const present = groups.filter((group) => group.shapeIds.length > 0);
  if (present.length === 0) return "";
  let next = 3;
  const id = (): number => next++;
  const clicks = present.map((group) => {
    const effects = group.shapeIds.map((shapeId, index) => {
      const nodeType = group.onClick && index === 0 ? "clickEffect" : "withEffect";
      const par = id();
      const setId = id();
      const effectId = id();
      return (
        `<p:par><p:cTn id="${par}" dur="${group.effect.durationMs}" fill="hold" nodeType="${nodeType}" ` +
        `grpId="${par}" presetID="${group.effect.presetId}" presetClass="entr" ` +
        `presetSubtype="${group.effect.presetSubtype}">` +
        `<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
        `<p:set><p:cBhvr><p:cTn id="${setId}" dur="1" fill="hold">` +
        `<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>` +
        `<p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl>` +
        `<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>` +
        `<p:to><p:strVal val="visible"/></p:to></p:set>` +
        `<p:animEffect transition="in" filter="${group.effect.filter}"><p:cBhvr>` +
        `<p:cTn id="${effectId}" dur="${group.effect.durationMs}"/>` +
        `<p:tgtEl><p:spTgt spid="${shapeId}"/></p:tgtEl></p:cBhvr></p:animEffect>` +
        `</p:childTnLst></p:cTn></p:par>`
      );
    }).join("");
    const outer = id();
    return (
      `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst>` +
      `<p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par>`
    );
  }).join("");
  return (
    `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">` +
    `<p:childTnLst><p:seq concurrent="1" nextAc="seek">` +
    `<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${clicks}</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>` +
    `</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`
  );
}

/** A script-built slide has no block names: first shape with the slide, then one click each. */
export function groupsForShapeOrder(shapeIds: readonly number[]): MotionGroup[] {
  const [first, ...rest] = shapeIds;
  if (first === undefined) return [];
  return [
    { shapeIds: [first], effect: MOTION.fade, onClick: false },
    ...rest.map((shapeId) => ({ shapeIds: [shapeId], effect: MOTION.wipeUp, onClick: true })),
  ];
}

export function motionGroups(
  layout: string,
  beats: readonly (readonly number[] | undefined)[],
): MotionGroup[] {
  return beats.flatMap((shapeIds, index) => (
    shapeIds === undefined || shapeIds.length === 0
      ? []
      : [{ shapeIds, effect: effectForLayout(layout, index), onClick: index > 0 }]
  ));
}

export function effectForLayout(layout: string, index: number): MotionEffect {
  if (index === 0) return MOTION.fade;
  if (layout === "split" && index === 1) return MOTION.wipeRight;
  if (layout === "split" && index === 2) return MOTION.wipeLeft;
  return MOTION.wipeUp;
}

const SLIDE_XML = /^ppt\/slides\/slide\d+\.xml$/;

function shapeIds(xml: string): number[] {
  return [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)]
    .map((match) => Number(match[1]))
    .filter((id) => id !== 1);
}

/** Add the fade page change and click builds to slides that do not already have timing. */
export function injectDeckMotion(pptx: Uint8Array): Uint8Array {
  const entries = unzipSync(pptx);
  let changed = false;
  for (const name of Object.keys(entries)) {
    if (!SLIDE_XML.test(name)) continue;
    const xml = new TextDecoder().decode(entries[name]);
    if (xml.includes("<p:timing") || !xml.includes("</p:sld>")) continue;
    const motion = `${slideTransitionXml()}${slideTimingXml(groupsForShapeOrder(shapeIds(xml)))}`;
    entries[name] = strToU8(xml.replace("</p:sld>", `${motion}</p:sld>`));
    changed = true;
  }
  return changed ? zipSync(entries) : pptx;
}
