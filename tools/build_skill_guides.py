from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ADVANCEMENT_SOURCE = {
    "title": "台版經典服轉職路線整理",
    "url": "https://mapleclassictools.com/guides/job-advancement-guide/",
}

SOURCES = {
    "fighter": "https://www.digitaltq.com/maplestory-fighter-crusader-hero-pre-big-bang-skill-build-guide",
    "page": "https://www.digitaltq.com/maplestory-page-white-knight-paladin-pre-big-bang-skill-build-guide",
    "spearman": "https://www.digitaltq.com/maplestory-spearman-dragon-knight-dark-knight-pre-big-bang-skill-build-guide",
    "fp": "https://www.digitaltq.com/maplestory-fire-poison-pre-big-bang-skill-build-guide",
    "il": "https://www.digitaltq.com/maplestory-ice-lightning-pre-big-bang-skill-build-guide",
    "cleric": "https://www.digitaltq.com/maplestory-cleric-priest-bishop-pre-big-bang-skill-build-guide",
    "hunter": "https://www.digitaltq.com/maplestory-archer-hunter-ranger-bowmaster-pre-big-bang-skill-build-guide",
    "crossbow": "https://www.digitaltq.com/maplestory-archer-crossbowman-sniper-marksman-pre-big-bang-skill-build-guide",
    "assassin": "https://www.digitaltq.com/maplestory-thief-assassin-hermit-night-lord-pre-big-bang-skill-build-guide",
    "bandit": "https://www.digitaltq.com/maplestory-rogue-bandit-chief-bandit-shadower-pre-big-bang-skill-build-guide",
    "brawler": "https://www.digitaltq.com/maplestory-pirate-brawler-marauder-buccaneer-pre-big-bang-skill-build-guide",
    "gunslinger": "https://www.digitaltq.com/maplestory-pirate-gunslinger-outlaw-corsair-pre-big-bang-skill-build-guide",
}


def p(skill_id: int, target: int, note: str = "", add: int | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"skillId": skill_id, "target": target}
    if note:
        result["note"] = note
    if add is not None:
        result["add"] = add
    return result


def choice(label: str, skill_ids: list[int], target: int, note: str = "") -> dict[str, Any]:
    result: dict[str, Any] = {"label": label, "skillIds": skill_ids, "target": target}
    if note:
        result["note"] = note
    return result


def source(key: str) -> list[dict[str, str]]:
    return [
        ADVANCEMENT_SOURCE,
        {"title": "Pre-Big-Bang 社群技能攻略", "url": SOURCES[key]},
    ]


