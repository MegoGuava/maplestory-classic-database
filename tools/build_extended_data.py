from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

import UnityPy

from wzjs_reader import WzjsDocument


CATEGORY_LABELS = {
    "Accessory": "飾品",
    "Android": "機器人",
    "Bits": "拼圖",
    "Cap": "帽子",
    "Cape": "披風",
    "Coat": "上衣",
    "Dragon": "龍裝備",
    "Face": "臉飾",
    "Glove": "手套",
    "Longcoat": "套服",
    "Mechanic": "機甲裝備",
    "Pants": "褲裙",
    "PetEquip": "寵物裝備",
    "Ring": "戒指",
    "Shield": "盾牌／副手",
    "Shoes": "鞋子",
    "TamingMob": "騎寵",
    "Weapon": "武器",
}

REQUIREMENT_KEYS = {
    "reqJob",
    "reqLevel",
    "reqSTR",
    "reqDEX",
    "reqINT",
    "reqLUK",
    "reqPOP",
}

ATTRIBUTE_KEYS = {
    "attackSpeed",
    "cash",
    "only",
    "price",
    "tradeBlock",
    "tuc",
}

ITEM_CATEGORY_LABELS = {
    "Consume": "消耗品",
    "Etc": "其他道具",
    "Install": "設置道具",
    "Cash": "點數道具",
    "Pet": "寵物",
    "Special": "特殊道具",
    "Item": "其他道具",
}


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\\n", "\n").split())


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_js(path: Path, variable: str, value: Any) -> None:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    path.write_text(f"window.{variable}={encoded};\n", encoding="utf-8")


def mono_name(obj: Any) -> str:
    try:
        return str(obj.peek_name() or "")
    except Exception:
        try:
            return str(obj.parse_monobehaviour_head().m_Name or "")
        except Exception:
            return ""


def category_from_path(path: str) -> tuple[str, str]:
    parts = path.replace("\\", "/").split("/")
    raw = parts[1] if len(parts) > 2 and parts[0] == "Character" else "Equipment"
    return raw, CATEGORY_LABELS.get(raw, raw)


def infer_equipment_category(item_id: int) -> tuple[str, str]:
    group = item_id // 10_000
    raw = {
        100: "Cap", 101: "Accessory", 102: "Accessory", 103: "Accessory",
        104: "Coat", 105: "Longcoat", 106: "Pants", 107: "Shoes",
        108: "Glove", 109: "Shield", 110: "Cape", 111: "Ring",
        112: "Accessory", 113: "Accessory", 114: "Accessory", 115: "Accessory",
        180: "PetEquip", 190: "TamingMob",
    }.get(group)
    if raw is None:
        raw = "Weapon" if 120 <= group <= 179 else "Equipment"
    return raw, CATEGORY_LABELS.get(raw, raw)


