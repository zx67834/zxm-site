"use client";

import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";

type Line = { type: "system" | "command" | "output" | "error"; text: string };

const commands = ["help", "clear", "ls", "cat", "whoami", "id", "pwd", "date", "uname", "echo", "open", "social", "ai"];
const files: Record<string, string> = {
  "about.txt": "zxm's small site - blog / notes / experiments.\nCtrl+Z my life.",
  "links.txt": "GitHub  https://github.com/zx67834\nGitee   https://gitee.com/zx67834",
  ".secret": "flag{THIS_is_ZXMomo's_flag}",
};

const completionMatches = (value: string) => {
  if (value.startsWith("cat ")) {
    return Object.keys(files).map(file => `cat ${file}`).filter(item => item.startsWith(value));
  }
  if (value.startsWith("ls ")) return ["ls -a"].filter(item => item.startsWith(value));
  if (value.startsWith("uname ")) return ["uname -a"].filter(item => item.startsWith(value));
  if (value.startsWith("open ")) return ["open blog"].filter(item => item.startsWith(value));
  return commands.filter(command => command.startsWith(value));
};

export default function Terminal() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([
    { type: "system", text: "  ███████╗ ██╗  ██╗ ███╗   ███╗" },
    { type: "system", text: "  ╚══███╔╝ ╚██╗██╔╝ ████╗ ████║" },
    { type: "system", text: "    ███╔╝   ╚███╔╝  ██╔████╔██║" },
    { type: "system", text: "   ███╔╝    ██╔██╗  ██║╚██╔╝██║" },
    { type: "system", text: "  ███████╗ ██╔╝ ██╗ ██║ ╚═╝ ██║" },
    { type: "system", text: "  ╚══════╝ ╚═╝  ╚═╝ ╚═╝     ╚═╝" },
    { type: "system", text: "          zxm-site / contact shell" },
    { type: "system", text: "Session: local / no remote connection" },
    { type: "system", text: "Type 'help' for commands · Tab to complete · ↑↓ for history" },
  ]);

  const screenRef = useRef<HTMLDivElement>(null);
  const completionRef = useRef<{ matches: string[]; index: number } | null>(null);
  const prompt = "visitor@zxm-site:~$";
  const help = useMemo(() => [
    "help       显示所有命令", "clear      清除终端", "ls [-a]    列出文件",
    "cat FILE   查看文件", "whoami     当前身份", "id / pwd   用户与路径",
    "date       当前时间", "uname -a   系统信息", "echo TEXT  输出文本",
    "open blog  前往文章", "social     GitHub / Gitee", "ai         可选 AI 模式",
  ].join("\n"), []);

  const resetCompletion = () => {
    setSuggestions([]);
    completionRef.current = null;
  };

  const append = (next: Line[]) => {
    setLines(current => [...current, ...next]);
    requestAnimationFrame(() => screenRef.current?.scrollTo({
      top: screenRef.current.scrollHeight,
      behavior: "smooth",
    }));
  };

  const run = (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    setHistory(current => [...current, value]);
    setHistoryIndex(history.length + 1);
    setInput("");
    resetCompletion();
    if (value === "clear") return setLines([]);

    const output: Line[] = [{ type: "command", text: `${prompt} ${value}` }];
    const [command, ...args] = value.split(/\s+/);
    if (command === "help") output.push({ type: "output", text: help });
    else if (command === "ls") output.push({ type: "output", text: args.includes("-a") ? "about.txt  links.txt  blog/  .secret" : "about.txt  links.txt  blog/" });
    else if (command === "cat") output.push(files[args[0]] ? { type: "output", text: files[args[0]] } : { type: "error", text: `cat: ${args[0] || ""}: No such file` });
    else if (command === "whoami") output.push({ type: "output", text: "guest" });
    else if (command === "id") output.push({ type: "output", text: "uid=1000(guest) gid=1000(guest) groups=1000(guest)" });
    else if (command === "pwd") output.push({ type: "output", text: "/home/visitor" });
    else if (command === "date") output.push({ type: "output", text: new Date().toString() });
    else if (command === "uname") output.push({ type: "output", text: args.includes("-a") ? "zxm-site 6.6.0-zxm #1 SMP x86_64 GNU/Linux" : "Linux" });
    else if (command === "echo") output.push({ type: "output", text: args.join(" ") });
    else if (command === "social") output.push({ type: "output", text: files["links.txt"] });
    else if (command === "open" && args[0] === "blog") {
      output.push({ type: "output", text: "opening /articles ..." });
      window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/articles`;
    } else if (command === "ai") {
      output.push({ type: "error", text: "AI 未配置。访客需要在 AI 设置中添加自己的 Key。" });
    } else output.push({ type: "error", text: `${command}: command not found` });
    append(output);
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const value = input.trimStart();
      if (!value) {
        setSuggestions(commands);
        completionRef.current = null;
        return;
      }

      const activeCompletion = completionRef.current;
      if (activeCompletion && activeCompletion.matches.includes(input)) {
        const nextIndex = (activeCompletion.index + 1) % activeCompletion.matches.length;
        completionRef.current = { ...activeCompletion, index: nextIndex };
        setInput(activeCompletion.matches[nextIndex]);
        setSuggestions(activeCompletion.matches);
        return;
      }

      const matches = completionMatches(value);
      if (!matches.length) {
        resetCompletion();
        return;
      }
      completionRef.current = { matches, index: 0 };
      setInput(matches[0]);
      setSuggestions(matches);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setInput(history[next] || "");
      resetCompletion();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.min(history.length, historyIndex + 1);
      setHistoryIndex(next);
      setInput(history[next] || "");
      resetCompletion();
    } else if (event.key === "Escape") {
      resetCompletion();
    } else if (event.key.toLowerCase() === "l" && event.ctrlKey) {
      event.preventDefault();
      setLines([]);
      resetCompletion();
    }
  };

  return <div className="terminal">
    <header>
      <span className="dot red" /><span className="dot yellow" /><span className="dot green" />
      <b>{prompt}</b>
    </header>
    <div className="screen" ref={screenRef} onClick={() => screenRef.current?.querySelector("input")?.focus()}>
      {lines.map((line, index) => <p key={index} className={line.type}>{line.text}</p>)}
      <form onSubmit={run}>
        <label>{prompt}</label>
        <input
          value={input}
          onChange={event => {
            setInput(event.target.value);
            resetCompletion();
          }}
          onKeyDown={keyDown}
          autoComplete="off"
          aria-label="终端输入"
        />
      </form>
      {suggestions.length ? <div className="terminal-suggestions">
        <span>Tab</span>{suggestions.join("   ")}
      </div> : null}
    </div>
  </div>;
}