GUIDES: list[dict[str, Any]] = [
    {
        "id": "warrior-1", "family": "劍士", "job": "劍士（一轉）", "stage": "一轉", "levels": "Lv.10–30",
        "ap": "STR 為主；DEX 只補到武器需求或命中夠用，剩餘投入 STR。",
        "summary": "最先處理永久 HP 成長，再完成群攻與單體攻擊。",
        "priority": [p(1000000, 5, "先解鎖生命擴展"), p(1000001, 10, "越早滿越不會損失升級 HP"), p(1001004, 1), p(1001005, 20), p(1001004, 20), p(1001003, 6)],
        "notes": ["若只單練也不要延後生命擴展；它會影響之後每次升級的 Max HP。"], "sources": source("fighter"),
    },
    {
        "id": "magician-1", "family": "法師", "job": "法師（一轉）", "stage": "一轉", "levels": "Lv.8–30",
        "ap": "INT 為主；傳統裝備法讓 LUK 約等級 +3，全智法則先確認裝備路線。",
        "summary": "魔力擴展會影響升級 MP，必須儘早滿；之後完成魔力爪與魔心防禦。",
        "priority": [p(2001004, 1), p(2000000, 5, "解鎖魔力擴展"), p(2000001, 10, "優先滿"), p(2000000, 16), p(2001005, 20), p(2001002, 20)],
        "notes": ["本機技能中的「魔心防禦」是以 MP 代替部分 HP 傷害；不要和提升防禦的「魔力之盾」混淆。"], "sources": source("cleric"),
    },
    {
        "id": "archer-1", "family": "弓箭手", "job": "弓箭手（一轉）", "stage": "一轉", "levels": "Lv.10–30",
        "ap": "DEX 為主；STR 補到武器需求，其餘投入 DEX。",
        "summary": "先拿滿射程與爆擊，再完成二連箭；集中術留作二轉補滿。",
        "priority": [p(3001004, 1), p(3000000, 3), p(3000002, 8), p(3000001, 20), p(3001005, 20), p(3001003, 9)],
        "notes": ["二轉若採不點終極攻擊的路線，可把剩餘點數回補集中術。"], "sources": source("hunter"),
    },
    {
        "id": "thief-assassin-1", "family": "盜賊", "job": "盜賊（一轉・飛俠路線）", "stage": "一轉", "levels": "Lv.10–30",
        "ap": "LUK 為主；DEX 補到拳套需求。",
        "summary": "先拿雙飛斬與投擲射程，再完成幻化術；保留實用隱身。",
        "priority": [p(4001344, 1), p(4000000, 3), p(4000001, 8), p(4001344, 20), p(4000000, 20), p(4001002, 3), p(4001003, 10)],
        "notes": ["這是刺客方向；短劍俠盜不要照此順序。"], "sources": source("assassin"),
    },
    {
        "id": "thief-bandit-1", "family": "盜賊", "job": "盜賊（一轉・俠盜路線）", "stage": "一轉", "levels": "Lv.10–30",
        "ap": "LUK 為主；DEX 補到短劍需求。",
        "summary": "近戰先滿劈空斬，再補幻化術與隱身術。",
        "priority": [p(4001334, 20), p(4000000, 20), p(4001002, 3), p(4001003, 18)],
        "notes": ["鷹之眼只影響投擲武器，短劍路線不必投入。"], "sources": source("bandit"),
    },
    {
        "id": "pirate-brawler-1", "family": "海盜", "job": "海盜（一轉・拳師路線）", "stage": "一轉", "levels": "Lv.10–30",
        "ap": "STR 為主；DEX 補到指虎需求。",
        "summary": "旋風斬是主要群攻，衝鋒改善經典版移動手感。",
        "priority": [p(5001001, 1), p(5001002, 20), p(5001005, 10), p(5000000, 20), p(5001001, 11)],
        "notes": ["衝擊拳最後維持 Lv.11，將完整點數留給群攻、迴避與機動。"], "sources": source("brawler"),
    },
    {
        "id": "pirate-gunslinger-1", "family": "海盜", "job": "海盜（一轉・槍手路線）", "stage": "一轉", "levels": "Lv.10–30",
        "ap": "DEX 為主；STR 補到火槍需求。",
        "summary": "先滿雙子星攻擊，再完成機動與命中迴避。",
        "priority": [p(5001003, 20), p(5001005, 10), p(5000000, 20), p(5001002, 11)],
        "notes": ["旋風斬只是剩餘點數去處，槍手主力仍是遠程雙子星攻擊。"], "sources": source("gunslinger"),
    },
    {
        "id": "fighter-2", "family": "劍士", "job": "狂戰士（二轉）", "stage": "二轉", "levels": "Lv.30–70",
        "ap": "沿用一轉；劍或斧確定一種後，不要同時分散武器技能。",
        "summary": "武器精準與快速先成形，接著滿激勵、反射之盾與同武器終極攻擊。",
        "priority": [choice("精準之劍／精準之斧（二選一）", [1100000, 1100001], 5), choice("快速之劍／快速之斧（同武器）", [1101004, 1101005], 6), choice("精準技能補滿", [1100000, 1100001], 20), p(1101006, 20), p(1101007, 30), choice("快速技能補滿", [1101004, 1101005], 20), choice("終極攻擊（同武器）", [1100002, 1100003], 30), choice("另一武器精準", [1100000, 1100001], 1, "最後 1 點")],
        "notes": ["不喜歡終極攻擊自動觸發，可改成另一武器精準 Lv.20、快速 Lv.11 的無終極流派。"], "sources": source("fighter"),
    },
    {
        "id": "page-2", "family": "劍士", "job": "見習騎士（二轉）", "stage": "二轉", "levels": "Lv.30–70",
        "ap": "劍或棍擇一專精；STR 為主、DEX 依命中與裝備調整。",
        "summary": "精準與快速先成形，降魔咒作為反射之盾前置，之後完成核心防禦。",
        "priority": [choice("精準之劍／精準之棍（二選一）", [1200000, 1200001], 5), choice("快速之劍／快速之棍（同武器）", [1201004, 1201005], 6), choice("精準技能補滿", [1200000, 1200001], 20), p(1201006, 20), p(1201007, 30), choice("快速技能補滿", [1201004, 1201005], 20), choice("終極攻擊（同武器）", [1200002, 1200003], 30), choice("另一武器精準", [1200000, 1200001], 1, "最後 1 點")],
        "notes": ["終極攻擊同樣可替換成第二武器精準／快速，依未來武器規劃選擇。"], "sources": source("page"),
    },
    {
        "id": "spearman-2", "family": "劍士", "job": "槍騎兵（二轉）", "stage": "二轉", "levels": "Lv.30–70",
        "ap": "槍或矛擇一；STR 為主、DEX 只補命中與裝備。",
        "summary": "先取得武器手感，再優先完成神聖之火；團練價值很高。",
        "priority": [choice("精準之槍／精準之矛（二選一）", [1300000, 1300001], 5), choice("快速之槍／快速之矛（同武器）", [1301004, 1301005], 6), choice("精準技能補滿", [1300000, 1300001], 20), p(1301006, 3, "神聖之火前置"), p(1301007, 30), p(1301006, 20), choice("快速技能補滿", [1301004, 1301005], 20), choice("終極攻擊（同武器）", [1300002, 1300003], 30), choice("另一武器精準", [1300000, 1300001], 1, "最後 1 點")],
        "notes": ["若固定團練，可在精準到基本命中後更早把神聖之火點滿。"], "sources": source("spearman"),
    },
    {
        "id": "fp-2", "family": "法師", "job": "火毒巫師（二轉）", "stage": "二轉", "levels": "Lv.30–70",
        "ap": "INT 為主；裝備法依需求維持 LUK。",
        "summary": "火焰箭先提供穩定單體輸出，再完成精神強化與機動；毒霧後補。",
        "priority": [p(2101004, 30), p(2100000, 3), p(2101001, 20), p(2101002, 20), p(2100000, 20), p(2101005, 30), p(2101003, 1)],
        "notes": ["若打算提早用中毒跨級練怪，可把毒霧提前；一般練等仍以火焰箭先滿較穩。"], "sources": source("fp"),
    },
    {
        "id": "il-2", "family": "法師", "job": "冰雷巫師（二轉）", "stage": "二轉", "levels": "Lv.30–70",
        "ap": "INT 為主；裝備法依需求維持 LUK。",
        "summary": "電閃雷鳴先滿以建立群攻效率，再補精神強化、瞬移與冰錐控場。",
        "priority": [p(2201005, 30), p(2200000, 3), p(2201001, 20), p(2201002, 20), p(2200000, 20), p(2201004, 30), p(2201003, 1)],
        "notes": ["若常打火屬性或需要單體控場，可先放 1 點冰錐術再回頭滿雷。"], "sources": source("il"),
    },
    {
        "id": "cleric-2", "family": "法師", "job": "僧侶（二轉）", "stage": "二轉", "levels": "Lv.30–70",
        "ap": "INT 為主；全智或裝備法依既定裝備路線維持。",
        "summary": "瞬移 1 後直接滿群體治癒，再完成省水、生存與團隊增益。",
        "priority": [p(2301001, 1), p(2301002, 30), p(2300000, 20), p(2301003, 5, "解鎖天使祝福"), p(2301004, 20), p(2301001, 20), p(2301003, 20), p(2301005, 11)],
        "notes": ["群體治癒可攻擊不死系，是 30–70 等最核心練功技能；神聖之箭通常只放剩餘點。"], "sources": source("cleric"),
    },
    {
        "id": "hunter-2", "family": "弓箭手", "job": "獵人（二轉）", "stage": "二轉", "levels": "Lv.30–70",
        "ap": "DEX 為主；STR 補弓需求。",
        "summary": "炸彈箭先 1 點，精準與快速建立手感後滿群攻；採不點終極攻擊版本。",
        "priority": [p(3101005, 1), p(3100000, 5), p(3101002, 6), p(3100000, 20), p(3101005, 30), p(3101002, 20), p(3101003, 20), p(3101004, 20), p(3001003, 20, "把一轉集中術由 9 補至 20", add=11)],
        "notes": ["這套避開終極之弓，攻擊節奏較可控；喜歡終極攻擊可把回補集中術與部分強弓點數移過去。"], "sources": source("hunter"),
    },
    {
        "id": "crossbow-2", "family": "弓箭手", "job": "弩弓手（二轉）", "stage": "二轉", "levels": "Lv.30–70",
        "ap": "DEX 為主；STR 補弩需求。",
        "summary": "穿透之箭先 1 點，精準與快速成形後完成群攻；採不點終極攻擊版本。",
        "priority": [p(3201005, 1), p(3200000, 5), p(3201002, 6), p(3200000, 20), p(3201005, 30), p(3201002, 20), p(3201003, 20), p(3201004, 20), p(3001003, 20, "把一轉集中術由 9 補至 20", add=11)],
        "notes": ["穿透之箭需留意站位與貫穿方向；終極之弩屬可選流派。"], "sources": source("crossbow"),
    },
    {
        "id": "assassin-2", "family": "盜賊", "job": "刺客（二轉）", "stage": "二轉", "levels": "Lv.30–70",
        "ap": "LUK 為主；DEX 補拳套需求。",
        "summary": "先精準、攻速與強力投擲，接著滿速度激發；恢復術 3 是吸血術前置。",
        "priority": [p(4100000, 5), p(4101003, 6), p(4100001, 30), p(4101004, 20), p(4100000, 20), p(4100002, 3), p(4101005, 30), p(4101003, 18)],
        "notes": ["極速暗殺 Lv.18 已能維持良好覆蓋；剩餘點數先滿吸血術的實用性更高。"], "sources": source("assassin"),
    },
    {
        "id": "bandit-2", "family": "盜賊", "job": "俠盜（二轉）", "stage": "二轉", "levels": "Lv.30–70",
        "ap": "LUK 為主；DEX 補短劍需求。",
        "summary": "先讓迴旋斬成為主力，再完成精準、快速與速度激發。",
        "priority": [p(4200000, 1), p(4201005, 30), p(4200000, 20), p(4201002, 10), p(4201003, 20), p(4201002, 20), p(4201004, 30), p(4001003, 19, "把一轉隱身術由 18 補至 19", add=1)],
        "notes": ["妙手術偏功能性，所以排在主要輸出與機動技能之後。"], "sources": source("bandit"),
    },
    {
        "id": "brawler-2", "family": "海盜", "job": "拳師（二轉）", "stage": "二轉", "levels": "Lv.30–70",
        "ap": "STR 為主；DEX 補指虎需求。",
        "summary": "體魄強健影響永久 HP，轉職後立即優先；之後建立精通、位移與攻速。",
        "priority": [p(5100000, 10, "越早滿越不損失升級 HP"), p(5101002, 1), p(5100001, 5), p(5101006, 10), p(5100001, 20), p(5101002, 20), p(5101004, 20), p(5101003, 20), p(5101006, 20), p(5101005, 10), p(5101007, 1)],
        "notes": ["體魄強健和劍士的生命擴展相同，延後會永久少掉升級時可取得的 Max HP。"], "sources": source("brawler"),
    },
    {
        "id": "gunslinger-2", "family": "海盜", "job": "槍手（二轉）", "stage": "二轉", "levels": "Lv.30–70",
        "ap": "DEX 為主；STR 補火槍需求。",
        "summary": "散射 1 起手，精通與迅雷再起建立輸出，再補脫離戰場和主要範圍技。",
        "priority": [p(5201001, 1), p(5200000, 5), p(5201003, 10), p(5200000, 20), p(5201001, 20), p(5201005, 5), p(5201006, 20), p(5201003, 20), p(5201005, 10), p(5201004, 20), p(5201002, 11)],
        "notes": ["本機技能名稱「迅雷再起」就是火槍攻速增益；「脫離戰場」是利用後座力後退的機動攻擊。"], "sources": source("gunslinger"),
    },
]