def build_equipment(bundle: Path, item_text: dict[str, Any]) -> dict[str, Any]:
    environment = UnityPy.load(str(bundle))
    equipment: list[dict[str, Any]] = []
    categories: Counter[str] = Counter()
    info_fields: Counter[str] = Counter()

    for current, obj in enumerate(environment.objects, 1):
        if obj.type.name != "MonoBehaviour":
            continue
        object_name = mono_name(obj)
        if not object_name.isdigit() or not object_name.startswith("01"):
            continue
        item_id = int(object_name)
        localized = item_text.get(str(item_id))
        if not isinstance(localized, dict):
            continue
        name = clean_text(localized.get("name"))
        if not name:
            continue

        try:
            document = WzjsDocument(bytes(obj.get_raw_data()))
        except Exception:
            continue
        info_index = document.child(0, "info")
        if info_index is None:
            continue
        info = document.shallow_object(info_index)
        info_fields.update(info.keys())
        raw_category, category = category_from_path(document.path(0))
        categories[category] += 1

        requirements = {
            key: int(value)
            for key, value in info.items()
            if key in REQUIREMENT_KEYS and isinstance(value, int)
        }
        stats = {
            key: int(value)
            for key, value in info.items()
            if key.startswith("inc") and isinstance(value, int)
        }
        attributes = {
            key: value
            for key, value in info.items()
            if key in ATTRIBUTE_KEYS and value not in {None, False}
        }

        equipment.append(
            {
                "id": item_id,
                "name": name,
                "description": clean_text(localized.get("desc")),
                "category": category,
                "categoryKey": raw_category,
                "requirements": requirements,
                "stats": stats,
                "attributes": attributes,
                "available": True,
            }
        )

        if current % 1000 == 0:
            print(f"EQUIPMENT_PROGRESS\tobjects={current}\tkept={len(equipment)}")

    decoded_ids = {int(entry["id"]) for entry in equipment}
    for raw_id, localized in item_text.items():
        if not str(raw_id).isdigit() or not isinstance(localized, dict):
            continue
        item_id = int(raw_id)
        if not 1_000_000 <= item_id < 2_000_000 or item_id in decoded_ids:
            continue
        name = clean_text(localized.get("name"))
        if not name:
            continue
        raw_category, category = infer_equipment_category(item_id)
        categories[category] += 1
        equipment.append(
            {
                "id": item_id,
                "name": name,
                "description": clean_text(localized.get("desc")),
                "category": category,
                "categoryKey": raw_category,
                "requirements": {},
                "stats": {},
                "attributes": {},
                "available": False,
            }
        )

    equipment.sort(key=lambda entry: int(entry["id"]))
    current_count = sum(1 for entry in equipment if entry["available"])
    return {
        "meta": {
            "equipmentCount": len(equipment),
            "currentDataCount": current_count,
            "categories": dict(sorted(categories.items())),
            "source": "經典服本機 Equipment WZJS",
            "infoFields": sorted(info_fields),
        },
        "equipment": equipment,
    }


def infer_item_category(item_id: int) -> tuple[str, str]:
    prefix = item_id // 1_000_000
    if prefix == 2:
        return "Consume", "消耗品"
    if prefix == 3:
        return "Install", "設置道具"
    if prefix == 4:
        return "Etc", "其他道具"
    if prefix == 5:
        return "Cash", "點數道具"
    return "Item", "其他道具"


def item_subcategory(item_id: int, category_key: str, info: dict[str, Any]) -> str:
    if info.get("quest"):
        return "任務道具"
    group = item_id // 10_000
    if group in {200, 201, 202}:
        return "恢復／增益"
    if group == 203:
        return "移動卷軸"
    if group == 204:
        return "裝備卷軸"
    if group == 205:
        return "狀態恢復"
    if group == 206:
        return "弓箭／弩箭"
    if group == 207:
        return "飛鏢"
    if group == 233:
        return "子彈"
    if group == 301:
        return "椅子"
    if group == 400:
        return "怪物戰利品"
    if group == 401:
        return "礦石／礦物"
    if group == 402:
        return "寶石／成品"
    if group == 403:
        return "任務道具"
    if category_key == "Pet":
        return "寵物"
    if category_key == "Cash":
        return "點數道具"
    return ITEM_CATEGORY_LABELS.get(category_key, "其他道具")


