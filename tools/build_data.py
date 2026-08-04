from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

import UnityPy


def u32s(data: bytes, start: int, count: int) -> list[int]:
    return list(struct.unpack_from(f"<{count}I", data, start))


def signed(value: int) -> int:
    return value - 0x100000000 if value & 0x80000000 else value


def decode_table(
    raw: bytes,
    base: int,
    count: int,
    blob_offset: int,
    offsets_offset: int,
) -> list[str]:
    offsets = u32s(raw, base + offsets_offset, count + 1)
    blob = raw[base + blob_offset : base + offsets_offset]
    return [
        blob[offsets[index] : offsets[index + 1]].decode(
            "utf-8", errors="backslashreplace"
        )
        for index in range(count)
    ]


def extract_monobehaviour(bundle: Path, object_name: str) -> bytes:
    environment = UnityPy.load(str(bundle))
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            head = obj.parse_monobehaviour_head()
        except Exception:
            continue
        if str(head.m_Name) == object_name:
            return bytes(obj.get_raw_data())
    raise RuntimeError(f"找不到 MonoBehaviour：{object_name}")


def parse_wzjs(raw: bytes) -> dict[str, object]:
    base = raw.find(b"WZJS")
    if base < 0:
        raise RuntimeError("找不到 WZJS 資料標記")

    name_length = struct.unpack_from("<I", raw, 0x1C)[0]
    fields_start = (0x20 + name_length + 3) & ~3
    header = u32s(raw, fields_start, (base - fields_start) // 4)
    if len(header) < 36:
        raise RuntimeError("WZJS 標頭長度不符")

    node_count = header[0]
    records: list[list[int]] = []
    for index in range(node_count):
        record = u32s(raw, base + 8 + index * 32, 8)
        records.append([signed(value) for value in record])

    keys = decode_table(raw, base, header[26], header[27], header[28])
    paths = decode_table(raw, base, header[29], header[30], header[31])
    strings = decode_table(raw, base, header[32], header[33], header[34])
    integers = [
        signed(value)
        for value in u32s(raw, base + header[11], header[10])
    ]
    return {
        "records": records,
        "keys": keys,
        "paths": paths,
        "strings": strings,
        "integers": integers,
    }


def load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def clean_text(value: object) -> str:
    return " ".join(str(value or "").split())


def item_name(items: dict[str, object], item_id: int) -> str:
    value = items.get(str(item_id))
    if isinstance(value, dict):
        return clean_text(value.get("name")) or "未命名物品"
    return "未收錄物品"


def mob_name(mobs: dict[str, object], mob_id: int) -> str:
    value = mobs.get(str(mob_id))
    if isinstance(value, dict):
        return clean_text(value.get("name")) or "未命名怪物"
    return "未收錄怪物"


def map_label(maps: dict[str, object], map_id: int) -> tuple[str, str]:
    value = maps.get(str(map_id))
    if not isinstance(value, dict):
        return "未收錄地圖", ""
    street = clean_text(value.get("streetName"))
    name = clean_text(value.get("mapName")) or "未命名地圖"
    return name, street


def child_indices(record: list[int]) -> range:
    first_child = record[3]
    child_count = record[4]
    if first_child < 0 or child_count <= 0:
        return range(0)
    return range(first_child, first_child + child_count)


def build_dataset(
    parsed: dict[str, object],
    mobs: dict[str, object],
    items: dict[str, object],
    maps: dict[str, object],
    descriptions: dict[str, object],
) -> dict[str, object]:
    records: list[list[int]] = parsed["records"]  # type: ignore[assignment]
    keys: list[str] = parsed["keys"]  # type: ignore[assignment]
    strings: list[str] = parsed["strings"]  # type: ignore[assignment]
    integers: list[int] = parsed["integers"]  # type: ignore[assignment]

    root = records[0]
    monsters: list[dict[str, object]] = []
    for monster_node_index in child_indices(root):
        monster_record = records[monster_node_index]
        monster_key = keys[monster_record[1]]
        if not monster_key.isdigit():
            continue
        monster_id = int(monster_key)
        map_ids: list[int] = []
        reward_ids: list[int] = []
        episode = ""

        for section_index in child_indices(monster_record):
            section_record = records[section_index]
            section_name = keys[section_record[1]]
            if section_record[0] == 11 and section_record[2] >= 0:
                episode = strings[section_record[2]]
                continue
            if section_record[0] != 2:
                continue
            values: list[int] = []
            for value_index in child_indices(section_record):
                value_record = records[value_index]
                if value_record[0] == 6 and value_record[2] >= 0:
                    values.append(integers[value_record[2]])
            if section_name == "map":
                map_ids = values
            elif section_name == "reward":
                reward_ids = values

        monster_maps = []
        for map_id in dict.fromkeys(map_ids):
            name, street = map_label(maps, map_id)
            monster_maps.append({"id": map_id, "name": name, "street": street})

        drops = [
            {"id": item_id, "name": item_name(items, item_id)}
            for item_id in dict.fromkeys(reward_ids)
        ]
        description = descriptions.get(str(monster_id), episode)
        monsters.append(
            {
                "id": monster_id,
                "name": mob_name(mobs, monster_id),
                "description": str(description or ""),
                "maps": monster_maps,
                "drops": drops,
            }
        )

    monsters.sort(key=lambda monster: int(monster["id"]))
    return {
        "meta": {
            "title": "楓之谷經典服・個人掉落查詢",
            "source": "本機遊戲 MonsterBook 圖鑑資源",
            "monsterCount": len(monsters),
            "dropRelationCount": sum(len(monster["drops"]) for monster in monsters),
            "mapRelationCount": sum(len(monster["maps"]) for monster in monsters),
            "hasDropRates": False,
        },
        "monsters": monsters,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="建立本機楓之谷圖鑑掉落查詢資料")
    parser.add_argument("bundle", type=Path)
    parser.add_argument("text_dir", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--object-name", default="MonsterBook")
    args = parser.parse_args()

    raw = extract_monobehaviour(args.bundle, args.object_name)
    parsed = parse_wzjs(raw)
    dataset = build_dataset(
        parsed,
        load_json(args.text_dir / "Mob.json"),
        load_json(args.text_dir / "Item.json"),
        load_json(args.text_dir / "Map.json"),
        load_json(args.text_dir / "MonsterBook.json"),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(dataset, ensure_ascii=False, separators=(",", ":"))
    args.output.write_text(f"window.MAPLE_DROP_DATA={encoded};\n", encoding="utf-8")
    meta = dataset["meta"]
    print(
        "BUILT\t"
        f"monsters={meta['monsterCount']}\t"
        f"drops={meta['dropRelationCount']}\t"
        f"maps={meta['mapRelationCount']}\t"
        f"output={args.output}"
    )
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    raise SystemExit(main())
