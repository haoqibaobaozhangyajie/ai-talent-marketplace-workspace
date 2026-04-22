import { useEffect, useMemo, useRef, useState } from "react";
import type { CreateJournalEntryInput, JournalDay, JournalEntryType } from "@shared/contracts";

type SaveState = "idle" | "saving" | "saved" | "error";

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const ENTRY_TYPES: Array<{ id: JournalEntryType; label: string; hint: string }> = [
  { id: "event", label: "事件", hint: "今天发生了什么" },
  { id: "problem", label: "问题", hint: "卡点、风险、失误" },
  { id: "emotion", label: "情绪", hint: "烦躁、满足、焦虑、轻松" },
  { id: "highlight", label: "亮点", hint: "做对了什么" },
  { id: "idea", label: "想法", hint: "新判断、新方法、新洞察" },
  { id: "todo", label: "待办", hint: "后续要跟进什么" },
  { id: "free", label: "自由", hint: "不想分类就直接记" }
];

function todayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const date = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${date}`;
}

async function fetchDay(date: string): Promise<JournalDay> {
  const response = await fetch(`/api/journal/day?date=${encodeURIComponent(date)}`);
  if (!response.ok) {
    throw new Error("无法读取今天的记录。");
  }
  return response.json() as Promise<JournalDay>;
}

async function createEntry(input: CreateJournalEntryInput): Promise<JournalDay> {
  const response = await fetch("/api/journal/entries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error("保存失败，请稍后重试。");
  }
  return response.json() as Promise<JournalDay>;
}

function timeLabel(value: string): string {
  return value.slice(11, 16);
}

export function CaptureApp() {
  const [date] = useState(todayString);
  const [day, setDay] = useState<JournalDay>({ date: todayString(), entries: [] });
  const [entryType, setEntryType] = useState<JournalEntryType>("event");
  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const selectedType = useMemo(() => ENTRY_TYPES.find((item) => item.id === entryType) ?? ENTRY_TYPES[0], [entryType]);
  const speechSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    void (async () => {
      try {
        setDay(await fetchDay(date));
      } catch (nextError) {
        setError((nextError as Error).message);
      }
    })();
  }, [date]);

  useEffect(() => {
    if (!speechSupported) {
      return;
    }
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      return;
    }
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "zh-CN";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      setContent(transcript.trim());
    };
    recognition.onerror = () => {
      setVoiceOn(false);
      setError("语音识别中断了，可以改用 Win + H 或手动输入。");
    };
    recognition.onend = () => {
      setVoiceOn(false);
    };
    recognitionRef.current = recognition;
    return () => recognition.stop();
  }, [speechSupported]);

  async function handleSave(source: "manual" | "voice") {
    if (!content.trim()) {
      setError("先记下一点内容，我再帮你收进去。");
      return;
    }
    setSaveState("saving");
    setError(null);
    try {
      const nextDay = await createEntry({
        date,
        type: entryType,
        content,
        note,
        source
      });
      setDay(nextDay);
      setContent("");
      setNote("");
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1400);
    } catch (nextError) {
      setSaveState("error");
      setError((nextError as Error).message);
    }
  }

  function toggleVoice() {
    if (!recognitionRef.current) {
      setError("当前浏览器不支持页面内语音识别，可以直接按 Win + H 听写。");
      return;
    }
    setError(null);
    if (voiceOn) {
      recognitionRef.current.stop();
      setVoiceOn(false);
      return;
    }
    recognitionRef.current.start();
    setVoiceOn(true);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && event.ctrlKey) {
        event.preventDefault();
        void handleSave(voiceOn ? "voice" : "manual");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="capture-shell">
      <div className="capture-hero">
        <div>
          <div className="capture-eyebrow">复盘随手记</div>
          <h1>{date} 的临时收集箱</h1>
          <p>白天想到什么就扔进来。晚上我们再把这些碎片整合成正式的 KISS 复盘和语雀 Markdown。</p>
        </div>
        <div className="capture-callout">
          <strong>快捷建议</strong>
          <span>`Ctrl + Enter` 保存</span>
          <span>`Win + H` Windows 听写</span>
        </div>
      </div>

      <main className="capture-grid">
        <section className="capture-panel composer-panel">
          <div className="capture-panel-head">
            <h2>快速记录</h2>
            <span>{selectedType.hint}</span>
          </div>

          <div className="type-picker">
            {ENTRY_TYPES.map((item) => (
              <button
                key={item.id}
                className={item.id === entryType ? "active" : ""}
                onClick={() => setEntryType(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="capture-field">
            <span>内容</span>
            <textarea
              placeholder={`比如：${selectedType.hint}`}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>

          <label className="capture-field">
            <span>备注</span>
            <input
              placeholder="可选，补一句背景或结果"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          <div className="capture-actions">
            <button className="primary-button" onClick={() => void handleSave(voiceOn ? "voice" : "manual")} type="button">
              {saveState === "saving" ? "保存中..." : saveState === "saved" ? "已保存" : "收进今天记录"}
            </button>
            <button className={`ghost-button ${voiceOn ? "voice-live" : ""}`} onClick={toggleVoice} type="button">
              {voiceOn ? "停止语音" : "开始语音"}
            </button>
          </div>

          <div className="capture-tip">
            {speechSupported
              ? "这个页面支持浏览器原生语音输入。若浏览器权限拦住了，也可以直接用 Win + H。"
              : "当前浏览器不支持页面内语音识别，推荐直接用 Win + H 做语音听写。"}
          </div>

          {error ? <div className="error-banner">{error}</div> : null}
        </section>

        <section className="capture-panel timeline-panel">
          <div className="capture-panel-head">
            <h2>今日已记录</h2>
            <span>{day.entries.length} 条</span>
          </div>

          {day.entries.length ? (
            <div className="capture-stream">
              {[...day.entries].reverse().map((entry) => (
                <article className="capture-entry-card" key={entry.id}>
                  <div className="capture-entry-top">
                    <span className={`entry-pill ${entry.type}`}>{ENTRY_TYPES.find((item) => item.id === entry.type)?.label}</span>
                    <span>{timeLabel(entry.createdAt)}</span>
                  </div>
                  <p>{entry.content}</p>
                  {entry.note ? <div className="entry-note">备注：{entry.note}</div> : null}
                  <small>{entry.source === "voice" ? "语音输入" : "手动输入"}</small>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state capture-empty">
              今天还没有碎片记录。你可以先记一句话，不需要完整。
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