def build_items(bundle: Path, item_text: dict[str, Any]) -> dict[str, Any]:
    environment = UnityPy.load(str(bundle))
    decoded: dict[int, dict[str, Any]] = {}
    parse_errors = 0

    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            document = WzjsDocument(bytes(obj.get_raw_data()))
        except Exception:
            parse_errors += 1
            continue
        source_path = document.path(0).replace("\\", "/")
        parts = source_path.split("/")
        category_key = parts[1] if len(parts) > 1 else "Item"
        if category_key not in ITEM_CATEGORY_LABELS or category_key == "Item":
            continue
        category = ITEM_CATEGORY_LABELS.get(category_key, "其他道具")
        candidates = [(item_index, document.key(item_index)) for item_index in document.children(0)]
        # Pet records are one item per MonoBehaviour, with the id in the path.
        if category_key == "Pet" and len(parts) > 2 and parts[2].isdigit():
            candidates = [(0, parts[2])]
        for item_index, raw_id in candidates:
            if not raw_id.isdigit():
                continue
            item_id = int(raw_id)
            # Character/Equipment records live in the one-million range and
            # are emitted by build_equipment instead.
            if item_id < 2_000_000:
                continue
            info_index = document.child(item_index, "info")
            spec_index = document.child(item_index, "spec")
            info = document.shallow_object(info_index) if info_index is not None else {}
            spec = document.shallow_object(spec_index) if spec_index is not None else {}
            localized = item_text.get(str(item_id), {})
            if not isinstance(localized, dict):
                localized = {}
            decoded[item_id] = {
                "id": item_id,
                "name": clean_text(localized.get("name")) or f"道具 {item_id}",
                "description": clean_text(localized.get("desc")),
                "category": category,
                "categoryKey": category_key,
                "subcategory": item_subcategory(item_id, category_key, info),
                "available": True,
                "info": info,
                "spec": spec,
                "sourcePath": source_path,
            }

    # The language table contains historical/event entries that may not be
    # packed in the active data bundle. Keep them searchable and label them.
    for raw_id, localized in item_text.items():
        if not str(raw_id).isdigit() or not isinstance(localized, dict):
            continue
        item_id = int(raw_id)
        if item_id < 2_000_000 or item_id in decoded:
            continue
        name = clean_text(localized.get("name"))
        if not name:
            continue
        category_key, category = infer_item_category(item_id)
        decoded[item_id] = {
            "id": item_id,
            "name": name,
            "description": clean_text(localized.get("desc")),
            "category": category,
            "categoryKey": category_key,
            "subcategory": item_subcategory(item_id, category_key, {}),
            "available": False,
            "info": {},
            "spec": {},
            "sourcePath": "",
        }

    entries = sorted(decoded.values(), key=lambda entry: int(entry["id"]))
    categories = Counter(entry["category"] for entry in entries)
    current_count = sum(1 for entry in entries if entry["available"])
    return {
        "meta": {
            "itemCount": len(entries),
            "currentDataCount": current_count,
            "categories": dict(sorted(categories.items())),
            "source": "經典服本機 Item WZJS 與文字資源",
            "parseErrors": parse_errors,
        },
        "items": entries,
    }


def find_mono_raw(bundle: Path, names: set[str]) -> dict[str, bytes]:
    environment = UnityPy.load(str(bundle))
    result: dict[str, bytes] = {}
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        name = mono_name(obj)
        if name in names:
            result[name] = bytes(obj.get_raw_data())
    missing = names - result.keys()
    if missing:
        raise RuntimeError(f"Quest objects not found: {sorted(missing)}")
    return result


def named_entry(source: dict[str, Any], entry_id: int, fallback: str) -> dict[str, Any]:
    value = source.get(str(entry_id))
    name = clean_text(value.get("name")) if isinstance(value, dict) else ""
    return {"id": entry_id, "name": name or fallback}


def numeric_children(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, dict):
        return []
    return [
        entry
        for key, entry in sorted(
            value.items(),
            key=lambda pair: int(pair[0]) if pair[0].isdigit() else 10**9,
        )
        if isinstance(entry, dict)
    ]


def int_list(value: Any) -> list[int]:
    if isinstance(value, int):
        return [value]
    if not isinstance(value, dict):
        return []
    return [entry for entry in value.values() if isinstance(entry, int)]


