"""Minimal real OpenAI Responses API function-calling demo."""
import json
import os
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


# Python function registry: this is what the local dispatcher executes.
TOOLS = {"list_files": list_files, "read_text_file": read_text_file,
         "write_text_file": write_text_file}
WRITE_TOOLS = {"write_text_file"}

# Tool schemas: this is what the Responses API shows to the model.
TOOL_SCHEMAS = [
    {"type": "function", "name": "list_files",
     "description": "List files in a directory.",
     "parameters": {"type": "object", "properties": {
         "path": {"type": "string"}}, "required": ["path"],
         "additionalProperties": False}, "strict": True},
    {"type": "function", "name": "read_text_file",
     "description": "Read a UTF-8 text file.",
     "parameters": {"type": "object", "properties": {
         "path": {"type": "string"}}, "required": ["path"],
         "additionalProperties": False}, "strict": True},
    {"type": "function", "name": "write_text_file",
     "description": "Write UTF-8 text to a file; requires human approval.",
     "parameters": {"type": "object", "properties": {
         "path": {"type": "string"}, "content": {"type": "string"}},
         "required": ["path", "content"], "additionalProperties": False},
         "strict": True},
]


def dispatch(name: str, arguments: dict) -> object:
    """Execute only a registered local function."""
    if name not in TOOLS:
        raise ValueError(f"Unknown tool: {name}")
    if name in WRITE_TOOLS:
        print(f"WRITE REQUEST: {arguments}")
        if input("Type APPROVE to execute this write: ") != "APPROVE":
            return "WRITE NOT EXECUTED: human approval denied."
    return TOOLS[name](**arguments)


def main() -> None:
    api_key = os.getenv("OPENAI_API_KEY")
    model_name = os.getenv("OPENAI_MODEL")
    if not api_key:
        print("OPENAI_API_KEY is not set; no API request was made.")
        return
    if not model_name:
        print("OPENAI_MODEL is not set; no API request was made.")
        return

    from openai import OpenAI

    path = sys.argv[1] if len(sys.argv) > 1 else "."
    question = "What is the purpose of this demo?"
    input_items = [{"role": "user", "content": f"{question} Inspect {path}."}]
    instructions = ("First call list_files for the requested directory. Then choose one "
                    ".txt or .md file, call read_text_file, and answer from its contents.")
    client = OpenAI(api_key=api_key)

    while True:
        # Model response: the API returns response.output items.
        response = client.responses.create(model=model_name, instructions=instructions,
                                           tools=TOOL_SCHEMAS, input=input_items)
        input_items += response.output
        calls = [item for item in response.output if item.type == "function_call"]
        if not calls:
            print("FINAL MODEL RESPONSE:", response.output_text)
            return

        for call in calls:  # function_call: produced by the model.
            arguments = json.loads(call.arguments)
            print("FUNCTION_CALL:", call.name, arguments)
            result = dispatch(call.name, arguments)  # Python tool executes here.
            output = json.dumps(result, ensure_ascii=False)
            # function_call_output: return the local result to the model.
            input_items.append({"type": "function_call_output",
                                "call_id": call.call_id, "output": output})
            print("FUNCTION_CALL_OUTPUT:", output)


if __name__ == "__main__":
    main()
