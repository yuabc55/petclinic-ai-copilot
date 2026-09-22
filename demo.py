"""Tiny, dependency-free simulated tool-calling demo."""
import json
import sys
from pathlib import Path


def list_files(path: str) -> list[str]:
    """Tool 1: return names in a directory."""
    folder = Path(path).expanduser()
    if not folder.is_dir():
        return [f"ERROR: not a directory: {folder}"]
    return sorted(item.name + ("/" if item.is_dir() else "")
                  for item in folder.iterdir())


def read_text_file(path: str) -> str:
    """Tool 2: read one UTF-8 text file."""
    try:
        return Path(path).expanduser().read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        return f"ERROR: {error}"


def write_text_file(path: str, content: str) -> str:
    """Risky tool: write UTF-8 text to a file."""
    try:
        Path(path).expanduser().write_text(content, encoding="utf-8")
        return f"Wrote {path}"
    except OSError as error:
        return f"ERROR: {error}"


TOOLS = {"list_files": list_files, "read_text_file": read_text_file,
         "write_text_file": write_text_file}
WRITE_TOOLS = {"write_text_file"}


def dispatch(name: str, arguments: dict) -> object:
    if name not in TOOLS:
        raise ValueError(f"Unknown tool: {name}")
    if name in WRITE_TOOLS:
        print(f"WRITE REQUEST: {arguments}")
        if input("Type APPROVE to execute this write: ") != "APPROVE":
            return "WRITE NOT EXECUTED: human approval denied."
    return TOOLS[name](**arguments)


def model(messages: list[dict]) -> dict:
    """A deterministic stand-in for an LLM."""
    last = messages[-1]
    if last["role"] == "user":
        return {"tool_call": {"name": "list_files",
                               "arguments": {"path": last["path"]}}}
    if last["name"] == "list_files":
        files = json.loads(last["content"])
        text_files = [name for name in files
                      if Path(name.rstrip("/")).suffix.lower() in {".txt", ".md"}]
        if not text_files:
            return {"content": "No .txt or .md file was found."}
        chosen = str(Path(last["path"]) / text_files[0])
        return {"tool_call": {"name": "read_text_file",
                               "arguments": {"path": chosen}}}
    text = json.loads(last["content"])
    for line in text.splitlines():
        if line.lower().startswith("purpose:"):
            return {"content": f"{messages[0]['question']} Answer: "
                                f"{line.split(':', 1)[1].strip()}"}
    return {"content": f"{messages[0]['question']} Answer: {text.strip()}"}


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else "."
    question = "What is the purpose of this demo?"
    messages = [{"role": "user", "content": f"{question} Inspect {path}",
                 "path": path, "question": question}]
    print("User:", messages[0]["content"])
    while True:
        response = model(messages)
        if "tool_call" in response:
            call = response["tool_call"]
            print("Model -> Tool Call:", json.dumps(call))
            result = dispatch(call["name"], call["arguments"])
            tool_result = json.dumps(result, ensure_ascii=False)
            print("Python Function -> Tool Result:", tool_result)
            messages.append({"role": "tool", "name": call["name"],
                             "path": path, "content": tool_result})
        else:
            print("Model -> Final Answer:", response["content"])
            break


if __name__ == "__main__":
    main()