def clean(value: Any) -> str:
    return " ".join(str(value or "").replace("\\n", "\n").split())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill_json", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    skills = json.loads(args.skill_json.read_text(encoding="utf-8"))

    used_ids = {
        skill_id
        for guide in GUIDES
        for entry in guide["priority"]
        for skill_id in ([entry["skillId"]] if "skillId" in entry else entry.get("skillIds", []))
    }
    skill_index: dict[str, dict[str, Any]] = {}
    for skill_id in sorted(used_ids):
        raw = skills.get(str(skill_id), {})
        if not isinstance(raw, dict) or not raw.get("Name"):
            raise RuntimeError(f"Missing localized skill {skill_id}")
        description = clean(raw.get("Desc"))
        maximum = re.search(r"(?:最高等級|等級上限)[：:]\s*(\d+)", description)
        skill_index[str(skill_id)] = {
            "id": skill_id,
            "name": clean(raw.get("Name")),
            "description": re.sub(r"^\[(?:最高等級|等級上限)[：:]\s*\d+\]\s*", "", description),
            "maxLevel": int(maximum.group(1)) if maximum else None,
        }

    for guide in GUIDES:
        for entry in guide["priority"]:
            ids = [entry["skillId"]] if "skillId" in entry else entry.get("skillIds", [])
            if not ids:
                continue
            max_level = max(skill_index[str(skill_id)]["maxLevel"] or 0 for skill_id in ids)
            if entry["target"] > max_level:
                raise RuntimeError(f"Target exceeds max level in {guide['id']}: {entry}")

    payload = {
        "meta": {
            "guideCount": len(GUIDES),
            "familyCount": len({guide["family"] for guide in GUIDES}),
            "levelScope": "一、二轉（約 Lv.8/10–70）",
            "researchedAt": "2026-08-04",
            "source": "經典服本機技能文字，交叉比對台版轉職資料與 Pre-Big-Bang 社群攻略",
        },
        "skills": skill_index,
        "guides": GUIDES,
    }
    args.output.write_text(
        "window.MAPLE_SKILL_GUIDES=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"BUILT\tguides={len(GUIDES)}\tskills={len(skill_index)}\toutput={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