def parse_conditions(
    value: Any,
    items: dict[str, Any],
    mobs: dict[str, Any],
    npcs: dict[str, Any],
) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    result: dict[str, Any] = {}
    npc_id = source.get("npc")
    if isinstance(npc_id, int):
        result["npc"] = named_entry(npcs, npc_id, "未知 NPC")

    for key in ("lvmin", "lvmax", "pop", "interval"):
        if isinstance(source.get(key), int):
            result[key] = source[key]

    jobs = int_list(source.get("job"))
    if jobs:
        result["jobs"] = jobs

    item_entries = []
    for entry in numeric_children(source.get("item")):
        entry_id = entry.get("id")
        if isinstance(entry_id, int):
            item = named_entry(items, entry_id, "未知物品")
            item["count"] = int(entry.get("count", 1) or 0)
            item_entries.append(item)
    if item_entries:
        result["items"] = item_entries

    mob_entries = []
    for entry in numeric_children(source.get("mob")):
        entry_id = entry.get("id")
        if isinstance(entry_id, int):
            mob = named_entry(mobs, entry_id, "未知怪物")
            mob["count"] = int(entry.get("count", 1) or 0)
            mob_entries.append(mob)
    if mob_entries:
        result["mobs"] = mob_entries

    quest_entries = []
    for entry in numeric_children(source.get("quest")):
        entry_id = entry.get("id")
        if isinstance(entry_id, int):
            quest_entries.append(
                {"id": entry_id, "state": int(entry.get("state", 0) or 0)}
            )
    if quest_entries:
        result["quests"] = quest_entries
    return result


def parse_actions(
    value: Any,
    items: dict[str, Any],
    skills: dict[str, Any],
) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    result: dict[str, Any] = {}
    for key in ("exp", "money", "pop", "nextQuest"):
        if isinstance(source.get(key), int):
            result[key] = source[key]

    item_entries = []
    for entry in numeric_children(source.get("item")):
        entry_id = entry.get("id")
        if isinstance(entry_id, int):
            item = named_entry(items, entry_id, "未知物品")
            item["count"] = int(entry.get("count", 1) or 0)
            if isinstance(entry.get("prop"), int):
                item["prop"] = entry["prop"]
            item_entries.append(item)
    if item_entries:
        result["items"] = item_entries

    skill_entries = []
    for entry in numeric_children(source.get("skill")):
        entry_id = entry.get("id")
        if isinstance(entry_id, int):
            skill = named_entry(skills, entry_id, "未知技能")
            if isinstance(entry.get("skillLevel"), int):
                skill["level"] = entry["skillLevel"]
            skill_entries.append(skill)
    if skill_entries:
        result["skills"] = skill_entries
    return result


def build_markup_resolver(
    items: dict[str, Any],
    mobs: dict[str, Any],
    maps: dict[str, Any],
    npcs: dict[str, Any],
    skills: dict[str, Any],
    quests: dict[str, Any],
):
    sources = {
        "p": (npcs, "未知 NPC"),
        "t": (items, "未知物品"),
        "o": (mobs, "未知怪物"),
        "q": (skills, "未知技能"),
    }

    def resolve_map(entry_id: int) -> str:
        value = maps.get(str(entry_id))
        if not isinstance(value, dict):
            return f"未知地圖 ({entry_id})"
        street = clean_text(value.get("streetName"))
        name = clean_text(value.get("mapName")) or "未知地圖"
        return f"{street}・{name}" if street else name

    def resolve(value: Any) -> str:
        text = str(value or "").replace("\\r", "").replace("\\n", "\n")

        def replace_named(match: re.Match[str]) -> str:
            marker, raw_id = match.groups()
            entry_id = int(raw_id)
            source, fallback = sources[marker]
            entry = named_entry(source, entry_id, fallback)
            return str(entry["name"])

        text = re.sub(r"#([ptoq])\s*(\d+)#", replace_named, text)
        text = re.sub(r"#m\s*(\d+)#", lambda match: resolve_map(int(match.group(1))), text)
        text = re.sub(r"#c\s*\d+#", "目前數量", text)
        text = re.sub(r"#[iI]\s*\d*#?", "", text)
        text = re.sub(
            r"#y\s*(\d+)#",
            lambda match: clean_text(quests.get(match.group(1), {}).get("name"))
            if isinstance(quests.get(match.group(1)), dict)
            else f"任務 {match.group(1)}",
            text,
        )
        text = re.sub(r"#u\s*\d+#", "進度", text)
        text = re.sub(r"#M\s*\d+#", "任務進度", text)
        text = re.sub(r"#j(?:cmp|try|min|sec|date|have|rank)#", "—", text)
        text = re.sub(r"#[bkrgen]", "", text)
        text = re.sub(r"#(?:h|a|v|x)\d*#", "", text)
        text = text.replace("#k", "")
        text = text.replace("#", "")
        return "\n".join(line.strip() for line in text.splitlines() if line.strip())

    return resolve


