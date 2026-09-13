/**
 * ARES-01 Command Parser
 * Parses natural language commands (English + Bengali) into machine actions.
 *
 * Returns a parsed machine command string that maps to Firebase action nodes.
 */

export type ParsedCommand =
  | "FORWARD" | "BACKWARD" | "LEFT" | "RIGHT" | "STOP"
  | "PICK_BALL" | "DROP"     | "SCAN" | "HOME"   | "ROTATE"
  | "UNKNOWN";

interface CommandRule {
  patterns: RegExp[];
  action: ParsedCommand;
  description: string;
}

// ─── Rule Table ───────────────────────────────────────────────────────────────
// Each rule contains regex patterns for English and Bengali (transliterated).

const COMMAND_RULES: CommandRule[] = [
  {
    action: "FORWARD",
    description: "Move rover forward",
    patterns: [
      /\b(forward|go forward|move forward|ahead|straight|samne|age|agiye|samne jao|age jao|agiye jao|agao)\b/i,
      /(সামনে|সামনে যাও|সামনে যান|এগিয়ে|এগিয়ে|এগিয়ে যাও|এগিয়ে যান|আগাও|আগান|ফরোয়ার্ড|ফরওয়ার্ড|স্ট্রেট|straight|forward)/i,
    ],
  },
  {
    action: "BACKWARD",
    description: "Move rover backward",
    patterns: [
      /\b(backward|back|reverse|go back|move back|piche|pechone|piche jao|pechone jao|pichao)\b/i,
      /(পেছনে|পিছনে|পেছনে যাও|পিছনে যাও|পেছনে যান|পিছনে যান|পেছাও|পিছাও|পিছান|ব্যাক|ব্যাকওয়ার্ড|রিভার্স|back|reverse|backward)/i,
    ],
  },
  {
    action: "LEFT",
    description: "Turn rover left",
    patterns: [
      /\b(left|turn left|go left|rotate left|bame|bam|bame jao|bam dike)\b/i,
      /(বামে|বাম|বামে যাও|বামে যান|বাম দিকে|বাঁয়ে|বাঁয়ে|লেফট|টার্ন লেফট|left)/i,
    ],
  },
  {
    action: "RIGHT",
    description: "Turn rover right",
    patterns: [
      /\b(right|turn right|go right|rotate right|daine|dan|daine jao|dan dike)\b/i,
      /(ডানে|ডান|ডানে যাও|ডানে যান|ডান দিকে|ডানদিকে|ডাইনে|রাইট|টার্ন রাইট|right)/i,
    ],
  },
  {
    action: "STOP",
    description: "Stop the rover",
    patterns: [
      /\b(stop|halt|brake|freeze|thamo|dara|thak|darao)\b/i,
      /(থাম|থামো|থামুন|দাঁড়াও|দাঁড়াও|দাড়াও|দাঁড়ান|দাঁড়ান|দারান|দাঁড়া|ব্রেক|স্টপ|হল্ট|stop)/i,
    ],
  },
  {
    action: "PICK_BALL",
    description: "Pick up object with arm",
    patterns: [
      /\b(pick|pick up|grab|catch|lift|tolo|dhoro|nao|pick koro)\b/i,
      /\bpick\s+(ball|object|item|box)\b/i,
      /(তোল|তোলো|তুলুন|ধর|ধরো|ধরুন|হাত তোলো|হাত তোল|বল তোলো|বল তুলুন|তুলে নাও|পিক|পিক আপ|গ্রাব|pick)/i,
    ],
  },
  {
    action: "DROP",
    description: "Drop / release object",
    patterns: [
      /\b(drop|place|release|put down|namo|rakho|chharo|chere dao|drop koro)\b/i,
      /(ছাড়|ছাড়ো|ছাড়ো|রাখ|রাখো|রাখুন|নামো|নামাও|নামিয়ে রাখো|ছেড়ে দাও|ছেড়ে দাও|ড্রপ|রিলিজ|drop)/i,
    ],
  },
  {
    action: "SCAN",
    description: "Scan surroundings with camera / AI",
    patterns: [
      /\b(scan|detect|search|look around|find|scan area|khojo|dekho|khujo|scan koro)\b/i,
      /(দেখ|দেখো|দেখুন|খোঁজ|খোঁজো|খুঁজুন|চারপাশ দেখো|স্ক্যান|সার্চ|ফাইন্ড|scan|search)/i,
    ],
  },
  {
    action: "HOME",
    description: "Return arm to home position",
    patterns: [
      /\b(home|reset arm|arm home|initial position|ghore jao|home position|normal koro)\b/i,
      /(ঘরে যাও|আগের জায়গায় যাও|আগের জায়গায়|নরমাল করো|হোম|রিসেট|home)/i,
    ],
  },
  {
    action: "ROTATE",
    description: "Rotate base or vehicle in place",
    patterns: [
      /\b(rotate|spin|turn around|ghura|ghurao|ghur|rotate koro)\b/i,
      /(ঘোরা|ঘোরাও|ঘুরাও|ঘোরান|ঘুরান|ঘুরুক|রোটেট|স্পিন|rotate|spin)/i,
    ],
  },
];

// ─── Parser ───────────────────────────────────────────────────────────────────

export interface ParseResult {
  action: ParsedCommand;
  description: string;
  confidence: "high" | "low";
}

export function parseCommand(raw: string | null | undefined): ParseResult {
  if (raw === null || raw === undefined) {
    return {
      action: "UNKNOWN",
      description: "Null/undefined input received",
      confidence: "low",
    };
  }

  const trimmed = raw.trim();
  if (!trimmed) return { action: "UNKNOWN", description: "Empty input", confidence: "low" };

  for (const rule of COMMAND_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(trimmed)) {
        return {
          action: rule.action,
          description: rule.description,
          confidence: "high",
        };
      }
    }
  }

  // Fallback: check if it looks like a drive direction shorthand
  const lower = trimmed.toLowerCase();
  if (["f", "fwd"].includes(lower))    return { action: "FORWARD",  description: "Move forward",  confidence: "low" };
  if (["b", "bwd"].includes(lower))    return { action: "BACKWARD", description: "Move backward", confidence: "low" };
  if (["l"].includes(lower))           return { action: "LEFT",     description: "Turn left",     confidence: "low" };
  if (["r"].includes(lower))           return { action: "RIGHT",    description: "Turn right",    confidence: "low" };

  return {
    action: "UNKNOWN",
    description: `No rule matched: "${trimmed}"`,
    confidence: "low",
  };
}

// ─── Action → Firebase node value map ─────────────────────────────────────────

export const ACTION_LABELS: Record<ParsedCommand, string> = {
  FORWARD:  "Driving Forward",
  BACKWARD: "Driving Backward",
  LEFT:     "Turning Left",
  RIGHT:    "Turning Right",
  STOP:     "Stopping",
  PICK_BALL: "Arm: Picking Up Ball",
  DROP:     "Arm: Dropping",
  SCAN:     "AI Scan: Detecting Objects",
  HOME:     "Arm: Returning Home",
  ROTATE:   "Rotating In Place",
  UNKNOWN:  "Command Not Recognized",
};
