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
      /\b(forward|go forward|move forward|ahead|straight|samne|age|agiye|samne jao|age jao|agiye jao)\b/i,
      /(সামনে যাও|সামনে যান|এগিয়ে যাও|এগিয়ে যান|সামনে|এগিয়ে)/i,
    ],
  },
  {
    action: "BACKWARD",
    description: "Move rover backward",
    patterns: [
      /\b(backward|back|reverse|go back|move back|piche|pechone|piche jao|pechone jao)\b/i,
      /(পেছনে যাও|পেছনে যান|পিছনে যাও|পিছনে যান|পেছনে|পিছনে|পেছাও)/i,
    ],
  },
  {
    action: "LEFT",
    description: "Turn rover left",
    patterns: [
      /\b(left|turn left|go left|rotate left|bame|bam|bame jao)\b/i,
      /(বামে যাও|বামে যান|বামে|বাম)/i,
    ],
  },
  {
    action: "RIGHT",
    description: "Turn rover right",
    patterns: [
      /\b(right|turn right|go right|rotate right|daine|dan|daine jao)\b/i,
      /(ডানে যাও|ডানে যান|ডানে|ডান)/i,
    ],
  },
  {
    action: "STOP",
    description: "Stop the rover",
    patterns: [
      /\b(stop|halt|brake|freeze|thamo|dara|thak)\b/i,
      /(থামো|থামুন|দাঁড়াও|দাঁড়াও|দাঁড়ান|দাঁড়ান)/i,
    ],
  },
  {
    action: "PICK_BALL",
    description: "Pick up object with arm",
    patterns: [
      /\b(pick|pick up|grab|catch|lift|tolo|dhoro)\b/i,
      /\bpick\s+(ball|object|item|box)\b/i,
      /(হাত তোলো|হাত তোল|হাত তুলুন|বল তোলো|বল তোল|বল তুলুন)/i,
    ],
  },
  {
    action: "DROP",
    description: "Drop / release object",
    patterns: [
      /\b(drop|place|release|put down|namo|rakho)\b/i,
      /(ছাড়ো|রাখো|নামো|ছাড়ো)/i,
    ],
  },
  {
    action: "SCAN",
    description: "Scan surroundings with camera / AI",
    patterns: [
      /\b(scan|detect|search|look around|find|scan area|khojo|dekho)\b/i,
      /(দেখো|দেখুন|খোঁজো|খুঁজুন|স্ক্যান)/i,
    ],
  },
  {
    action: "HOME",
    description: "Return arm to home position",
    patterns: [
      /\b(home|reset arm|arm home|initial position|ghore jao|home position)\b/i,
    ],
  },
  {
    action: "ROTATE",
    description: "Rotate base or vehicle in place",
    patterns: [
      /\b(rotate|spin|turn around|ghura|ghurao)\b/i,
      /(ঘোরাও|ঘুরাও|ঘোরান|ঘুরান)/i,
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