def build_quests(bundle: Path, text_dir: Path) -> dict[str, Any]:
    quest_text = load_json(text_dir / "QuestData.json")
    items = load_json(text_dir / "Item.json")
    mobs = load_json(text_dir / "Mob.json")
    maps = load_json(text_dir / "Map.json")
    npcs = load_json(text_dir / "Npc.json")
    skills = load_json(text_dir / "Skill.json")
    raw = find_mono_raw(bundle, {"Check", "Act"})
    checks = WzjsDocument(raw["Check"]).value()
    actions = WzjsDocument(raw["Act"]).value()
    resolve_markup = build_markup_resolver(items, mobs, maps, npcs, skills, quest_text)

    quests: list[dict[str, Any]] = []
    all_ids = sorted(
        {
            int(key)
            for source in (quest_text, checks, actions)
            if isinstance(source, dict)
            for key in source
            if str(key).isdigit()
        }
    )
    for quest_id in all_ids:
        localized = quest_text.get(str(quest_id), {})
        if not isinstance(localized, dict):
            localized = {}
        name = clean_text(localized.get("name")) or f"任務 {quest_id}"
        info = localized.get("Info") if isinstance(localized.get("Info"), dict) else {}
        check = checks.get(str(quest_id), {}) if isinstance(checks, dict) else {}
        act = actions.get(str(quest_id), {}) if isinstance(actions, dict) else {}
        check = check if isinstance(check, dict) else {}
        act = act if isinstance(act, dict) else {}

        start_conditions = parse_conditions(check.get("0"), items, mobs, npcs)
        finish_conditions = parse_conditions(check.get("1"), items, mobs, npcs)
        start_actions = parse_actions(act.get("0"), items, skills)
        rewards = parse_actions(act.get("1"), items, skills)

        start_npc = start_conditions.get("npc")
        finish_npc = finish_conditions.get("npc")
        objective = resolve_markup(info.get("1"))
        summary = resolve_markup(info.get("0"))
        completion = resolve_markup(info.get("2"))
        parent = clean_text(info.get("parent"))

        quests.append(
            {
                "id": quest_id,
                "name": name,
                "parent": parent,
                "summary": summary,
                "objective": objective,
                "completion": completion,
                "startNpc": start_npc,
                "finishNpc": finish_npc,
                "startConditions": start_conditions,
                "finishConditions": finish_conditions,
                "startActions": start_actions,
                "rewards": rewards,
            }
        )

    return {
        "meta": {
            "questCount": len(quests),
            "source": "經典服本機 Quest Check／Act 與文字資源",
        },
        "quests": quests,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("equipment_bundle", type=Path)
    parser.add_argument("quest_bundle", type=Path)
    parser.add_argument("text_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--item-bundle", type=Path)
    args = parser.parse_args()

    for source in (args.equipment_bundle, args.quest_bundle, args.text_dir, args.item_bundle):
        if source is None:
            continue
        if not source.exists():
            raise FileNotFoundError(f"Source does not exist: {source}")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    items = load_json(args.text_dir / "Item.json")
    equipment = build_equipment(args.equipment_bundle, items)
    if not equipment["equipment"]:
        raise RuntimeError("No equipment records were decoded; check the bundle path")
    quests = build_quests(args.quest_bundle, args.text_dir)
    item_data = build_items(args.item_bundle, items) if args.item_bundle else None
    write_js(args.output_dir / "equipment-data.js", "MAPLE_EQUIPMENT_DATA", equipment)
    write_js(args.output_dir / "quest-data.js", "MAPLE_QUEST_DATA", quests)
    if item_data:
        write_js(args.output_dir / "item-data.js", "MAPLE_ITEM_DATA", item_data)
    print(
        "BUILT\t"
        f"equipment={equipment['meta']['equipmentCount']}\t"
        f"quests={quests['meta']['questCount']}\t"
        f"items={item_data['meta']['itemCount'] if item_data else 0}\t"
        f"output={args.output_dir}"
    )
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
