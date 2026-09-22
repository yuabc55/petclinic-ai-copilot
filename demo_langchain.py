"""Minimal LangChain create_agent demo; it does not invoke a model by itself."""
import os
import sys
from pathlib import Path

from langchain.agents import create_agent
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langgraph.checkpoint.memory import InMemorySaver
from langchain.tools import tool


@tool
def list_files(path: str) -> list[str]:
    """List files in a directory."""
    folder = Path(path).expanduser()
    if not folder.is_dir():
        return [f"ERROR: not a directory: {folder}"]
    return sorted(item.name + ("/" if item.is_dir() else "")
                  for item in folder.iterdir())


@tool
def read_text_file(path: str) -> str:
    """Read a UTF-8 text file."""
    try:
        return Path(path).expanduser().read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        return f"ERROR: {error}"


@tool
def write_text_file(path: str, content: str) -> str:
    """Write UTF-8 text to a file; human approval is required first."""
    try:
        Path(path).expanduser().write_text(content, encoding="utf-8")
        return f"Wrote {path}"
    except OSError as error:
        return f"ERROR: {error}"


def build_agent(model_name: str):
    """Build the agent without sending a model request."""
    return create_agent(
        model=f"openai:{model_name}",
        tools=[list_files, read_text_file, write_text_file],
        system_prompt=(
            "First call list_files for the requested directory. Then choose one "
            ".txt or .md file, call read_text_file, and answer from its contents."
        ),
        middleware=[
            HumanInTheLoopMiddleware(
                interrupt_on={
                    "list_files": False,
                    "read_text_file": False,
                    "write_text_file": {
                        "allowed_decisions": ["approve", "reject"]
                    },
                }
            )
        ],
        checkpointer=InMemorySaver(),
    )


def main() -> None:
    """Only validate configuration; intentionally do not call agent.invoke()."""
    if not os.getenv("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is not set; no API request was made.")
        return
    model_name = os.getenv("OPENAI_MODEL")
    if not model_name:
        print("OPENAI_MODEL is not set; no API request was made.")
        return
    build_agent(model_name)
    print("LangChain agent configured; no model API request was made.")


if __name__ == "__main__":
    main()
