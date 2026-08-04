from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Any, Iterator


def _u32s(raw: bytes, offset: int, count: int) -> tuple[int, ...]:
    return struct.unpack_from(f"<{count}I", raw, offset)


def _signed(value: int) -> int:
    return value - 0x100000000 if value & 0x80000000 else value


def _decode_table(
    raw: bytes,
    base: int,
    count: int,
    blob_offset: int,
    offsets_offset: int,
) -> list[str]:
    offsets = _u32s(raw, base + offsets_offset, count + 1)
    blob = raw[base + blob_offset : base + offsets_offset]
    return [
        blob[offsets[index] : offsets[index + 1]].decode(
            "utf-8", errors="replace"
        )
        for index in range(count)
    ]


@dataclass(frozen=True)
class Node:
    type: int
    key_index: int
    value_index: int
    first_child: int
    child_count: int
    parent: int
    path_index: int
    trailing: int


class WzjsDocument:
    """Small reader for the WZJS v5 records used by the classic client."""

    def __init__(self, raw: bytes):
        base = raw.find(b"WZJS")
        if base < 0:
            raise ValueError("WZJS magic not found")

        name_length = struct.unpack_from("<I", raw, 0x1C)[0]
        fields_start = (0x20 + name_length + 3) & ~3
        header = _u32s(raw, fields_start, (base - fields_start) // 4)
        if len(header) < 36:
            raise ValueError("WZJS header is incomplete")

        self.raw = raw
        self.base = base
        self.header = header
        self.nodes: list[Node] = []
        for index in range(header[0]):
            values = tuple(
                _signed(value)
                for value in _u32s(raw, base + 8 + index * 32, 8)
            )
            self.nodes.append(Node(*values))

        self.keys = _decode_table(raw, base, header[26], header[27], header[28])
        self.paths = _decode_table(raw, base, header[29], header[30], header[31])
        self.strings = _decode_table(raw, base, header[32], header[33], header[34])
        self.integers = [
            _signed(value)
            for value in _u32s(raw, base + header[11], header[10])
        ]

    def key(self, index: int) -> str:
        return self.keys[self.nodes[index].key_index]

    def path(self, index: int) -> str:
        return self.paths[self.nodes[index].path_index]

    def children(self, index: int) -> Iterator[int]:
        node = self.nodes[index]
        if node.first_child < 0 or node.child_count <= 0:
            return iter(())
        return iter(range(node.first_child, node.first_child + node.child_count))

    def child(self, index: int, key: str) -> int | None:
        return next(
            (child for child in self.children(index) if self.key(child) == key),
            None,
        )

    def primitive(self, index: int) -> Any:
        node = self.nodes[index]
        if node.type == 6 and 0 <= node.value_index < len(self.integers):
            return self.integers[node.value_index]
        if node.type == 11 and 0 <= node.value_index < len(self.strings):
            return self.strings[node.value_index]
        if node.type == 5:
            return bool(node.value_index)
        return None

    def value(self, index: int = 0) -> Any:
        node = self.nodes[index]
        if node.type != 2:
            return self.primitive(index)
        result: dict[str, Any] = {}
        for child in self.children(index):
            result[self.key(child)] = self.value(child)
        return result

    def shallow_object(self, index: int) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for child in self.children(index):
            node = self.nodes[child]
            if node.type in {5, 6, 11}:
                result[self.key(child)] = self.primitive(child)
        return result
