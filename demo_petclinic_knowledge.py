"""Small, explainable in-memory search index over local PetClinic Markdown docs."""

from collections import Counter, defaultdict
from math import log
from pathlib import Path
import re

from langchain_core.tools import tool


KNOWLEDGE_DIR = Path(__file__).with_name("knowledge")


def tokens(text: str) -> list[str]:
    parts = re.findall(r"[\u4e00-\u9fff]+|[a-z0-9_]+", text.lower())
    return [part[i:i + 2] for part in parts for i in range(len(part) - 1)] + [
        part for part in parts if not re.fullmatch(r"[\u4e00-\u9fff]+", part)
    ]


def load_chunks() -> list[dict[str, str]]:
    chunks = []
    for path in sorted(KNOWLEDGE_DIR.glob("*.md")):
        title, section, lines = path.stem, "概要", []

        def flush():
            text = " ".join(lines).strip()
            for start in range(0, len(text), 350):
                chunks.append({"title": title, "section": section,
                               "snippet": text[start:start + 350]})
            lines.clear()

        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if line.startswith("# "):
                flush()
                title = line[2:]
            elif line.startswith("## "):
                flush()
                section = line[3:]
            elif line:
                lines.append(line)
        flush()
    return chunks


CHUNKS = load_chunks()
COUNTS = [Counter(tokens(" ".join(chunk.values()))) for chunk in CHUNKS]
LENGTHS = [sum(count.values()) for count in COUNTS]
AVG_LENGTH = sum(LENGTHS) / max(len(LENGTHS), 1)
HEADINGS = [set(tokens(chunk["title"] + " " + chunk["section"])) for chunk in CHUNKS]
TITLES = [set(tokens(chunk["title"])) for chunk in CHUNKS]
INDEX: dict[str, list[tuple[int, int]]] = defaultdict(list)
for i, counts in enumerate(COUNTS):
    for term, frequency in counts.items():
        INDEX[term].append((i, frequency))


def search(query: str, limit: int = 3) -> list[dict[str, str]]:
    scores = defaultdict(float)
    for term in set(tokens(query)):
        postings = INDEX.get(term, [])
        if not postings:
            continue
        weight = log(1 + (len(CHUNKS) - len(postings) + 0.5) / (len(postings) + 0.5))
        for i, frequency in postings:
            denominator = frequency + 1.2 * (0.25 + 0.75 * LENGTHS[i] / AVG_LENGTH)
            scores[i] += weight * frequency * 2.2 / denominator
            if term in TITLES[i]:
                scores[i] += 2.5 * weight
            elif term in HEADINGS[i]:
                scores[i] += weight
    return [CHUNKS[i] for i in sorted(scores, key=lambda i: scores[i], reverse=True)[:limit]]


@tool
def search_knowledge(query: str) -> dict:
    """Search local PetClinic policies and FAQ; never use for live appointment or pet data."""
    return {"ok": True, "results": search(query)}
