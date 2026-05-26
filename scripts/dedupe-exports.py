#!/usr/bin/env python3
"""
Dedupe Perplexity export markdown files.

Each file is a multi-turn conversation. Turns are separated by lines that are
exactly '---'. Within each turn the assistant answer body is written TWICE
back-to-back (the '## question' heading appears once, the answer is doubled).

This script removes the second copy, conservatively: a turn's answer body is
only halved when the two halves are byte-identical (optionally separated by a
single blank line). Anything that doesn't match that exact shape is left
untouched, so no unique content is ever lost.

Non-destructive: reads from SRC, writes to DST mirroring the folder structure.
"""
import sys
from pathlib import Path

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("exports")
DST = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("exports-deduped")
DRY = "--dry-run" in sys.argv


def strip_blanks(lines):
    s, e = 0, len(lines)
    while s < e and lines[s].strip() == "":
        s += 1
    while e > s and lines[e - 1].strip() == "":
        e -= 1
    return lines[s:e]


def dedupe_body(body):
    """body: list of lines (the answer, after the '## question' line).
    Return (deduped_body, was_doubled)."""
    b = strip_blanks(body)
    n = len(b)
    if n < 2:
        return body, False
    # even: two identical halves
    if n % 2 == 0:
        half = n // 2
        if b[:half] == b[half:]:
            return b[:half], True
    # odd: identical halves separated by one blank line
    else:
        mid = n // 2
        if b[mid].strip() == "" and b[:mid] == b[mid + 1:]:
            return b[:mid], True
    return body, False


def process(text):
    lines = text.split("\n")
    # header = everything before the first '## ' (the first turn's question)
    first = next((i for i, l in enumerate(lines) if l.startswith("## ")), len(lines))
    header = lines[:first]
    rest = lines[first:]

    # split rest into segments on standalone '---' lines, remembering positions
    segments, cur = [], []
    for l in rest:
        if l.strip() == "---":
            segments.append(cur)
            cur = []
        else:
            cur.append(l)
    segments.append(cur)

    changed = False
    out_segments = []
    for seg in segments:
        s = strip_blanks(seg)
        if not s or not s[0].startswith("## "):
            out_segments.append(seg)
            continue
        q, body = s[0], s[1:]
        new_body, was = dedupe_body(body)
        if was:
            changed = True
            out_segments.append([q, ""] + strip_blanks(new_body))
        else:
            out_segments.append(seg)

    # rebuild: header, then segments joined by a '---' line
    out = list(header)
    for i, seg in enumerate(out_segments):
        out.extend(seg)
        if i != len(out_segments) - 1:
            if out and out[-1].strip() != "":
                out.append("")
            out.append("---")
            out.append("")
    return "\n".join(out).rstrip("\n") + "\n", changed


def main():
    files = sorted(SRC.rglob("*.md"))
    n_changed = n_total = bytes_before = bytes_after = 0
    for f in files:
        orig = f.read_text(encoding="utf-8")
        new, changed = process(orig)
        n_total += 1
        bytes_before += len(orig.encode())
        bytes_after += len(new.encode())
        if changed:
            n_changed += 1
        if not DRY:
            out_path = DST / f.relative_to(SRC)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(new, encoding="utf-8")
    mb_b, mb_a = bytes_before / 1048576, bytes_after / 1048576
    print(f"files processed : {n_total}")
    print(f"files deduped   : {n_changed}")
    print(f"size before     : {mb_b:.2f} MB")
    print(f"size after      : {mb_a:.2f} MB  ({100*(mb_b-mb_a)/mb_b:.1f}% smaller)")
    if DRY:
        print("(dry run — nothing written)")


if __name__ == "__main__":
    main()
