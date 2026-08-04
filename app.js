(() => {
  "use strict";

  const dropData = window.MAPLE_DROP_DATA;
  const itemData = window.MAPLE_ITEM_DATA;
  const equipmentData = window.MAPLE_EQUIPMENT_DATA;
  const questData = window.MAPLE_QUEST_DATA;
  const skillData = window.MAPLE_SKILL_GUIDES;
  const iconIds = new Set(window.MAPLE_ITEM_ICON_IDS || []);

  if (!dropData?.monsters || !itemData?.items || !equipmentData?.equipment || !questData?.quests || !skillData?.guides) {
    document.body.innerHTML = "<p style='padding:2rem;font-family:sans-serif'>資料檔載入失敗，請確認所有 *-data.js 都和 index.html 放在同一資料夾。</p>";
    return;
  }

  // Some MonsterBook/Quest references point to ids whose detailed record was
  // removed from the current bundle. Keep those ids navigable instead of
  // sending the user to an empty result.
  const referencedNames = new Map();
  dropData.monsters.forEach((monster) => monster.drops.forEach((entry) => referencedNames.set(Number(entry.id), entry.name)));
  questData.quests.forEach((quest) => [quest.startConditions, quest.finishConditions, quest.startActions, quest.rewards].forEach((section) => (section?.items || []).forEach((entry) => {
    if (!referencedNames.has(Number(entry.id))) referencedNames.set(Number(entry.id), entry.name);
  })));
  const knownItems = new Set(itemData.items.map((entry) => Number(entry.id)));
  const knownEquipment = new Set(equipmentData.equipment.map((entry) => Number(entry.id)));
  referencedNames.forEach((rawName, id) => {
    const name = rawName && !/^(未知|未收錄)/.test(rawName) ? rawName : `未收錄物品 ${id}`;
    if (id >= 1_000_000 && id < 2_000_000 && !knownEquipment.has(id)) {
      equipmentData.equipment.push({ id, name, description: "此編號只出現在掉落或任務關聯中，目前裝備資源沒有詳細能力資料。", category: "未分類裝備", categoryKey: "Equipment", requirements: {}, stats: {}, attributes: {}, available: false, referenceOnly: true });
      knownEquipment.add(id);
    } else if ((id < 1_000_000 || id >= 2_000_000) && !knownItems.has(id)) {
      const group = Math.floor(id / 10_000);
      const isScroll = group === 204;
      const isQuest = group === 403;
      const categoryKey = id >= 2_000_000 && id < 3_000_000 ? "Consume" : id >= 3_000_000 && id < 4_000_000 ? "Install" : id >= 4_000_000 && id < 5_000_000 ? "Etc" : "Item";
      const category = categoryKey === "Consume" ? "消耗品" : categoryKey === "Install" ? "設置道具" : "其他道具";
      itemData.items.push({ id, name, description: "此編號只出現在掉落或任務關聯中，目前道具資源沒有詳細說明。", category, categoryKey, subcategory: isScroll ? "裝備卷軸" : isQuest ? "任務道具" : "未分類道具", available: false, referenceOnly: true, info: {}, spec: {}, sourcePath: "" });
      knownItems.add(id);
    }
  });
  itemData.items.sort((a, b) => Number(a.id) - Number(b.id));
  equipmentData.equipment.sort((a, b) => Number(a.id) - Number(b.id));

  const $ = (selector) => document.querySelector(selector);
  const searchInput = $("#searchInput");
  const results = $("#results");
  const emptyState = $("#emptyState");
  const loadMore = $("#loadMore");
  const resultTitle = $("#resultTitle");
  const resultSummary = $("#resultSummary");
  const clearSearch = $("#clearSearch");
  const modeSwitch = $("#modeSwitch");
  const sectionKicker = $("#sectionKicker");
  const sourceCopy = $("#sourceCopy");
  const themeToggle = $("#themeToggle");
  const themeIcon = $("#themeIcon");
  const themeLabel = $("#themeLabel");
  const viewButtons = [...document.querySelectorAll("[data-view]")];
  const pageSize = 18;
  let view = "drop";
  let mode = "all";
  let visibleCount = pageSize;
  let filtered = [];

  const normalize = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("zh-Hant").replace(/\s+/g, " ").trim();
  const formatNumber = (value) => new Intl.NumberFormat("zh-TW").format(value);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const multiline = (value) => escapeHtml(value).replace(/\n/g, "<br />");
  const addIndex = (index, key, entry) => {
    const id = Number(key);
    if (!index.has(id)) index.set(id, []);
    if (!index.get(id).some((current) => Number(current.id) === Number(entry.id))) index.get(id).push(entry);
  };

  const statLabels = {
    incSTR: "力量", incDEX: "敏捷", incINT: "智力", incLUK: "幸運",
    incMHP: "最大 HP", incHP: "HP", incMMP: "最大 MP", incMP: "MP",
    incPAD: "物理攻擊", incMAD: "魔法攻擊", incPDD: "物理防禦", incMDD: "魔法防禦",
    incACC: "命中", incEVA: "迴避", incSpeed: "移動速度", incJump: "跳躍力",
    incCraft: "手技", incSwim: "游泳速度", incFatigue: "疲勞度"
  };
  const propertyLabels = {
    hp: "HP 恢復", mp: "MP 恢復", hpR: "HP 恢復比例", mpR: "MP 恢復比例",
    pad: "物理攻擊", mad: "魔法攻擊", pdd: "物理防禦", mdd: "魔法防禦",
    acc: "命中", eva: "迴避", speed: "移動速度", jump: "跳躍力", time: "持續時間",
    price: "商店價格", slotMax: "單格上限", success: "成功率", cursed: "詛咒率", prob: "機率",
    reqLevel: "需求等級", tradeBlock: "不可交易", notSale: "不可販售", only: "唯一持有",
    quest: "任務道具", consumeOnPickup: "拾取即使用", accountSharable: "帳號內可移動",
    recover: "可恢復", stateChangeItem: "狀態效果", npc: "NPC 功能", script: "腳本功能"
  };
  const requirementLabels = { reqSTR: "力量", reqDEX: "敏捷", reqINT: "智力", reqLUK: "幸運", reqPOP: "名聲" };
  const armorCategories = new Set(["Cap", "Coat", "Longcoat", "Pants", "Shoes", "Glove", "Shield", "Cape"]);
  const accessoryCategories = new Set(["Accessory", "Ring"]);
  const equipmentIds = new Set(equipmentData.equipment.map((item) => Number(item.id)));
  const itemById = new Map(itemData.items.map((item) => [Number(item.id), item]));
  const equipmentById = new Map(equipmentData.equipment.map((item) => [Number(item.id), item]));
  const monsterById = new Map(dropData.monsters.map((monster) => [Number(monster.id), monster]));
  const questById = new Map(questData.quests.map((quest) => [Number(quest.id), quest]));

  const questNextIds = new Map();
  const questPreviousIds = new Map();
  const addQuestEdge = (fromId, toId) => {
    const from = Number(fromId);
    const to = Number(toId);
    if (from === to || !questById.has(from) || !questById.has(to)) return;
    if (!questNextIds.has(from)) questNextIds.set(from, new Set());
    if (!questPreviousIds.has(to)) questPreviousIds.set(to, new Set());
    questNextIds.get(from).add(to);
    questPreviousIds.get(to).add(from);
  };

  questData.quests.forEach((quest) => {
    [quest.startActions?.nextQuest, quest.rewards?.nextQuest].forEach((nextId) => {
      if (Number.isInteger(nextId)) addQuestEdge(quest.id, nextId);
    });
    (quest.startConditions?.quests || []).filter((requirement) => Number(requirement.state) === 2).forEach((requirement) => addQuestEdge(requirement.id, quest.id));
  });

  const dropSources = new Map();
  const rewardQuestSources = new Map();
  const useQuestSources = new Map();
  const monsterQuestSources = new Map();

  dropData.monsters.forEach((monster) => {
    monster.drops.forEach((item) => addIndex(dropSources, item.id, monster));
  });

  function itemEntries(section) { return section?.items || []; }
  questData.quests.forEach((quest) => {
    [quest.startActions, quest.rewards].forEach((section) => itemEntries(section).forEach((item) => {
      if (Number(item.count) > 0) addIndex(rewardQuestSources, item.id, quest);
      if (Number(item.count) < 0) addIndex(useQuestSources, item.id, quest);
    }));
    [quest.startConditions, quest.finishConditions].forEach((section) => {
      itemEntries(section).forEach((item) => addIndex(useQuestSources, item.id, quest));
      (section?.mobs || []).forEach((monster) => addIndex(monsterQuestSources, monster.id, quest));
    });
  });

  const viewConfig = {
    drop: {
      kicker: "MONSTER INDEX", title: "全部圖鑑怪物", placeholder: "輸入怪物、物品、任務、地圖名稱或 ID…",
      modes: [["all", "全部"], ["monster", "怪物"], ["item", "掉落物"], ["map", "地圖"], ["quest", "相關任務"]],
      source: "掉落與地圖來自本機 <code>MonsterBook</code> 圖鑑；原始檔沒有掉落機率，因此不顯示機率。相關任務由任務條件反向建立索引。"
    },
    item: {
      kicker: "ITEM INDEX", title: "全部道具圖鑑", placeholder: "輸入道具名稱、ID、說明、類別或效果…",
      modes: [["all", "全部"], ["consume", "消耗品"], ["scroll", "卷軸"], ["quest", "任務道具"], ["etc", "其他"], ["install", "設置"], ["cash", "點數／寵物"]],
      source: "道具名稱、說明與效果來自本機 <code>Item</code> 資源。標示「文字資源保留」者不一定存在於目前伺服器；取得方式只列出本機圖鑑與任務能確認的來源。"
    },
    equipment: {
      kicker: "EQUIPMENT INDEX", title: "全部裝備能力", placeholder: "輸入裝備名稱、裝備 ID、種類、能力或取得來源…",
      modes: [["all", "全部"], ["weapon", "武器"], ["armor", "防具"], ["accessory", "飾品"], ["other", "其他"]],
      source: "裝備需求與能力直接整理自經典服本機 <code>Equipment</code> 資源；怪物掉落與任務獎勵會反向連結到裝備。基礎值不含卷軸或其他角色加成。"
    },
    quest: {
      kicker: "QUEST INDEX", title: "全部任務流程", placeholder: "輸入任務名稱、任務 ID、NPC、物品或怪物…",
      modes: [["all", "全部"], ["name", "任務名稱"], ["npc", "NPC"], ["item", "物品"], ["mob", "怪物"]],
      source: "任務流程與完整任務鏈由本機 <code>Quest Check</code>、<code>Quest Act</code>、已完成前置條件與任務文字交叉整理。腳本控制、隨機獎勵或伺服器調整仍以遊戲內狀態為準。"
    },
    skill: {
      kicker: "SKILL BUILD", title: "各職業技能配點", placeholder: "輸入職業、技能名稱或等級區間…",
      modes: [["all", "全部"], ["劍士", "劍士"], ["法師", "法師"], ["弓箭手", "弓箭手"], ["盜賊", "盜賊"], ["海盜", "海盜"]],
      source: "技能名稱與效果以本機經典版資料為準；推薦順序交叉比對台版轉職資訊與 Pre-Big-Bang 社群攻略。配點有流派差異，請先看每張卡片的替代方案。"
    }
  };

  function questValues(quest, key) {
    return [quest.startConditions, quest.finishConditions, quest.startActions, quest.rewards].flatMap((section) => section?.[key] || []);
  }

  dropData.monsters.forEach((monster) => {
    const quests = monsterQuestSources.get(Number(monster.id)) || [];
    monster._monster = normalize(`${monster.name} ${monster.id} ${monster.description}`);
    monster._items = normalize(monster.drops.map((item) => `${item.name} ${item.id}`).join(" "));
    monster._maps = normalize(monster.maps.map((map) => `${map.street} ${map.name} ${map.id}`).join(" "));
    monster._quests = normalize(quests.map((quest) => `${quest.name} ${quest.id}`).join(" "));
    monster._all = `${monster._monster} ${monster._items} ${monster._maps} ${monster._quests}`;
  });

  itemData.items.forEach((item) => {
    const monsters = dropSources.get(Number(item.id)) || [];
    const rewards = rewardQuestSources.get(Number(item.id)) || [];
    const uses = useQuestSources.get(Number(item.id)) || [];
    item._all = normalize(`${item.name} ${item.id} ${item.description} ${item.category} ${item.subcategory} ${JSON.stringify(item.info)} ${JSON.stringify(item.spec)} ${monsters.map((entry) => entry.name).join(" ")} ${[...rewards, ...uses].map((entry) => entry.name).join(" ")}`);
  });

  equipmentData.equipment.forEach((item) => {
    const translatedStats = Object.keys(item.stats).map((key) => statLabels[key] || key).join(" ");
    const sources = [...(dropSources.get(Number(item.id)) || []), ...(rewardQuestSources.get(Number(item.id)) || [])];
    item._all = normalize(`${item.name} ${item.id} ${item.description || ""} ${item.category} ${translatedStats} ${Object.keys(item.stats).join(" ")} ${sources.map((entry) => entry.name).join(" ")}`);
  });

  questData.quests.forEach((quest) => {
    quest._name = normalize(`${quest.name} ${quest.id} ${quest.parent} ${quest.summary} ${quest.objective}`);
    quest._npc = normalize([quest.startNpc, quest.finishNpc].filter(Boolean).map((entry) => `${entry.name} ${entry.id}`).join(" "));
    quest._item = normalize(questValues(quest, "items").map((entry) => `${entry.name} ${entry.id}`).join(" "));
    quest._mob = normalize(questValues(quest, "mobs").map((entry) => `${entry.name} ${entry.id}`).join(" "));
    quest._all = `${quest._name} ${quest._npc} ${quest._item} ${quest._mob}`;
  });

  skillData.guides.forEach((guide) => {
    const names = guide.priority.flatMap((step) => step.skillId ? [skillData.skills[String(step.skillId)]?.name] : (step.skillIds || []).map((id) => skillData.skills[String(id)]?.name));
    guide._all = normalize(`${guide.family} ${guide.job} ${guide.stage} ${guide.levels} ${guide.ap} ${guide.summary} ${names.join(" ")}`);
  });

  $("#monsterStat").textContent = formatNumber(dropData.meta.monsterCount);
  $("#itemStat").textContent = formatNumber(itemData.items.length);
  $("#equipmentStat").textContent = formatNumber(equipmentData.equipment.length);
  $("#questStat").textContent = formatNumber(questData.meta.questCount);

  function applyTheme(nextTheme, persist = true) {
    const theme = nextTheme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    themeIcon.textContent = theme === "dark" ? "☀" : "☾";
    themeLabel.textContent = theme === "dark" ? "切換明亮" : "切換暗色";
    if (persist) {
      try { window.localStorage?.setItem("maple-theme", theme); } catch (_) { /* Local files may block storage. */ }
    }
  }

  const initialTheme = document.documentElement.dataset.theme
    || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(initialTheme, false);
  themeToggle.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  function itemIconHtml(itemId, large = false) {
    const id = Number(itemId);
    const available = iconIds.has(id);
    return `<span class="item-icon-frame${large ? " item-icon-frame--large" : ""}${available ? "" : " item-icon-frame--missing"}" aria-hidden="true">${available ? `<img class="item-icon" src="icons/${id}.png" alt="" loading="lazy" decoding="async" />` : ""}</span>`;
  }

  function navButton(label, id, targetView, targetMode = "all", className = "chip") {
    return `<button class="${className}" type="button" data-chip-view="${targetView}" data-chip-mode="${targetMode}" data-chip-query="${escapeHtml(id)}" title="開啟 ${escapeHtml(label)}"><span class="chip__label">${escapeHtml(label)}<small>${escapeHtml(id)}</small></span></button>`;
  }

  function itemChipHtml(item, count = null) {
    const id = Number(item.id);
    const targetView = equipmentIds.has(id) ? "equipment" : "item";
    const countLabel = count === null ? "" : `<b>${count > 0 ? "×" : "−"}${formatNumber(Math.abs(count))}</b>`;
    return `<button class="chip chip--item" type="button" data-chip-view="${targetView}" data-chip-mode="all" data-chip-query="${id}" title="開啟完整物品資料">${itemIconHtml(id)}<span class="chip__label">${escapeHtml(item.name)}<small>${id}</small></span>${countLabel}</button>`;
  }

  function dropChipHtml(entry, chipMode, className = "") {
    const label = chipMode === "map" && entry.street ? `${entry.street}・${entry.name}` : entry.name;
    if (chipMode === "item") return itemChipHtml(entry);
    return navButton(label, entry.id, "drop", chipMode, `chip ${className}`.trim());
  }

  function previewGroupHtml(title, entries, renderEntry, className = "") {
    if (!entries.length) return `<div class="data-group ${className}"><p class="data-group__title">${title}</p><span class="missing">沒有資料</span></div>`;
    const preview = entries.slice(0, 7).map(renderEntry).join("");
    return `<div class="data-group ${className}"><p class="data-group__title">${title}</p><div class="chips">${preview}${entries.length > 7 ? `<span class="chip chip--static">另有 ${entries.length - 7} 筆</span>` : ""}</div></div>`;
  }

  function fullGroupHtml(title, entries, renderEntry, className = "") {
    return `<div class="data-group ${className}"><p class="data-group__title">${title}</p><div class="chips">${entries.map(renderEntry).join("") || '<span class="missing">沒有資料</span>'}</div></div>`;
  }

  function relationDetailsHtml(itemId) {
    const drops = (dropSources.get(Number(itemId)) || []).sort((a, b) => a.id - b.id);
    const rewards = (rewardQuestSources.get(Number(itemId)) || []).sort((a, b) => a.id - b.id);
    const uses = (useQuestSources.get(Number(itemId)) || []).sort((a, b) => a.id - b.id);
    const groups = [
      ["擊殺怪物掉落", drops, (entry) => navButton(entry.name, entry.id, "drop", "monster")],
      ["任務取得", rewards, (entry) => navButton(entry.name, entry.id, "quest")],
      ["任務需求／用途", uses, (entry) => navButton(entry.name, entry.id, "quest")]
    ];
    if (![...drops, ...rewards, ...uses].length) return `<div class="acquisition"><p class="data-group__title">取得與用途</p><span class="missing">本機圖鑑與任務資料未記錄來源</span></div>`;
    return `<div class="acquisition">${groups.filter(([, entries]) => entries.length).map(([title, entries, renderer]) => `<div><p class="data-group__title">${title}</p><div class="chips">${entries.slice(0, 10).map(renderer).join("")}</div>${entries.length > 10 ? `<details class="card-details"><summary>顯示全部 ${entries.length} 筆</summary><div class="card-details__body"><div class="chips">${entries.map(renderer).join("")}</div></div></details>` : ""}</div>`).join("")}</div>`;
  }

  function dropCardHtml(monster) {
    const relatedQuests = monsterQuestSources.get(Number(monster.id)) || [];
    const detailsNeeded = monster.maps.length > 7 || monster.drops.length > 7 || relatedQuests.length > 7;
    const fullGroups = detailsNeeded ? `<details class="card-details"><summary>查看完整關聯資料</summary><div class="card-details__body">${fullGroupHtml("完整掉落物", monster.drops, (item) => itemChipHtml(item), "data-group--drops")}${fullGroupHtml("完整出沒地圖", monster.maps, (map) => dropChipHtml(map, "map", "chip--map"))}${fullGroupHtml("完整相關任務", relatedQuests, (quest) => navButton(quest.name, quest.id, "quest"))}</div></details>` : "";
    return `<article class="monster-card"><div class="monster-card__top"><div><h3>${escapeHtml(monster.name)}</h3><span class="monster-id">MOB ${escapeHtml(monster.id)}</span></div><div class="count-pills"><span class="count-pill">${monster.drops.length} 掉落</span><span class="count-pill count-pill--map">${monster.maps.length} 地圖</span></div></div><p class="monster-description">${escapeHtml(monster.description || "本機圖鑑沒有額外說明。")}</p>${previewGroupHtml("掉落物", monster.drops, (item) => itemChipHtml(item), "data-group--drops")}${previewGroupHtml("出沒地圖", monster.maps, (map) => dropChipHtml(map, "map", "chip--map"))}${previewGroupHtml("相關任務", relatedQuests, (quest) => navButton(quest.name, quest.id, "quest"))}${fullGroups}</article>`;
  }

  function itemGroup(item) {
    if (item.subcategory === "裝備卷軸" || item.subcategory === "移動卷軸") return "scroll";
    if (item.subcategory === "任務道具") return "quest";
    if (item.categoryKey === "Consume") return "consume";
    if (item.categoryKey === "Etc") return "etc";
    if (item.categoryKey === "Install") return "install";
    if (["Cash", "Pet"].includes(item.categoryKey)) return "cash";
    return "etc";
  }

  function propertyValue(key, value) {
    if (typeof value === "boolean") return value ? "是" : "否";
    if (key === "price") return `${formatNumber(value)} 楓幣`;
    if (["success", "cursed", "prob", "hpR", "mpR"].includes(key)) return `${value}%`;
    if (key === "time") return `${formatNumber(value)} 秒`;
    if (typeof value === "number") return formatNumber(value);
    return String(value);
  }

  function itemPropertiesHtml(item) {
    const hidden = new Set(["icon", "iconRaw"]);
    const properties = [...Object.entries(item.spec || {}), ...Object.entries(item.info || {})]
      .filter(([key, value], index, all) => !hidden.has(key) && value !== "" && value !== null && all.findIndex(([other]) => other === key) === index);
    if (!properties.length) return '<span class="missing">沒有可顯示的額外數值</span>';
    return `<div class="stat-grid item-property-grid">${properties.map(([key, value]) => `<div class="stat-cell"><span>${escapeHtml(propertyLabels[key] || statLabels[key] || key)}</span><strong>${escapeHtml(propertyValue(key, value))}</strong></div>`).join("")}</div>`;
  }

  function itemCardHtml(item) {
    const status = item.available ? "目前資料存在" : item.referenceOnly ? "僅關聯 ID" : "文字資源保留";
    return `<article class="monster-card item-card"><div class="equipment-card__header">${itemIconHtml(item.id, true)}<div class="equipment-card__identity"><span class="category-label">${escapeHtml(item.category)}・${escapeHtml(item.subcategory)}</span><h3>${escapeHtml(item.name)}</h3><span class="monster-id">ITEM ${item.id}</span></div></div><div class="requirement-row"><span>${escapeHtml(status)}</span>${item.info?.slotMax ? `<span>單格 ${formatNumber(item.info.slotMax)} 個</span>` : ""}</div><p class="item-description">${multiline(item.description || "本機文字沒有額外道具說明。")}</p><div class="data-group data-group--stats"><p class="data-group__title">效果與屬性</p>${itemPropertiesHtml(item)}</div>${relationDetailsHtml(item.id)}</article>`;
  }

  function jobLabel(mask) {
    const value = Number(mask || 0);
    if (value === 0) return "全職業";
    const jobs = [[1, "劍士"], [2, "法師"], [4, "弓箭手"], [8, "盜賊"], [16, "海盜"]].filter(([bit]) => value & bit).map(([, label]) => label);
    return jobs.join("／") || `職業代碼 ${value}`;
  }

  function attackSpeedLabel(value) { return ({ 2: "最快", 3: "較快", 4: "快", 5: "普通", 6: "慢", 7: "較慢", 8: "最慢" })[value] || String(value); }

  function equipmentCardHtml(item) {
    const requirements = [];
    if (item.requirements.reqLevel) requirements.push(`等級 ${item.requirements.reqLevel}`);
    if (item.available === false) requirements.push(item.referenceOnly ? "僅關聯 ID，能力未收錄" : "文字資源保留，現行能力未收錄");
    else requirements.push(jobLabel(item.requirements.reqJob));
    Object.entries(requirementLabels).forEach(([key, label]) => { if (item.requirements[key]) requirements.push(`${label} ${item.requirements[key]}`); });
    const stats = Object.entries(item.stats).filter(([, value]) => Number(value) !== 0);
    const attributes = [];
    if (item.attributes.tuc !== undefined) attributes.push(["可升級次數", item.attributes.tuc]);
    if (item.attributes.attackSpeed !== undefined) attributes.push(["攻擊速度", attackSpeedLabel(item.attributes.attackSpeed)]);
    if (item.attributes.price !== undefined) attributes.push(["商店價格", `${formatNumber(item.attributes.price)} 楓幣`]);
    if (item.attributes.tradeBlock) attributes.push(["交易", "不可交易"]);
    if (item.attributes.only) attributes.push(["持有", "唯一裝備"]);
    const statHtml = stats.length ? stats.map(([key, value]) => `<div class="stat-cell"><span>${escapeHtml(statLabels[key] || key)}</span><strong>${Number(value) > 0 ? "+" : ""}${formatNumber(value)}</strong></div>`).join("") : '<span class="missing">沒有額外能力值</span>';
    const attributeHtml = attributes.length ? `<dl class="attribute-list">${attributes.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : "";
    return `<article class="monster-card equipment-card"><div class="equipment-card__header">${itemIconHtml(item.id, true)}<div class="equipment-card__identity"><span class="category-label">${escapeHtml(item.category)}</span><h3>${escapeHtml(item.name)}</h3><span class="monster-id">ITEM ${escapeHtml(item.id)}</span></div></div>${item.description ? `<p class="item-description">${multiline(item.description)}</p>` : ""}<div class="requirement-row">${requirements.map((entry) => `<span>${escapeHtml(entry)}</span>`).join("")}</div><div class="data-group data-group--stats"><p class="data-group__title">基礎能力</p><div class="stat-grid">${statHtml}</div></div>${attributeHtml}${relationDetailsHtml(item.id)}</article>`;
  }

  function questName(questId) {
    return questById.get(Number(questId))?.name || `未收錄任務 ${questId}`;
  }

  function questLink(questId, label = null) {
    return `<button class="text-link" type="button" data-chip-view="quest" data-chip-mode="all" data-chip-query="${questId}">${escapeHtml(label || questName(questId))}</button>`;
  }

  function questChainLevels(questId) {
    const startId = Number(questId);
    const component = new Set([startId]);
    const pending = [startId];
    while (pending.length) {
      const current = pending.pop();
      const adjacent = [...(questPreviousIds.get(current) || []), ...(questNextIds.get(current) || [])];
      adjacent.forEach((nextId) => {
        if (!component.has(nextId)) { component.add(nextId); pending.push(nextId); }
      });
    }

    const indegree = new Map([...component].map((id) => [id, [...(questPreviousIds.get(id) || [])].filter((previous) => component.has(previous)).length]));
    const depth = new Map([...component].map((id) => [id, 0]));
    const ready = [...component].filter((id) => indegree.get(id) === 0).sort((a, b) => a - b);
    const processed = new Set();
    while (ready.length) {
      const current = ready.shift();
      processed.add(current);
      [...(questNextIds.get(current) || [])].filter((nextId) => component.has(nextId)).sort((a, b) => a - b).forEach((nextId) => {
        depth.set(nextId, Math.max(depth.get(nextId) || 0, (depth.get(current) || 0) + 1));
        indegree.set(nextId, indegree.get(nextId) - 1);
        if (indegree.get(nextId) === 0) ready.push(nextId);
      });
      ready.sort((a, b) => a - b);
    }

    // Cycles are unexpected, but keeping them visible is better than losing
    // part of a chain when the source data contains a circular requirement.
    const finalDepth = Math.max(0, ...depth.values()) + 1;
    [...component].filter((id) => !processed.has(id)).forEach((id) => depth.set(id, finalDepth));
    const levels = new Map();
    [...component].sort((a, b) => (depth.get(a) || 0) - (depth.get(b) || 0) || a - b).forEach((id) => {
      const level = depth.get(id) || 0;
      if (!levels.has(level)) levels.set(level, []);
      levels.get(level).push(questById.get(id));
    });
    return [...levels.values()];
  }

  function questRelationButtons(ids, currentId) {
    return ids.map((id) => `<button class="quest-chain__node${Number(id) === Number(currentId) ? " is-current" : ""}" type="button" data-chip-view="quest" data-chip-mode="all" data-chip-query="${id}"><span>${escapeHtml(questName(id))}</span><small>QUEST ${id}</small></button>`).join("");
  }

  function questChainHtml(quest) {
    const levels = questChainLevels(quest.id);
    const total = levels.reduce((count, entries) => count + entries.length, 0);
    const chain = levels.map((entries, index) => `<div class="quest-chain__stage"><span class="quest-chain__stage-label">${levels.length === 1 ? "獨立任務" : index === 0 ? "起點" : index === levels.length - 1 ? "終點" : `第 ${index + 1} 階段`}</span><div class="quest-chain__nodes">${questRelationButtons(entries.map((entry) => entry.id), quest.id)}</div></div>${index < levels.length - 1 ? '<span class="quest-chain__arrow" aria-hidden="true">↓</span>' : ""}`).join("");
    return `<details class="quest-chain"><summary>查看完整任務鏈 <span>${total} 個任務</span></summary><div class="quest-chain__body">${chain}</div></details>`;
  }

  function immediateQuestRelationsHtml(quest) {
    const previous = [...(questPreviousIds.get(Number(quest.id)) || [])].sort((a, b) => a - b);
    const next = [...(questNextIds.get(Number(quest.id)) || [])].sort((a, b) => a - b);
    if (!previous.length && !next.length) return '<p class="quest-chain-status">本機資料沒有記錄此任務的前後任務。</p>';
    return `<div class="quest-relations">${previous.length ? `<div><span>前置任務</span><div>${previous.map((id) => questLink(id)).join("、")}</div></div>` : ""}${next.length ? `<div><span>下一個任務</span><div>${next.map((id) => questLink(id)).join("、")}</div></div>` : ""}</div>`;
  }

  function conditionHtml(condition, includeTargets = true) {
    const pieces = [];
    if (condition.lvmin) pieces.push(`等級至少 ${condition.lvmin}`);
    if (condition.lvmax) pieces.push(`等級不超過 ${condition.lvmax}`);
    if (condition.pop) pieces.push(`名聲至少 ${condition.pop}`);
    if (condition.jobs?.length && !(condition.jobs.length === 1 && condition.jobs[0] === 0)) pieces.push(`職業：${condition.jobs.map(jobLabel).join("、")}`);
    if (condition.quests?.length) pieces.push(`前置：${condition.quests.map((entry) => questLink(entry.id, `${questName(entry.id)}（狀態 ${entry.state}）`)).join("、")}`);
    const basics = pieces.length ? `<div class="flow-pills">${pieces.map((piece) => `<span>${piece}</span>`).join("")}</div>` : "";
    if (!includeTargets) return basics;
    const targets = [];
    if (condition.items?.length) targets.push(`<div class="target-row"><span class="target-row__label">物品</span><div class="chips">${condition.items.map((item) => itemChipHtml(item, item.count)).join("")}</div></div>`);
    if (condition.mobs?.length) targets.push(`<div class="target-row"><span class="target-row__label">怪物</span><div class="chips">${condition.mobs.map((mob) => `${navButton(mob.name, mob.id, "drop", "monster", "chip").replace("</button>", `<b>×${formatNumber(mob.count)}</b></button>`)}`).join("")}</div></div>`);
    return basics + targets.join("");
  }

  function actionHtml(action) {
    const lines = [];
    if (action.exp) lines.push(`<span class="reward-badge">經驗值 +${formatNumber(action.exp)}</span>`);
    if (action.money) lines.push(`<span class="reward-badge">楓幣 ${action.money > 0 ? "+" : ""}${formatNumber(action.money)}</span>`);
    if (action.pop) lines.push(`<span class="reward-badge">名聲 ${action.pop > 0 ? "+" : ""}${formatNumber(action.pop)}</span>`);
    const positiveItems = (action.items || []).filter((item) => item.count > 0);
    const negativeItems = (action.items || []).filter((item) => item.count < 0);
    let html = lines.length ? `<div class="reward-row">${lines.join("")}</div>` : "";
    if (positiveItems.length) html += `<div class="target-row"><span class="target-row__label">取得</span><div class="chips">${positiveItems.map((item) => itemChipHtml(item, item.count)).join("")}</div></div>`;
    if (negativeItems.length) html += `<div class="target-row"><span class="target-row__label">繳交</span><div class="chips">${negativeItems.map((item) => itemChipHtml(item, item.count)).join("")}</div></div>`;
    if (action.skills?.length) html += `<p class="flow-note">技能：${action.skills.map((skill) => `${escapeHtml(skill.name)}${skill.level ? ` Lv.${skill.level}` : ""}`).join("、")}</p>`;
    if (action.nextQuest) html += `<p class="flow-note">後續任務：${questLink(action.nextQuest)}</p>`;
    return html || '<span class="missing">沒有額外資料</span>';
  }

  function npcLabel(npc) { return npc ? `<strong>${escapeHtml(npc.name)}</strong><small>NPC ${npc.id}</small>` : '<span class="missing">由系統或腳本觸發</span>'; }

  function questCardHtml(quest) {
    const startActions = actionHtml(quest.startActions);
    const hasStartAction = Object.keys(quest.startActions || {}).length > 0;
    const objective = quest.objective || quest.summary || "本機文字沒有額外目標說明。";
    return `<article class="monster-card quest-card"><div class="monster-card__top"><div><span class="category-label">${escapeHtml(quest.parent || "一般任務")}</span><h3>${escapeHtml(quest.name)}</h3><span class="monster-id">QUEST ${quest.id}</span></div></div>${immediateQuestRelationsHtml(quest)}<div class="quest-flow"><section class="flow-step"><span class="flow-step__number">1</span><div><p class="flow-step__title">接取任務</p><div class="npc-label">${npcLabel(quest.startNpc)}</div>${conditionHtml(quest.startConditions, false)}${hasStartAction ? `<div class="flow-subsection"><span>接取時變動</span>${startActions}</div>` : ""}</div></section><section class="flow-step"><span class="flow-step__number">2</span><div><p class="flow-step__title">完成目標</p><p class="flow-copy">${multiline(objective)}</p>${conditionHtml(quest.finishConditions, true)}</div></section><section class="flow-step"><span class="flow-step__number">3</span><div><p class="flow-step__title">回報任務</p><div class="npc-label">${npcLabel(quest.finishNpc)}</div></div></section><section class="flow-step flow-step--reward"><span class="flow-step__number">4</span><div><p class="flow-step__title">獎勵與變動</p>${actionHtml(quest.rewards)}</div></section></div>${questChainHtml(quest)}${quest.completion ? `<details class="card-details"><summary>查看完成後紀錄</summary><div class="card-details__body flow-copy">${multiline(quest.completion)}</div></details>` : ""}</article>`;
  }

  function skillStepHtml(step, index) {
    const ids = step.skillId ? [step.skillId] : (step.skillIds || []);
    const skills = ids.map((id) => skillData.skills[String(id)]).filter(Boolean);
    const label = step.label || skills.map((skill) => skill.name).join("／") || "未知技能";
    const description = skills.length === 1 ? skills[0].description : "依你選定的武器種類，只投資其中一項。";
    const target = step.add ? `+${step.add} → Lv.${step.target}` : `Lv.${step.target}`;
    return `<li class="skill-step"><span class="skill-step__number">${index + 1}</span><div><div class="skill-step__heading"><strong>${escapeHtml(label)}</strong><b>${escapeHtml(target)}</b></div><p>${escapeHtml(step.note || description)}</p></div></li>`;
  }

  function skillCardHtml(guide) {
    const sourceLinks = guide.sources.map((sourceEntry) => `<a href="${escapeHtml(sourceEntry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceEntry.title)}</a>`).join(" · ");
    return `<article class="monster-card skill-card"><div class="monster-card__top"><div><span class="category-label">${escapeHtml(guide.family)}・${escapeHtml(guide.stage)}</span><h3>${escapeHtml(guide.job)}</h3><span class="monster-id">${escapeHtml(guide.levels)}</span></div></div><p class="skill-summary">${escapeHtml(guide.summary)}</p><div class="ap-note"><strong>能力值方向</strong><span>${escapeHtml(guide.ap)}</span></div><ol class="skill-steps">${guide.priority.map(skillStepHtml).join("")}</ol>${guide.notes?.length ? `<div class="guide-notes">${guide.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}</div>` : ""}<p class="guide-sources">參考：${sourceLinks}</p></article>`;
  }

  function score(entry, query, nameField = "name") {
    if (!query) return 0;
    const name = normalize(entry[nameField] || entry.job);
    const id = String(entry.id);
    if (id === query || name === query) return 100;
    if (id.startsWith(query) || name.startsWith(query)) return 70;
    if (entry._all?.includes(query)) return 30;
    return 0;
  }

  function filterDrop(terms, query) {
    const field = { all: "_all", monster: "_monster", item: "_items", map: "_maps", quest: "_quests" }[mode] || "_all";
    return dropData.monsters.filter((entry) => terms.every((term) => entry[field].includes(term))).sort((a, b) => score(b, query) - score(a, query) || a.id - b.id);
  }

  function filterItems(terms, query) {
    return itemData.items.filter((item) => (mode === "all" || itemGroup(item) === mode) && terms.every((term) => item._all.includes(term))).sort((a, b) => score(b, query) - score(a, query) || Number(b.available) - Number(a.available) || a.id - b.id);
  }

  function equipmentGroup(item) {
    if (item.categoryKey === "Weapon") return "weapon";
    if (armorCategories.has(item.categoryKey)) return "armor";
    if (accessoryCategories.has(item.categoryKey)) return "accessory";
    return "other";
  }

  function filterEquipment(terms, query) {
    return equipmentData.equipment.filter((item) => (mode === "all" || equipmentGroup(item) === mode) && terms.every((term) => item._all.includes(term))).sort((a, b) => score(b, query) - score(a, query) || (a.requirements.reqLevel || 0) - (b.requirements.reqLevel || 0) || a.id - b.id);
  }

  function filterQuests(terms, query) {
    const field = { all: "_all", name: "_name", npc: "_npc", item: "_item", mob: "_mob" }[mode] || "_all";
    return questData.quests.filter((entry) => terms.every((term) => entry[field].includes(term))).sort((a, b) => score(b, query) - score(a, query) || a.id - b.id);
  }

  function filterSkills(terms, query) {
    return skillData.guides.filter((guide) => (mode === "all" || guide.family === mode) && terms.every((term) => guide._all.includes(term))).sort((a, b) => score(b, query, "job") - score(a, query, "job") || a.family.localeCompare(b.family, "zh-Hant") || a.stage.localeCompare(b.stage, "zh-Hant"));
  }

  function renderModes() {
    modeSwitch.innerHTML = viewConfig[view].modes.map(([value, label]) => `<button class="mode-switch__button${value === mode ? " is-active" : ""}" type="button" data-mode="${value}">${label}</button>`).join("");
  }

  function syncAddress(push = false) {
    if (!window.location || !window.history?.replaceState) return;
    const query = searchInput.value.trim();
    const hash = `#${view}${query ? `/${encodeURIComponent(query)}` : ""}`;
    if (window.location.hash === hash) return;
    const method = push ? "pushState" : "replaceState";
    window.history[method](null, "", hash);
  }

  function readAddress() {
    if (!window.location?.hash) return null;
    const match = window.location.hash.match(/^#(drop|item|equipment|quest|skill)(?:\/(.*))?$/);
    if (!match) return null;
    return { view: match[1], query: match[2] ? decodeURIComponent(match[2]) : "" };
  }

  function render() {
    const query = normalize(searchInput.value);
    const terms = query.split(" ").filter(Boolean);
    const filters = { drop: filterDrop, item: filterItems, equipment: filterEquipment, quest: filterQuests, skill: filterSkills };
    const renderers = { drop: dropCardHtml, item: itemCardHtml, equipment: equipmentCardHtml, quest: questCardHtml, skill: skillCardHtml };
    const typeLabels = { drop: "隻怪物", item: "筆道具", equipment: "件裝備", quest: "筆任務", skill: "份配點" };
    const titlePrefixes = { drop: "怪物資料", item: "道具圖鑑", equipment: "裝備能力", quest: "任務流程", skill: "技能配點" };
    filtered = filters[view](terms, query);
    const config = viewConfig[view];
    resultTitle.textContent = query ? `「${searchInput.value.trim()}」的${titlePrefixes[view]}` : config.title;
    resultSummary.textContent = `找到 ${formatNumber(filtered.length)} ${typeLabels[view]}`;
    emptyState.hidden = filtered.length !== 0;
    results.hidden = filtered.length === 0;
    results.className = `result-grid result-grid--${view}`;
    results.innerHTML = filtered.slice(0, visibleCount).map(renderers[view]).join("");
    loadMore.hidden = visibleCount >= filtered.length;
    if (!loadMore.hidden) loadMore.textContent = `載入更多（還有 ${formatNumber(filtered.length - visibleCount)} 筆）`;
  }

  function setMode(nextMode) { mode = nextMode; visibleCount = pageSize; renderModes(); render(); syncAddress(false); }

  function updateViewChrome() {
    const config = viewConfig[view];
    searchInput.placeholder = config.placeholder;
    sectionKicker.textContent = config.kicker;
    sourceCopy.innerHTML = config.source;
    viewButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  }

  function setView(nextView, preserveSearch = false, updateAddress = true) {
    view = nextView;
    mode = "all";
    visibleCount = pageSize;
    if (!preserveSearch) searchInput.value = "";
    updateViewChrome();
    renderModes();
    render();
    if (updateAddress) syncAddress(true);
  }

  let debounceTimer;
  searchInput.addEventListener("input", () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => { visibleCount = pageSize; render(); syncAddress(false); }, 70);
  });
  viewButtons.forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  modeSwitch.addEventListener("click", (event) => { const button = event.target.closest("[data-mode]"); if (button) setMode(button.dataset.mode); });
  loadMore.addEventListener("click", () => { visibleCount += pageSize; render(); });
  clearSearch.addEventListener("click", () => { searchInput.value = ""; setMode("all"); searchInput.focus(); });

  results.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-chip-query]");
    if (!chip) return;
    view = chip.dataset.chipView || view;
    searchInput.value = chip.dataset.chipQuery;
    mode = chip.dataset.chipMode || "all";
    visibleCount = pageSize;
    updateViewChrome();
    renderModes();
    render();
    syncAddress(true);
    $(".search-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchInput.focus(); searchInput.select(); }
    if (event.key === "Escape" && document.activeElement === searchInput) { searchInput.value = ""; visibleCount = pageSize; render(); }
  });

  if (window.addEventListener) window.addEventListener("popstate", () => {
    const state = readAddress();
    if (!state) return;
    view = state.view;
    searchInput.value = state.query;
    setView(view, true, false);
  });

  const initialState = readAddress();
  if (initialState) {
    view = initialState.view;
    searchInput.value = initialState.query;
    setView(view, true, false);
  } else {
    setView("drop", true, false);
  }
})();
