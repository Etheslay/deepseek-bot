/**
 * Onboarding card (对标学习): a freshly created bot opens its thread with a
 * friendly greeting and a choice card whose options are derived from the
 * bot's NAME — the user named it for a reason, so the card guesses what they
 * want and offers concrete directions instead of a blank input. The guesses
 * are local and deterministic (no model call, no cost); the trailing
 * 「我自己说」/「其他」rows always let the user say it in their own words.
 *
 * Labels are bilingual data picked by the UI language at call time, so the
 * zh literals here are i18n-ignore marked (same rule as the tone table).
 */
import type { Language } from "../../../../shared/i18n/types.js";

export type OnboardingOption = { id: string; label: string };

export interface OnboardingCard {
  greeting: string;
  question: string;
  options: OnboardingOption[];
  /** Trailing 「其他」 row: the card renders it as the free-text fallback. */
  other: true;
}

/** One name-keyword family: matchers plus the directions they unlock. */
interface OptionFamily {
  readonly keywords: readonly string[];
  readonly labels: Readonly<Record<Language, readonly string[]>>;
}

// i18n-ignore: the keyword lists and labels are bilingual data picked by language
const FAMILIES: readonly OptionFamily[] = [
  {
    keywords: ["设计", "美工", "ui", "ux", "design"],  // i18n-ignore
    labels: {
      zh: ["平面/视觉设计", "海报、配图与排版"],  // i18n-ignore
      en: ["Graphic / visual design", "Posters, images and layout"],
    },
  },
  {
    keywords: ["写", "文案", "笔", "writer", "writ", "copy"],  // i18n-ignore
    labels: {
      zh: ["文案与文章起草", "润色与改写"],  // i18n-ignore
      en: ["Drafting copy and posts", "Polishing and rewriting"],
    },
  },
  {
    keywords: ["码", "程序", "开发", "工程", "code", "dev", "program", "engineer"],  // i18n-ignore
    labels: {
      zh: ["写代码与修 bug", "搭脚本和小工具"],  // i18n-ignore
      en: ["Writing and fixing code", "Scripts and small tools"],
    },
  },
  {
    keywords: ["审", "校", "评", "review", "audit"],  // i18n-ignore
    labels: {
      zh: ["审稿与给反馈", "找错并提改进"],  // i18n-ignore
      en: ["Reviewing and feedback", "Spotting issues and improvements"],
    },
  },
  {
    keywords: ["翻", "译", "translat"],  // i18n-ignore
    labels: {
      zh: ["中英互译", "长文翻译与校对"],  // i18n-ignore
      en: ["Translation (zh/en)", "Long-document translation and checks"],
    },
  },
  {
    keywords: ["学", "教", "课", "learn", "study", "tutor", "teach"],  // i18n-ignore
    labels: {
      zh: ["制定学习计划", "讲解概念与出题"],  // i18n-ignore
      en: ["Building a study plan", "Explaining concepts and quizzes"],
    },
  },
  {
    keywords: ["管", "经理", "统筹", "调度", "manag", "coord"],  // i18n-ignore
    labels: {
      zh: ["拆任务与派活", "盯进度并写小结"],  // i18n-ignore
      en: ["Breaking down and handing off tasks", "Tracking progress and summarizing"],
    },
  },
  {
    keywords: ["数", "分析", "data", "analy"],  // i18n-ignore
    labels: {
      zh: ["数据整理与透视", "写分析小结"],  // i18n-ignore
      en: ["Tidying and pivoting data", "Writing analysis summaries"],
    },
  },
  {
    keywords: ["画", "图", "绘", "draw", "paint", "image", "picture"],  // i18n-ignore
    labels: {
      zh: ["画示意图与流程图", "配图构思"],  // i18n-ignore
      en: ["Diagrams and flowcharts", "Illustration ideas"],
    },
  },
  {
    keywords: ["剪", "视频", "片", "vid", "edit", "clip", "movie"],  // i18n-ignore
    labels: {
      zh: ["分镜与脚本", "剪辑清单与排期"],  // i18n-ignore
      en: ["Storyboards and scripts", "Editing checklists and schedules"],
    },
  },
  {
    keywords: ["音", "乐", "歌", "voice", "audio", "music", "song"],  // i18n-ignore
    labels: {
      zh: ["歌词与口播稿", "音频制作清单"],  // i18n-ignore
      en: ["Lyrics and voiceover scripts", "Audio production checklists"],
    },
  },
  {
    keywords: ["计", "划", "规划", "plan", "roadmap"],  // i18n-ignore
    labels: {
      zh: ["制定计划与里程碑", "把大目标拆成小步"],  // i18n-ignore
      en: ["Plans and milestones", "Breaking big goals into steps"],
    },
  },
];

// i18n-ignore: bilingual data picked by language
const CHAT_LABELS: Readonly<Record<Language, string>> = {
  zh: "先随便聊聊再定",  // i18n-ignore
  en: "Just chat first, then decide",
};
// i18n-ignore: bilingual data picked by language
const MYSELF_LABELS: Readonly<Record<Language, string>> = {
  zh: "我自己说",  // i18n-ignore
  en: "I'll describe it myself",
};

// i18n-ignore: bilingual data picked by language
const GREETINGS: Readonly<Record<Language, (name: string) => string>> = {
  zh: (name) => `嗨，我是 ${name}。你建我就是为了让事情更好办——先跟我说一句：你最希望我先帮你做什么？`,  // i18n-ignore
  en: (name) => `Hi, I'm ${name}. You built me to make things easier — tell me one thing: what should I take off your plate first?`,
};

// i18n-ignore: bilingual data picked by language
const QUESTIONS: Readonly<Record<Language, string>> = {
  zh: "你最想我先帮你做什么？",  // i18n-ignore
  en: "What should I focus on first?",
};

// i18n-ignore: bilingual data picked by language
const GENERIC_LABELS: Readonly<Record<Language, readonly string[]>> = {
  zh: ["资料调研与整理", "写作与润色", "任务拆解与规划"],  // i18n-ignore
  en: ["Research and tidying", "Writing and polishing", "Task breakdown and planning"],
};

const OPTION_IDS = "ABCDEF";

/**
 * Derive the onboarding card for one bot name. Name matching is
 * case-insensitive and matches substrings on both zh keywords and latin
 * stems; at most three derived directions survive, always followed by
 * 「先随便聊聊再定」 and 「我自己说」, with 「其他」 as the trailing fallback.
 */
export function onboardingCardFor(name: string, language: Language): OnboardingCard {
  const haystack = name.toLowerCase();
  const labels: string[] = [];
  for (const family of FAMILIES) {
    if (labels.length >= 3) {
      break;
    }
    const hit = family.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
    if (hit) {
      for (const label of family.labels[language]) {
        if (labels.length < 3 && !labels.includes(label)) {
          labels.push(label);
        }
      }
    }
  }
  if (labels.length === 0) {
    // No name hint: three generic everyday directions instead.
    labels.push(...GENERIC_LABELS[language]);
  }
  labels.push(CHAT_LABELS[language], MYSELF_LABELS[language]);
  return {
    greeting: GREETINGS[language](name),
    question: QUESTIONS[language],
    options: labels.slice(0, 5).map((label, index) => ({
      id: OPTION_IDS[index] ?? String(index),
      label,
    })),
    other: true,
  };
}
