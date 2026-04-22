import fs from "node:fs/promises";
import path from "node:path";
import type { CreateJournalEntryInput, JournalDay, JournalEntry } from "../../shared/contracts.js";
import { JOURNAL_DIR } from "./config.js";
import { createId, formatDate, nowIso } from "./utils.js";

function dayFilePath(date: string): string {
  return path.join(JOURNAL_DIR, `${date}.json`);
}

function dayMarkdownPath(date: string): string {
  return path.join(JOURNAL_DIR, `${date}.md`);
}

async function ensureJournalDir(): Promise<void> {
  await fs.mkdir(JOURNAL_DIR, { recursive: true });
}

async function readJournalDay(date: string): Promise<JournalDay> {
  await ensureJournalDir();
  try {
    const content = await fs.readFile(dayFilePath(date), "utf8");
    return JSON.parse(content) as JournalDay;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { date, entries: [] };
    }
    throw error;
  }
}

function renderMarkdown(day: JournalDay): string {
  const lines: string[] = [`# ${day.date}｜随手记录`, ""];

  if (!day.entries.length) {
    lines.push("今天还没有记录。");
    return lines.join("\n");
  }

  for (const entry of day.entries) {
    lines.push(`## ${entry.createdAt.slice(11, 16)}｜${entry.type}`, "", entry.content);
    if (entry.note.trim()) {
      lines.push("", `备注：${entry.note.trim()}`);
    }
    lines.push("", `来源：${entry.source}`, "");
  }

  return lines.join("\n");
}

async function persistDay(day: JournalDay): Promise<void> {
  await ensureJournalDir();
  await fs.writeFile(dayFilePath(day.date), JSON.stringify(day, null, 2), "utf8");
  await fs.writeFile(dayMarkdownPath(day.date), renderMarkdown(day), "utf8");
}

export async function ensureJournalDirectories(): Promise<void> {
  await ensureJournalDir();
}

export async function listJournalDay(date?: string): Promise<JournalDay> {
  return readJournalDay(date ?? formatDate(nowIso()));
}

export async function createJournalEntry(input: CreateJournalEntryInput): Promise<JournalDay> {
  const createdAt = nowIso();
  const date = input.date?.trim() || formatDate(createdAt);
  const current = await readJournalDay(date);

  const nextEntry: JournalEntry = {
    id: createId("journal"),
    date,
    type: input.type,
    content: input.content.trim(),
    note: input.note?.trim() ?? "",
    source: input.source ?? "manual",
    createdAt
  };

  const nextDay: JournalDay = {
    date,
    entries: [...current.entries, nextEntry]
  };

  await persistDay(nextDay);
  return nextDay;
}
