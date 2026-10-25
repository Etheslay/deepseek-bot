/**
 * Preset avatar SVG → bundled URL mapping. Vite hashes these into the
 * renderer build output at compile time (no runtime file access).
 *
 * The 16 animal faces are OpenMoji SVGs (CC BY-SA 4.0); see
 * THIRD_PARTY_NOTICES for attribution. dolphin.png is the DeepSeek brand mark.
 */
import bear from "../../../../../assets/avatars/bear.svg";
import cat from "../../../../../assets/avatars/cat.svg";
import chicken from "../../../../../assets/avatars/chicken.svg";
import cow from "../../../../../assets/avatars/cow.svg";
import dog from "../../../../../assets/avatars/dog.svg";
import dolphin from "../../../../../assets/avatars/dolphin.png";
import fox from "../../../../../assets/avatars/fox.svg";
import frog from "../../../../../assets/avatars/frog.svg";
import hamster from "../../../../../assets/avatars/hamster.svg";
import koala from "../../../../../assets/avatars/koala.svg";
import lion from "../../../../../assets/avatars/lion.svg";
import monkey from "../../../../../assets/avatars/monkey.svg";
import mouse from "../../../../../assets/avatars/mouse.svg";
import panda from "../../../../../assets/avatars/panda.svg";
import pig from "../../../../../assets/avatars/pig.svg";
import rabbit from "../../../../../assets/avatars/rabbit.svg";
import tiger from "../../../../../assets/avatars/tiger.svg";
import type { PresetId } from "./avatar-meta.js";

export const PRESET_URLS: Record<PresetId, string> = {
  mouse,
  dog,
  bear,
  cat,
  frog,
  cow,
  pig,
  chicken,
  fox,
  lion,
  panda,
  koala,
  monkey,
  rabbit,
  hamster,
  tiger,
};

export const DOLPHIN_LOGO_URL: string = dolphin;
