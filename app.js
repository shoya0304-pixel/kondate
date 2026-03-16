/* ════════════════════════════════════════════
   献立コンシェルジュ  app.js  v5
   ─ Gemini API で献立一覧・レシピ詳細を生成
   ─ APIキー未設定時はローカルデータで動作
   ════════════════════════════════════════════ */

const STORAGE_KEY = "kondateApp_v5";

/* ─── State ─── */
const state = {
  profile: {
    dislikes:"", allergies:"", genres:[],
    weekdayTime:"", weekendTime:"", pantry:"",
    goal:"", servings:"", fridgeMemo:""
  },
  profileLocked: false,
  filters: {
    maxTime:30, tags:[], mustUse:"",
    candidateCount:20, moods:[], conditions:[], flavors:[]
  },
  menu:[], selected:null, favorites:[],
  kpi:{ score:0, kcal:0, usage:0 },
  pfc:{ p:0, f:0, c:0, pGoal:0, fGoal:0, cGoal:0 },
  shopping:[], history:[],
  menuNotice:"", aiEnabled:false,
  hasLoadedMenus: false,
  theme: "light"
};

/* ─── ローカルフォールバック (削除済み) ─── */
const menuBase = [];

/* ─── Helpers ─── */
const $ = id => document.getElementById(id);

function showToast(message, duration = 2500) {
  let container = $("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span class="toast-icon">✨</span> ${message}`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

/* ─── APIキー確認 ─── */
function getApiKey() {
  // window経由で確実にグローバル変数を参照
  const key = window.GEMINI_API_KEY;
  if (key && typeof key === "string" && key.trim() !== "" && key !== "ここにAPIキーを入力") {
    return key.trim();
  }
  return null;
}

function getModel() {
  return (window.GEMINI_MODEL && typeof window.GEMINI_MODEL === "string")
    ? window.GEMINI_MODEL.trim()
    : "gemini-3.1-flash-lite-preview";
}

/* ════════════════════════════════
   Gemini API 呼び出し
   ════════════════════════════════ */

async function callGemini(prompt) {
  const key = getApiKey();
  if (!key) throw new Error("APIキー未設定");
  const model = getModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

/* JSONブロックを安全に抽出 - スマホ対応で堅牢化 */
function extractJson(text) {
  if (!text) return null;
  // 1. response_mime_typeでそのままJSONが来た場合
  try {
    const direct = JSON.parse(text.trim());
    if (direct) return direct;
  } catch(_) {}
  // 2. ```json ... ``` ブロック
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch(_) {}
  }
  // 3. ``` ... ``` ブロック（jsonなし）
  const fenceMatch2 = text.match(/```\s*([\s\S]*?)```/);
  if (fenceMatch2) {
    try { return JSON.parse(fenceMatch2[1].trim()); } catch(_) {}
  }
  // 4. [ ... ] を探す（最初の[から最後の]まで）
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    try { return JSON.parse(text.slice(arrStart, arrEnd + 1)); } catch(_) {}
  }
  // 5. { ... } を探す
  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    try { return JSON.parse(text.slice(objStart, objEnd + 1)); } catch(_) {}
  }
  return null;
}

/* ─── プロフィール情報をテキスト化 ─── */
function buildProfileText() {
  const p = state.profile;
  const f = state.filters;
  const lines = [];
  if (p.servings)    lines.push(`作る人数: ${p.servings}人前`);
  if (p.dislikes)    lines.push(`苦手食材（除外）: ${p.dislikes}`);
  if (p.allergies)   lines.push(`アレルギー（必ず除外）: ${p.allergies}`);
  if (p.genres.length) lines.push(`好きなジャンル: ${p.genres.join("・")}`);
  if (p.pantry)      lines.push(`常備食材・調味料: ${p.pantry}`);
  if (p.goal)        lines.push(`健康目標: ${p.goal}`);
  if (p.fridgeMemo)  lines.push(`冷蔵庫メモ（使い切りたい食材）: ${p.fridgeMemo}`);
  if (f.maxTime)     lines.push(`最大調理時間: ${f.maxTime}分以内`);
  if (f.tags.length) lines.push(`調理スタイル: ${f.tags.join("・")}`);
  if (f.moods.length)      lines.push(`今日の気分: ${f.moods.join("・")}`);
  if (f.conditions.length) lines.push(`体調: ${f.conditions.join("・")}`);
  if (f.flavors.length)    lines.push(`味の方向性: ${f.flavors.join("・")}`);
  if (f.mustUse)     lines.push(`必ず使いたい食材: ${f.mustUse}`);
  // 追加チップ群
  const mainIngs = getChipValues("mainIngChips");
  const scenes   = getChipValues("sceneChips");
  if (mainIngs.length) lines.push(`使いたいメイン食材: ${mainIngs.join("・")}`);
  if (scenes.length)   lines.push(`シーン・季節: ${scenes.join("・")}`);
  return lines.join("\n");
}

function getChipValues(groupId) {
  const vals = [];
  document.querySelectorAll(`#${groupId} .chip.active`).forEach(c => vals.push(c.textContent.trim()));
  return vals;
}

/* ════════════════════════════════
   【献立一覧】Geminiで20件生成
   ════════════════════════════════ */

async function generateMenuWithAI() {
  const profileText = buildProfileText();
  const today = new Date().toLocaleDateString("ja-JP", {month:"long", day:"numeric", weekday:"short"});

  const prompt = `あなたは熟練の栄養士兼シェフです。ユーザーの好みや条件に合わせて、最高に美味しい夕食献立を${count}件提案してください。
【ユーザー情報】
${profileText || "（なし）"}

【特別な制約（裏テーマ）】
${profileText.includes("朝ご飯") ? "- 朝の忙しさを考慮し、10分以内の爆速レシピや、火を使わない、洗い物が少ない構成を最優先してください。" : ""}
${profileText.includes("お昼ご飯") ? "- 片付けが楽なワンプレートや丼もの、麺類など、手軽さと満足感を両立させてください。" : ""}
${profileText.includes("晩ご飯") ? "- 一日の締めくくりとして、栄養バランスと満足感を重視した、丁寧な「主菜＋副菜」の構成にしてください。" : ""}
${profileText.includes("丼もの") ? "- 冷蔵庫にあるものでサッと作れる、究極の手軽さと「かき込める旨さ」を追求してください。" : ""}

【出力形式】
JSON形式（配列）で返してください。各項目は以下のプロパティを持つこと：
- name: 料理名
- time: 調理時間(分)
- kcal: 1人あたりのカロリー
- p: タンパク質(g)
- f: 脂質(g)
- c: 炭水化物(g)
- vit: 主要なビタミン（例：「ビタミンB1, C」）
- iron: 鉄分(mg)
- salt: 塩分(g)
- fiber: 食物繊維(g)
- point: 栄養・おすすめのポイント（シーン別の裏テーマやバランスの良さを魅力的に説明してください）
- tags: 特徴タグ（例：「爆速」「低糖質」など）
- items: 主要食材（{"name":"食材名","qty":数値,"unit":"単位"} の配列）
- servings: ${state.profile.servings || 2}

JSONのみを返してください。マークダウンの囲みはいりません。`;

  const raw = await callGemini(prompt);
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("レスポンスのパースに失敗");
  return parsed.map((r, i) => ({
    ...r,
    id: `ai-${Date.now()}-${i}`,
    steps: [], // 詳細はレシピページで生成
    servings: Number(state.profile.servings) || 2,
  }));
}

/* ════════════════════════════════
   【レシピ詳細】Geminiで手順補完
   ════════════════════════════════ */

async function generateRecipeDetail(recipe) {
  const servings = state.profile.servings || recipe.servings || 2;
  const pantry = state.profile.pantry ? `\n常備調味料: ${state.profile.pantry}` : "";
  const goal = state.profile.goal ? `\n健康目標: ${state.profile.goal}` : "";

  const itemList = recipe.items.map(it => {
    const qty = typeof it.qty === "number" && it.unit ? `${it.qty}${it.unit}` : (it.measure || "適量");
    return `${it.name} ${qty}`;
  }).join("、");

  const prompt = `
あなたは家庭料理の専門家です。以下の料理の詳しいレシピを教えてください。

【料理名】${recipe.name}
【人数】${servings}人前
【使用食材】${itemList}${pantry}${goal}

【出力形式】
以下のJSONのみ出力してください。

\`\`\`json
{
  "steps": [
    "手順1の詳しい説明（火加減・時間・コツを含む）",
    "手順2",
    "手順3",
    "手順4",
    "手順5（あれば）"
  ],
  "tips": "美味しく作るコツや家族ウケするアレンジを2〜3文で",
  "items": [
    {"name": "食材名", "qty": 数量, "unit": "単位"}
  ]
}
\`\`\`

【注意】
- 手順は具体的に（「中火で3分」「焦げ目がつくまで」など）
- ${servings}人前の分量で材料を書き直す
- 家庭で作りやすい現実的な内容にする
`;

  const raw = await callGemini(prompt);
  const parsed = extractJson(raw);
  if (!parsed || !Array.isArray(parsed.steps)) throw new Error("パース失敗");
  return parsed;
}


/* ════════════════════════════════
   【副菜・汁物提案】不足栄養を補う
   ════════════════════════════════ */
async function generateSideDishSuggestions(recipe) {
  const key = getApiKey();
  if (!key) return null;

  const p = recipe.p || 0, f = recipe.f || 0, c = recipe.c || 0;
  const goal = state.profile.goal || "";
  const dislikes = state.profile.dislikes || "";
  const servings = state.profile.servings || 2;

  // 不足している栄養素を判定
  const pGoal = 25, fGoal = 20, cGoal = 80;
  const lacking = [];
  if (p < pGoal * 0.7) lacking.push(`たんぱく質（あと${pGoal - p}g程度）`);
  if (f < fGoal * 0.5) lacking.push(`脂質（あと${fGoal - f}g程度）`);
  if (c < cGoal * 0.6) lacking.push(`炭水化物（あと${cGoal - c}g程度）`);
  const vegBalance = lacking.length === 0 ? "バランスは良好です" : `不足: ${lacking.join("・")}`;

  const prompt = `家庭料理の専門家として、メイン料理「${recipe.name}」に栄養的に完璧に合う副菜・汁物を提案してください。

【メインの栄養(1人分)】kcal:${p} / P:${f} / C:${c} (※実際はPFCg表記)
【不足栄養のヒント】${vegBalance}
【条件】
- メインで不足している**ビタミン、ミネラル、食物繊維**を補うものを優先。
- 人数: ${servings}人前
- 調理時間: 15分以内

以下のJSONのみ出力:
[
  {"name":"副菜名","type":"副菜","reason":"ビタミンCと食物繊維を補い、彩りを添えます","time":10,"servings":${servings}},
  ...
]`;

  const raw = await callGemini(prompt);
  return extractJson(raw);
}

/* レシピページの栄養＆副菜を描画 */
function renderNutritionOnRecipe(s) {
  const section = document.getElementById("nutritionSection");
  if (!section || !s) return;
  section.style.display = "block";

  // 数値表示
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? "--"; };
  set("recipeKcal", s.kcal || "--");
  set("recipeP", s.p || "--");
  set("recipeF", s.f || "--");
  set("recipeC", s.c || "--");
  set("recipeVit", s.vit || "---");
  set("recipeFiber", s.fiber || "0");
  set("recipeIron", s.iron || "0");
  set("recipeSalt", s.salt || "0");

  // PFCミニバー
  const pfcMini = document.getElementById("pfcMini");
  if (pfcMini) {
    const pGoal=25, fGoal=20, cGoal=80;
    const pct = (v,g) => Math.min(100, Math.round((v/g)*100));
    const over = (v,g) => v > g*1.3;
    pfcMini.innerHTML = [
      {label:"🥩 たんぱく質", val:s.p||0, goal:pGoal, cls:"bar-fill-p"},
      {label:"🧈 脂質",       val:s.f||0, goal:fGoal, cls:"bar-fill-f"},
      {label:"🍚 炭水化物",   val:s.c||0, goal:cGoal, cls:"bar-fill-c"},
    ].map(({label, val, goal, cls}) => {
      const p = pct(val, goal);
      const color = over(val, goal) ? "background:linear-gradient(90deg,#c0392b,#e74c3c)" : "";
      return `<div class="pfc-mini-row">
        <span class="pfc-mini-label">${label}</span>
        <div class="pfc-mini-bar-track"><div class="pfc-mini-bar-fill ${cls}" style="width:${p}%;${color}"></div></div>
        <span class="pfc-mini-nums">${val}g / 目標${goal}g</span>
      </div>`;
    }).join("");
  }

  // 副菜提案
  const suggestContent = document.getElementById("suggestContent");
  if (suggestContent) {
    const key = getApiKey();
    if (!key) {
      suggestContent.innerHTML = `<div style="font-size:13px;color:var(--ink-3);">💡 APIキーを設定すると副菜提案が表示されます</div>`;
      return;
    }
    suggestContent.innerHTML = `<div class="suggest-loading"><span class="spinner" style="width:14px;height:14px;"></span>AIが副菜を提案中…</div>`;
    generateSideDishSuggestions(s).then(suggestions => {
      if (!suggestions || !suggestions.length) {
        suggestContent.innerHTML = `<div style="font-size:13px;color:var(--ink-3);">提案を取得できませんでした</div>`;
        return;
      }
      suggestContent.innerHTML = `<div class="suggest-list">` +
        suggestions.map((item, idx) => `
          <div class="suggest-item">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div class="suggest-item-name">${item.type === "汁物" ? "🍲" : "🥗"} ${item.name} <span style="font-size:10px;color:var(--ink-3);">⏱${item.time}分</span></div>
              <button class="btn ghost btn-sm view-side-btn" data-name="${item.name}" data-idx="${idx}" style="padding:4px 8px;font-size:10px;">レシピを見る</button>
            </div>
            <div class="suggest-item-reason">${item.reason}</div>
          </div>`).join("") +
        `</div>`;
        
      // Bind view recipe buttons
      document.querySelectorAll(".view-side-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const name = e.target.getAttribute("data-name");
          openSideDishModal(name);
        });
      });
    }).catch(() => {
      suggestContent.innerHTML = `<div style="font-size:13px;color:var(--ink-3);">提案の生成に失敗しました</div>`;
    });
  }
}

/* 副菜のレシピ生成＆モーダル表示 */
async function openSideDishModal(name) {
  const modal = $("sideDishModal");
  const title = $("sideDishTitle");
  const body = $("sideDishBody");
  if(!modal || !title || !body) return;
  
  title.textContent = name;
  body.innerHTML = `<div class="loading" style="padding:40px 0;"><span class="spinner"></span> AIがレシピを生成中…</div>`;
  modal.classList.add("active");
  
  // Close handler
  $("closeSideDishModal").onclick = () => modal.classList.remove("active");
  modal.onclick = (e) => { if(e.target === modal) modal.classList.remove("active"); };
  
  try {
    const servings = parseInt($("servingsSelect")?.value) || state.profile.servings || 2;
    const prompt = `家庭料理の専門家として、以下の料理の詳しいレシピを教えてください。\n料理名: ${name}\n人数: ${servings}人前\n形式: JSONのみ出力\n\`\`\`json\n{"steps":["手順1","手順2"],"items":[{"name":"食材1","qty":100,"unit":"g"}]}\n\`\`\``;
    
    const raw = await callGemini(prompt);
    const parsed = extractJson(raw);
    
    if(!parsed || !parsed.steps) throw new Error("パース失敗");
    
    // Render the generated side dish
    let html = `<div class="ingredients-grid" style="margin-bottom:16px;">`;
    (parsed.items||[]).forEach(it => {
      let q = it.qty && it.unit ? `${it.qty}${it.unit}` : it.measure || "適量";
      html += `<div class="ingredient-item"><div class="ingredient-name">${it.name}</div><div class="ingredient-qty">${q}</div></div>`;
    });
    html += `</div><div class="steps-numbered">`;
    (parsed.steps||[]).forEach((step, i) => {
      html += `<div class="step-item"><div class="step-badge">${i+1}</div><div class="step-content">${step}</div></div>`;
    });
    html += `</div>`;
    body.innerHTML = html;
    
  } catch (err) {
    body.innerHTML = `<div style="color:var(--danger);padding:20px 0;text-align:center;">レシピの生成に失敗しました。<br>${err.message}</div>`;
  }
}
/* ════════════════════════════════
   State 管理
   ════════════════════════════════ */

function loadState() {
  try { const s = localStorage.getItem(STORAGE_KEY); if (s) Object.assign(state, JSON.parse(s)); } catch(_) {}
}
function normalizeState() {
  const pd = {dislikes:"",allergies:"",genres:[],weekdayTime:"",weekendTime:"",pantry:"",goal:"",servings:"",fridgeMemo:""};
  const fd = {maxTime:30,tags:[],mustUse:"",candidateCount:20,moods:[],conditions:[],flavors:[]};
  state.profile = {...pd, ...state.profile};
  state.filters = {...fd, ...state.filters};
  ["genres","tags","moods","conditions","flavors","menu","favorites","shopping","history"].forEach(k => {
    if (!Array.isArray(state[k])) state[k] = [];
  });
  if (typeof state.profileLocked !== "boolean") state.profileLocked = false;
  state.menuNotice = state.menuNotice || "";
  state.filters.candidateCount = 20;

  // ユーザー要件：デフォルトのテストデータ（サバの味噌煮等を含む旧データ）が表示されるのを防ぐため、ローカルで復元したメニューに旧IDがあれば消す
  if (state.menu && state.menu.length > 0) {
    if (state.menu.some(m => ["salmon", "chicken", "tofu", "beef", "mackerel"].includes(m.id))) {
      state.menu = [];
      state.selected = null;
    }
  }
}
function saveState() {
  try {
    // menuはAIレシピを含むため大きい場合がある。itemsとstepsを含めて保存
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch(e) {
    // localStorageが満杯の場合はmenuを除いて保存
    try {
      const slim = {...state, menu: state.menu.map(m=>({id:m.id,name:m.name,time:m.time,tags:m.tags,moods:m.moods,conditions:m.conditions,flavors:m.flavors,p:m.p,f:m.f,c:m.c,kcal:m.kcal,items:m.items,steps:m.steps,servings:m.servings,point:m.point,tips:m.tips}))};
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch(_) {}
  }
}

function toggleChip(el, list) {
  const val = el.textContent.trim();
  const isActive = list.includes(val);
  if (isActive) {
    // 解除
    el.classList.remove("active");
    const i = list.indexOf(val);
    if (i >= 0) list.splice(i, 1);
  } else {
    // 選択
    el.classList.add("active");
    list.push(val);
  }
}

/* ════════════════════════════════
   Profile
   ════════════════════════════════ */

function readProfileInputs() {
  if (!$("dislikes")) return;
  state.profile.dislikes    = $("dislikes").value.trim();
  state.profile.allergies   = $("allergies").value.trim();
  state.profile.weekdayTime = $("weekdayTime").value.trim();
  state.profile.weekendTime = $("weekendTime").value.trim();
  state.profile.pantry      = $("pantry").value.trim();
  state.profile.goal        = $("goal").value.trim();
  state.profile.servings    = $("servings").value.trim();
  state.profile.fridgeMemo  = $("fridgeMemo").value.trim();
}

function applyProfileInputs() {
  if (!$("dislikes")) return;
  $("dislikes").value    = state.profile.dislikes;
  $("allergies").value   = state.profile.allergies;
  $("weekdayTime").value = state.profile.weekdayTime;
  $("weekendTime").value = state.profile.weekendTime;
  $("pantry").value      = state.profile.pantry;
  $("goal").value        = state.profile.goal;
  $("servings").value    = state.profile.servings;
  $("fridgeMemo").value  = state.profile.fridgeMemo;
  document.querySelectorAll("#genreChips .chip").forEach(c =>
    c.classList.toggle("active", state.profile.genres.includes(c.textContent.trim())));
  const locked = state.profileLocked;
  ["dislikes","allergies","weekdayTime","weekendTime","pantry","goal","servings","fridgeMemo"].forEach(id => {
    if ($(id)) $(id).disabled = locked;
  });
  document.querySelectorAll("#genreChips .chip").forEach(c => {
    c.style.pointerEvents = locked ? "none" : "auto";
    c.style.opacity = locked ? "0.5" : "1";
  });
  const ps = $("profileStatus");
  if (ps) { ps.textContent = locked ? "✅ 保存済み" : "未保存"; ps.className = locked ? "badge badge-saved" : "badge badge-default"; }
}

function setProfileLocked(l) { state.profileLocked = l; applyProfileInputs(); saveState(); }

function bindProfileEvents() {
  if (!$("saveProfile")) return;
  $("saveProfile").addEventListener("click", () => {
    readProfileInputs(); setProfileLocked(true);
    showToast("プロフィールを保存しました");
    generateMenu().then(() => { saveState(); location.href = "menu.html"; });
  });
  $("editProfile").addEventListener("click", () => setProfileLocked(false));
  $("clearProfile").addEventListener("click", () => {
    state.profile = {dislikes:"",allergies:"",genres:[],weekdayTime:"",weekendTime:"",pantry:"",goal:"",servings:"",fridgeMemo:""};
    setProfileLocked(false); applyProfileInputs(); saveState();
  });
  document.querySelectorAll("#genreChips .chip").forEach(c =>
    c.addEventListener("click", () => { if (state.profileLocked) return; toggleChip(c, state.profile.genres); saveState(); }));

  const themeToggle = $("themeToggle");
  if (themeToggle) {
    if (state.theme === "dark") {
      themeToggle.classList.add("on");
      document.body.classList.add("dark-theme");
    }
    
    themeToggle.addEventListener("click", () => {
      const isDark = themeToggle.classList.toggle("on");
      if (isDark) {
        document.body.classList.add("dark-theme");
        state.theme = "dark";
      } else {
        document.body.classList.remove("dark-theme");
        state.theme = "light";
      }
      saveState();
    });
  }
}

/* ════════════════════════════════
   Filters
   ════════════════════════════════ */

function readMenuFilters() {
  if (!$("maxTime")) return;
  state.filters.maxTime = Number($("maxTime").value);
  state.filters.mustUse = $("mustUse") ? $("mustUse").value.trim() : "";
}

function applyMenuFilters() {
  if (!$("maxTime")) return;
  $("maxTime").value = state.filters.maxTime;
  $("mustUse").value = state.filters.mustUse;
  [["filterChips", state.filters.tags], ["moodChips", state.filters.moods],
   ["conditionChips", state.filters.conditions], ["flavorChips", state.filters.flavors]].forEach(([id, list]) =>
    document.querySelectorAll(`#${id} .chip`).forEach(c => c.classList.toggle("active", list.includes(c.textContent.trim()))));
}

/* ════════════════════════════════
   献立生成（AI or ローカル）
   ════════════════════════════════ */

async function generateMenu() {
  readMenuFilters();
  const key = getApiKey();

  if (key) {
    /* ── AI生成 ── */
    try {
      const aiMenu = await generateMenuWithAI();
      state.menu = aiMenu;
      state.menuNotice = `✨ Gemini AIが${aiMenu.length}件提案`;
      state.aiEnabled = true;
      computeNutrition();
      state.selected = null;
      saveState();
      return;
    } catch(e) {
      state.menuNotice = `⚠️ AI生成失敗（${e.message}）→ ローカルデータで表示`;
      console.error("Gemini error:", e);
    }
  } else {
    state.menuNotice = "⚠️ config.js にAPIキーを設定するとAI提案が使えます";
  }

  /* ── 失敗時・未設定時のフォールバック ── */
  state.aiEnabled = false;
  state.menu = []; // テストデータは表示しない
  state.selected = null;
  state.hasLoadedMenus = true;
  computeNutrition();
  saveState();
}

async function generatePersonalizedMenu() {
  const key = getApiKey();
  if (!key) {
    alert("APIキーが設定されていないため、履歴からのパーソナライズ提案は使用できません。ローカル検索に切り替えます。");
    return generateMenu();
  }

  // Build a specialized prompt using history, favorites, and profile
  const p = state.profile;
  const recentHistory = state.history.slice(0, 5).map(h => h.name).join(", ");
  const favNames = state.favorites.map(id => {
    // try to resolve name
    const all = [...menuBase, ...state.menu];
    const found = all.find(x => x.id === id);
    return found ? found.name : "";
  }).filter(Boolean).slice(0, 3).join(", ");
  
  const dis = p.dislikes ? `絶対に使わない食材: ${p.dislikes}` : "";
  const alg = p.allergies ? `アレルギー（除外必須）: ${p.allergies}` : "";
  const fav = favNames ? `ユーザーのお気に入り料理: ${favNames}` : "";
  const hist = recentHistory ? `最近食べた料理（これらは避ける）: ${recentHistory}` : "";
  const gen = p.genres.length ? `好きなジャンル: ${p.genres.join(", ")}` : "";

  const prompt = `あなたはプロの献立コンシェルジュです。ユーザーの「好み」と「履歴」を分析し、**今日食べるべき最高のおすすめ献立を3〜4件**提案してください。
【ユーザーのプロフィール情報】
${dis}
${alg}
${fav}
${hist}
${gen}
人数: ${p.servings || 2}人前
健康目標: ${p.goal || "特になし"}
冷蔵庫メモ: ${p.fridgeMemo || "なし"}

【出力形式】
JSON形式（配列）で返してください。各項目は以下のプロパティを持つこと：
- name: 料理名
- time: 調理時間(分)
- kcal, p, f, c, vit, iron, salt, fiber
- point: パーソナライズされたおすすめ理由
- tags, items, servings

JSONのみを返してください。`;

  try {
    const raw = await callGemini(prompt);
    const parsed = extractJson(raw);
    if (!Array.isArray(parsed)) throw new Error("JSON is not array");

    // Convert parsed data into the standard menu item format
    state.menu = parsed.map(it => ({
      id: `ai_${Date.now()}_${Math.floor(Math.random()*1000)}`,
      name: it.name || "名称不明",
      time: it.time || 30,
      kcal: Math.floor(it.kcal || (300 + Math.random()*400)),
      p: it.p || 15, f: it.f || 15, c: it.c || 40,
      vit: it.vit || "---", iron: it.iron || 0, salt: it.salt || 0, fiber: it.fiber || 0,
      tags: it.tags || [],
      moods: [], conditions: [], flavors: [],
      items: (it.mustUse || []).map(n => ({name: n, qty: null, unit: ""})),
      steps: [],
      point: it.point || "あなたへのおすすめです",
      servings: parseInt(p.servings) || 2
    }));

    state.menuNotice = `💡 履歴と好みから ${state.menu.length}件の特別なおすすめを提案しました`;
    state.aiEnabled = true;
    state.hasLoadedMenus = true;
    computeNutrition();
    state.selected = null;
    saveState();
  } catch (err) {
    console.error("Personalized generation error:", err);
    throw err; // rethrow to handle in UI
  }
}

function computeNutrition() {
  if (!state.menu.length) return;
  const n = state.menu.length;
  // 選択中のレシピがあればそれを基準、なければ候補の平均
  const base = state.selected
    ? state.selected
    : state.menu.reduce((a,it)=>({p:a.p+(it.p||0),f:a.f+(it.f||0),c:a.c+(it.c||0),kcal:a.kcal+(it.kcal||0)}),{p:0,f:0,c:0,kcal:0});
  const p    = state.selected ? (base.p||0)    : Math.round((base.p||0)/n);
  const f    = state.selected ? (base.f||0)    : Math.round((base.f||0)/n);
  const c    = state.selected ? (base.c||0)    : Math.round((base.c||0)/n);
  const kcal = state.selected ? (base.kcal||0) : Math.round((base.kcal||0)/n);

  // 目標値: 1食分 (1日3食想定)
  const isHighProtein = state.profile.goal && state.profile.goal.includes("たんぱく");
  const isDiet        = state.profile.goal && (state.profile.goal.includes("ダイエット") || state.profile.goal.includes("体脂肪"));
  const pGoal  = isHighProtein ? 40 : 25;
  const fGoal  = isDiet ? 12 : 20;
  const cGoal  = isDiet ? 50 : 80;
  const kcalGoal = isDiet ? 500 : 650;

  state.pfc = { p, f, c, pGoal, fGoal, cGoal, kcalGoal };

  // スコア: たんぱく質達成度 × 0.4 + カロリー適正度 × 0.3 + 脂質適正度 × 0.3
  const pScore    = Math.min(100, Math.round((p / pGoal) * 100));
  const kcalScore = Math.max(0, 100 - Math.abs(kcal - kcalGoal) / kcalGoal * 100);
  const fScore    = Math.max(0, 100 - Math.abs(f - fGoal) / fGoal * 60);
  state.kpi.score = Math.min(100, Math.round(pScore * 0.4 + kcalScore * 0.3 + fScore * 0.3));
  state.kpi.kcal  = kcal;
  state.kpi.usage = Math.min(100, Math.round((p / pGoal) * 100));
}

function servingsMultiplier() { const s=Number(state.profile.servings||0); return s?Math.max(1,s/2):1; }

/* ════════════════════════════════
   Render: AI状態バッジ
   ════════════════════════════════ */

function renderAiStatus() {
  const el = $("dataStatus"); if (!el) return;
  const key = getApiKey();
  if (key) {
    el.className = "badge green";
    el.textContent = "🤖 AI有効";
  } else {
    el.className = "badge";
    el.textContent = "📦 ローカル";
  }
}

/* ════════════════════════════════
   Render: 献立一覧
   ════════════════════════════════ */

function renderMenuList() {
  const list = $("menuList"); if (!list) return;
  list.innerHTML = "";

  const noticeArea = $("menuNoticeArea");
  if (noticeArea) {
    if (state.menuNotice) {
      const isAi = state.menuNotice.includes("Gemini");
      noticeArea.innerHTML = `<div class="notice" style="background:${isAi?"var(--accent-2-dim)":"rgba(239,68,68,0.08)"};border-color:${isAi?"rgba(45,212,191,0.3)":"rgba(239,68,68,0.2)"};color:${isAi?"var(--accent-2)":"#fca5a5"};">${state.menuNotice}</div>`;
    } else { noticeArea.innerHTML = ""; }
  }

  if (state.menu.length === 0 && !state.hasLoadedMenus) {
    // Hide test data initially
    list.innerHTML = `
      <li>
        <div class="empty-prompt">
          <div class="empty-prompt-icon">🍽️</div>
          <div class="empty-prompt-title">お好みの献立を見つけましょう</div>
          <div class="empty-prompt-sub" style="font-size:12px;">上の「条件を指定して提案」ボタンか、<br>「履歴と好みからおすすめ」をタップしてください。</div>
        </div>
      </li>
    `;
    return;
  }

  if (!state.menu.length) {
    list.innerHTML = `<li><div class="empty-state"><div class="empty-icon">🍽</div><div class="empty-text">該当する献立が見つかりません。条件を変えてみてください。</div></div></li>`;
    return;
  }

  state.menu.forEach(item => {
    const li = document.createElement("li"); li.className = "menu-card";
    const fav = state.favorites.includes(item.id);
    const tags = (item.tags||[]).map(t=>`<span style="padding:2px 8px;border-radius:999px;background:var(--accent-dim);color:var(--accent);font-size:10px;font-weight:700;">${t}</span>`).join(" ");
    const ingPreview = (item.items||[]).slice(0,4).map(i=>i.name).join("・");
    li.innerHTML = `
      <div class="menu-card-main">
        <div class="menu-card-name">${item.name}</div>
        ${item.point ? `<div class="menu-card-point">💡 ${item.point}</div>` : ""}
        <div class="menu-card-stats">
          <span>⏱ <strong>${item.time}</strong>分</span>
          <span>🔥 <strong>${item.kcal||"--"}</strong>kcal</span>
          <span>💪 P<strong>${item.p||"--"}</strong>g</span>
          ${tags ? `<span>${tags}</span>` : ""}
        </div>
        ${ingPreview ? `<div class="menu-card-ingredients">🛒 ${ingPreview}${(item.items||[]).length>4?"…":""}</div>` : ""}
      </div>
      <div class="menu-card-actions">
        <button class="btn" type="button">📋 レシピを見る</button>
        <button class="btn secondary" type="button" style="flex:0 0 44px;padding:10px 0;font-size:17px;">${fav?"⭐":"☆"}</button>
      </div>`;
    const [db, fb] = li.querySelectorAll("button");
    db.addEventListener("click", () => {
      state.selected = item;
      computeNutrition();  // 選択したレシピの栄養を更新
      saveState();
      location.href = "recipe.html";
    });
    fb.addEventListener("click", () => {
      if (state.favorites.includes(item.id)) state.favorites = state.favorites.filter(id=>id!==item.id);
      else state.favorites.push(item.id);
      saveState(); renderMenuList();
    });
    list.appendChild(li);
  });

  // 件数バッジ
  const countBadge = $("menuCountBadge");
  if (countBadge) countBadge.textContent = `${state.menu.length}件`;
}

/* ════════════════════════════════
   Render: PFC
   ════════════════════════════════ */

function renderNutrition() {
  if (!$("pLine")) return;
  const pfc = state.pfc;
  if (!pfc.p && !pfc.f && !pfc.c) return;
  const pct  = (v,g) => Math.min(100, Math.round((v / Math.max(1,g)) * 100));
  const over = (v,g) => v > g * 1.3;  // 目標の130%超えで赤

  // たんぱく質
  const pp = pct(pfc.p, pfc.pGoal);
  $("pLine").textContent = `目標 ${pfc.pGoal}g 中 ${pfc.p}g（${pp}%）`;
  $("pBar").style.width = `${pp}%`;
  $("pBar").style.background = over(pfc.p, pfc.pGoal) ? "linear-gradient(90deg,#c0392b,#e74c3c)" : "";

  // 脂質
  const fp = pct(pfc.f, pfc.fGoal);
  $("fLine").textContent = `目標 ${pfc.fGoal}g 中 ${pfc.f}g（${fp}%）`;
  $("fBar").style.width = `${fp}%`;
  $("fBar").style.background = over(pfc.f, pfc.fGoal) ? "linear-gradient(90deg,#c0392b,#e74c3c)" : "";

  // 炭水化物
  const cp = pct(pfc.c, pfc.cGoal);
  $("cLine").textContent = `目標 ${pfc.cGoal}g 中 ${pfc.c}g（${cp}%）`;
  $("cBar").style.width = `${cp}%`;
  $("cBar").style.background = over(pfc.c, pfc.cGoal) ? "linear-gradient(90deg,#c0392b,#e74c3c)" : "";

  // KPI更新
  if ($("kpiScore")) {
    const goal = pfc.kcalGoal || 650;
    $("kpiScore").textContent = state.kpi.score;
    $("kpiKcal").textContent  = `${pfc.kcal||0} kcal`;
    $("kpiUsage").textContent = `目標 ${goal} kcal`;
  }
}

/* ════════════════════════════════
   Render: レシピ詳細（AI補完）
   ════════════════════════════════ */

function renderSelectedRecipe() {
  if (!$("selectedTitle")) return;
  const cookBtn = $("cookToday");
  if (!state.selected) {
    $("selectedTitle").textContent = "献立ページからレシピを選んでください";
    if (cookBtn) cookBtn.disabled = true;
    return;
  }

  const s = state.selected;
  $("selectedTitle").textContent = s.name;
  if (cookBtn) cookBtn.disabled = false;

  // ── メタチップ（ヘッダー内・白ベース）──
  const mc = $("recipeMetaChips");
  if (mc) {
    // Determine the active servings to display in memory
    const selectedSv = parseInt($("servingsSelect")?.value) || state.profile.servings || s.servings || 2;
    mc.innerHTML = [
      `⏱ ${s.time}分`, `🔥 ${s.kcal||"--"}kcal`,
      ...(s.tags||[])
    ].map(t=>`<span class="recipe-chip">${t}</span>`).join("");
  }

  // ── レシピ本文 ──
  const detail = $("recipeDetail"); if (!detail) return;
  detail.innerHTML = "";

  /* 材料 */
  const ingTitle = document.createElement("div");
  ingTitle.style.cssText = "font-family:var(--font-serif);font-size:14px;font-weight:600;color:var(--ink-2);margin-bottom:9px;";
  ingTitle.textContent = "🛒 材料"; detail.appendChild(ingTitle);
  
  // Calculate multiplier based on selected servings versus base recipe servings (usually 2)
  const baseServings = s.servings || 2;
  const currentServings = parseInt($("servingsSelect")?.value) || state.profile.servings || baseServings;
  const mult = currentServings / baseServings;
  
  const grid = document.createElement("div"); grid.className = "ingredients-grid";
  (s.items||[]).forEach(it => {
    const d = document.createElement("div"); d.className = "ingredient-item";
    let qty = "";
    if (typeof it.qty==="number" && it.unit) qty = `${Math.round(it.qty*mult*10)/10}${it.unit}`;
    else if (it.measure) qty = it.measure;
    
    // Default fallback unit/measure logic if qty is missing but required
    if (!qty) qty = "適量";

    d.innerHTML = `<div class="ingredient-name">${it.name}</div><div class="ingredient-qty">${qty}</div>`;
    grid.appendChild(d);
  });
  detail.appendChild(grid);

  /* 手順エリア */
  const hasSteps = s.steps && s.steps.length > 0;
  const key = getApiKey();

  if (hasSteps) {
    // 手順あり → そのまま表示
    renderSteps(detail, s);
  } else if (key) {
    // 手順なし + APIキーあり → 種類問わず自動生成
    const loadingEl = document.createElement("div");
    loadingEl.className = "loading";
    loadingEl.innerHTML = `<span class="spinner"></span> AIが手順・材料を生成中…`;
    detail.appendChild(loadingEl);
    generateRecipeDetail(s).then(detail_data => {
      s.steps = detail_data.steps || [];
      s.tips  = detail_data.tips  || "";
      if (detail_data.items && detail_data.items.length) s.items = detail_data.items;
      // stateのmenu・selectedも更新
      const idx = state.menu.findIndex(m => m.id === s.id);
      if (idx >= 0) state.menu[idx] = {...state.menu[idx], ...s};
      state.selected = s;
      saveState();
      renderSelectedRecipe();
    }).catch(e => {
      loadingEl.innerHTML = `
        <div style="text-align:center;width:100%;">
          <div style="color:var(--ink-3);margin-bottom:10px;">⚠️ 生成失敗: ${e.message}</div>
          <button class="btn btn-ghost btn-sm" onclick="this.closest('.loading').remove(); state.selected.steps=[]; renderSelectedRecipe();">🔄 再試行</button>
        </div>`;
    });
  } else {
    // APIキー未設定 + 手順なし → ローカル手順をそのまま表示するか案内
    const msg = document.createElement("div");
    msg.style.cssText = "margin-top:12px;padding:12px;background:var(--gold-bg);border:1px solid var(--gold);border-radius:10px;font-size:13px;color:#5a4010;";
    msg.textContent = "💡 config.js にAPIキーを設定すると詳しい手順が表示されます";
    detail.appendChild(msg);
  }

  // 栄養サマリー＆副菜提案を表示
  renderNutritionOnRecipe(s);

  updateFavButton();
}

/* 手順を描画するヘルパー */
function renderSteps(detail, s) {
  const stTitle = document.createElement("div");
  stTitle.style.cssText = "font-family:var(--font-serif);font-size:14px;font-weight:600;color:var(--ink-2);margin:14px 0 9px;";
  stTitle.textContent = "📝 手順"; detail.appendChild(stTitle);
  const sn = document.createElement("div"); sn.className = "steps-numbered";
  s.steps.forEach((step, i) => {
    const row = document.createElement("div"); row.className = "step-item";
    row.innerHTML = `<div class="step-badge">${i+1}</div><div class="step-content">${step}</div>`;
    sn.appendChild(row);
  });
  detail.appendChild(sn);
  if (s.tips) {
    const tips = document.createElement("div");
    tips.style.cssText = "margin-top:14px;padding:12px;background:var(--accent-dim);border:1px solid rgba(184,74,32,0.2);border-radius:10px;font-size:13px;color:var(--ink-2);line-height:1.7;";
    tips.innerHTML = `<span style="color:var(--accent);font-weight:700;">💡 コツ</span><br>${s.tips}`;
    detail.appendChild(tips);
  }
}

/* ════════════════════════════════
   Shopping
   ════════════════════════════════ */

function buildShoppingFromSelected() {
  if (!state.selected) return;
  const cur = new Map(state.shopping.map(i=>[i.name,i]));
  
  // Compute multiplied quantities
  const baseServings = state.selected.servings || 2;
  const currentServings = parseInt($("servingsSelect")?.value) || state.profile.servings || baseServings;
  const mult = currentServings / baseServings;

  state.selected.items.forEach(it => {
    let qtyStr = "";
    if (typeof it.qty==="number" && it.unit) qtyStr = `${Math.round(it.qty*mult*10)/10}${it.unit}`;
    else if (it.measure) qtyStr = it.measure;
    
    const displayStr = qtyStr ? `${it.name}（${qtyStr}）` : it.name;

    if(!cur.has(it.name)) {
      cur.set(it.name, { name: displayStr, done: false, originalName: it.name });
    }
  });
  state.shopping = [...cur.values()];
}

function renderShopping() {
  const list = $("shoppingList"); if (!list) return;
  list.innerHTML = "";
  const cl = $("shoppingCountLabel");
  const undone = state.shopping.filter(i=>!i.done).length;
  if (cl) cl.textContent = `必要食材（残り ${undone} 件）`;
  if (!state.shopping.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🛒</div><div class="empty-text">リストが空です。<br>献立を決めると自動追加されます。</div></div>`;
    return;
  }
  state.shopping.forEach((item, index) => {
    const row = document.createElement("div"); row.className = `shopping-item${item.done?" done":""}`;
    row.draggable = true; row.dataset.index = index;
    row.innerHTML = `<span class="shopping-item-name">${item.name}</span><button class="toggle-btn" type="button">${item.done?"✓":""}</button>`;
    
    // Toggle check
    row.addEventListener("click", () => { item.done=!item.done; saveState(); renderShopping(); });
    
    // Drag & Drop events
    row.addEventListener("dragstart", e => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", index);
      row.style.opacity = "0.4";
    });
    row.addEventListener("dragend", e => {
      row.style.opacity = "1";
      Array.from(list.children).forEach(c => { c.style.borderTop = ""; c.style.borderBottom = ""; });
    });
    row.addEventListener("dragover", e => {
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      const bounding = row.getBoundingClientRect();
      const offset = bounding.y + (bounding.height / 2);
      row.style.borderTop = ""; row.style.borderBottom = "";
      if (e.clientY - offset > 0) row.style.borderBottom = "2px solid var(--accent)";
      else row.style.borderTop = "2px solid var(--accent)";
    });
    row.addEventListener("dragleave", e => { row.style.borderTop = ""; row.style.borderBottom = ""; });
    row.addEventListener("drop", e => {
      e.preventDefault();
      row.style.borderTop = ""; row.style.borderBottom = "";
      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
      let toIndex = index;
      
      const bounding = row.getBoundingClientRect();
      const offset = bounding.y + (bounding.height / 2);
      if (e.clientY - offset > 0) toIndex++; // Drop after this item
      
      if (fromIndex !== toIndex && !isNaN(fromIndex)) {
        if (fromIndex < toIndex) toIndex--; // Adjust toIndex if we remove an item before it
        const [movedItem] = state.shopping.splice(fromIndex, 1);
        state.shopping.splice(toIndex, 0, movedItem);
        saveState(); renderShopping();
      }
    });

    list.appendChild(row);
  });
}

/* ════════════════════════════════
   History
   ════════════════════════════════ */

function renderHistory() {
  const list = $("historyList"); if (!list) return;
  list.innerHTML = "";
  if (!state.history.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📖</div><div class="empty-text">まだ記録がありません。<br>献立を作ったら記録されます。</div></div>`;
    return;
  }
  state.history.slice(0,10).forEach(item => {
    const row = document.createElement("div"); row.className = "history-item";
    row.innerHTML = `<div><div class="history-name">${item.name}</div>${item.note?`<div class="history-note">💬 ${item.note}</div>`:""}</div><div class="history-date">${item.date}</div>`;
    list.appendChild(row);
  });
}

/* ════════════════════════════════
   Home
   ════════════════════════════════ */

function renderHome() {
  if (!$("statusPill")) return;
  $("statusPill").textContent = state.menu.length ? `今日の提案: ${state.menu[0].name}` : "今日の提案: 未設定";
  if ($("homeHistory")) $("homeHistory").textContent = state.history[0] ? `${state.history[0].name}（${state.history[0].date}）` : "記録なし";
  if ($("homeShoppingCount")) $("homeShoppingCount").textContent = state.shopping.filter(i=>!i.done).length;
  if ($("homeFavCountBadge")) $("homeFavCountBadge").textContent = state.favorites.length;
  
  // ── お気に入りリストの描画 ──
  const favList = $("homeFavoritesList");
  if (favList) {
    favList.innerHTML = "";
    if (state.favorites.length === 0) {
      favList.innerHTML = `<div class="empty-state" style="padding:16px;"><div class="empty-text">お気に入りのレシピはまだありません</div></div>`;
    } else {
      // Find the actual recipe data for the favorite IDs (might be in menuBase or currently loaded menu)
      const allRecipes = [...menuBase, ...state.menu];
      state.favorites.slice(0, 5).forEach(favId => {
        const recipe = allRecipes.find(r => r.id === favId) || { id: favId, name: "不明なレシピ", kcal: "--", time: "--" };
        const row = document.createElement("div"); row.className = "menu-item";
        row.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <div class="menu-item-name">${recipe.name}</div>
              <small>⏱ ${recipe.time}分 | 🔥 ${recipe.kcal}kcal</small>
            </div>
            <button class="btn btn-sm secondary" type="button" style="padding:4px 10px; font-size:11px;">レシピを見る</button>
          </div>
        `;
        row.querySelector("button").addEventListener("click", () => {
          state.selected = recipe;
          saveState();
          location.href = "recipe.html";
        });
        favList.appendChild(row);
      });
      if (state.favorites.length > 5) {
         const more = document.createElement("div");
         more.style.textAlign = "center"; more.style.fontSize = "12px"; more.style.color = "var(--ink-3)"; more.style.marginTop = "8px";
         more.textContent = `他 ${state.favorites.length - 5} 件のお気に入り`;
         favList.appendChild(more);
      }
    }
  }
}

function updateFavButton() {
  const btn = $("favToggle"); if (!btn||!state.selected) return;
  const isFav = state.favorites.includes(state.selected.id);
  btn.textContent = isFav ? "⭐" : "☆";
  btn.title = isFav ? "お気に入りから削除" : "お気に入りに追加";
}

/* ════════════════════════════════
   Events
   ════════════════════════════════ */

function bindMenuEvents() {
  if (!$("generateMenu")) return;

  // ── 通常生成ボタン ──
  $("generateMenu").addEventListener("click", async () => {
    const btn = $("generateMenu");
    const pBtn = $("generatePersonalizedMenu");
    btn.disabled = true; if(pBtn) pBtn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> 思考中...`;
    await generateMenu();
    renderMenuList(); renderNutrition(); renderHome(); renderAiStatus(); updateFilterSummary();
    btn.disabled = false; if(pBtn) pBtn.disabled = false;
    btn.innerHTML = "✨ AIに相談";
    // 生成後に結果セクションへスクロール
    const menuSection = $("menuList");
    if (menuSection) menuSection.closest(".panel")?.scrollIntoView({behavior:"smooth",block:"start"});
  });

  // ── おまかせパーソナライズボタン ──
  if ($("generatePersonalizedMenu")) {
    $("generatePersonalizedMenu").addEventListener("click", async () => {
      const btn = $("generateMenu");
      const pBtn = $("generatePersonalizedMenu");
      pBtn.disabled = true; btn.disabled = true;
      pBtn.innerHTML = `<span class="spinner"></span> 分析・提案中…`;
      
      try {
        await generatePersonalizedMenu();
      } catch(err) {
        alert("提案の生成中にエラーが発生しました。\n" + err.message);
      }
      
      renderMenuList(); renderNutrition(); renderHome(); renderAiStatus(); updateFilterSummary();
      pBtn.disabled = false; btn.disabled = false;
      pBtn.innerHTML = "💡 あなたにおすすめ";
      // リセット後にシーンやメイン食材のactiveを同期
      document.querySelectorAll(".chip").forEach(c => {
        const text = c.textContent.trim();
        const isActive = state.filters.tags.includes(text) || state.filters.moods.includes(text) || 
                         state.filters.conditions.includes(text) || state.filters.flavors.includes(text);
        c.classList.toggle("active", isActive);
      });
      const menuSection = $("menuList");
      if (menuSection) menuSection.closest(".panel")?.scrollIntoView({behavior:"smooth",block:"start"});
    });
  }

  // ── アコーディオン ──
  const toggle = $("filterToggle");
  const body   = $("filterBody");
  const arrow  = $("filterArrow");
  if (toggle && body) {
    toggle.addEventListener("click", () => {
      const open = body.classList.toggle("open");
      if (arrow) arrow.style.transform = open ? "rotate(180deg)" : "";
    });
    // 初回は開いた状態
    body.classList.add("open");
    if (arrow) arrow.style.transform = "rotate(180deg)";
  }

  // ── 調理時間スライダー ──
  const slider  = $("maxTimeSlider");
  const timeVal = $("maxTimeVal");
  const hidden  = $("maxTime");
  if (slider) {
    slider.addEventListener("input", () => {
      const v = slider.value;
      if (timeVal) timeVal.textContent = v;
      if (hidden)  hidden.value = v;
      state.filters.maxTime = Number(v);
      updateFilterSummary();
      saveState();
    });
    slider.value = state.filters.maxTime || 30;
    if (timeVal) timeVal.textContent = slider.value;
    if (hidden)  hidden.value = slider.value;
  }

  // ── タグ入力（使いたい食材）──
  const tagWrap  = $("mustUseWrap");
  const tagInput = $("mustUseInput");
  const tagHidden = $("mustUse");
  // 保存済みタグを復元
  if (tagWrap && tagInput) {
    const saved = (state.filters.mustUse || "").split(/[,、\s]+/).map(v=>v.trim()).filter(Boolean);
    saved.forEach(v => addTagPill(tagWrap, tagInput, tagHidden, v));

    const commitTag = () => {
      const raw = tagInput.value.trim();
      if (!raw) return;
      // カンマ/読点/スペースで複数一括追加
      raw.split(/[,、\s]+/).map(v=>v.trim()).filter(Boolean).forEach(v => {
        addTagPill(tagWrap, tagInput, tagHidden, v);
      });
      tagInput.value = "";
      updateFilterSummary();
      saveState();
    };
    tagInput.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === "," || e.key === "、") {
        e.preventDefault(); commitTag();
      }
      if (e.key === "Backspace" && tagInput.value === "") {
        // 最後のタグを削除
        const pills = tagWrap.querySelectorAll(".tag-pill");
        if (pills.length) pills[pills.length-1].remove();
        syncTagHidden(tagWrap, tagHidden);
        updateFilterSummary(); saveState();
      }
    });
    tagInput.addEventListener("blur", () => { if (tagInput.value) commitTag(); });
    tagWrap.addEventListener("click", () => tagInput.focus());
  }

  // ── チップ ──
  [["filterChips",state.filters.tags],["moodChips",state.filters.moods],
   ["conditionChips",state.filters.conditions],["flavorChips",state.filters.flavors]].forEach(([id,list])=>
    document.querySelectorAll(`#${id} .chip`).forEach(c=>
      c.addEventListener("click",()=>{ toggleChip(c,list); saveState(); updateFilterSummary(); })));
  ["mainIngChips","sceneChips"].forEach(id=>{
    document.querySelectorAll(`#${id} .chip`).forEach(c=>
      c.addEventListener("click",()=>{ c.classList.toggle("active"); updateFilterSummary(); }));
  });

  // ── 条件リセット ──
  const clearBtn = $("clearFilters");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.filters.tags=[]; state.filters.moods=[];
      state.filters.conditions=[]; state.filters.flavors=[];
      state.filters.mustUse=""; state.filters.maxTime=30;
      document.querySelectorAll(".chip.active").forEach(c=>c.classList.remove("active"));
      if (slider) { slider.value=30; if(timeVal)timeVal.textContent="30"; if(hidden)hidden.value="30"; }
      if (tagWrap) { tagWrap.querySelectorAll(".tag-pill").forEach(p=>p.remove()); }
      if (tagHidden) tagHidden.value="";
      saveState(); updateFilterSummary();
      showToast("条件をリセットしました");
    });
  }

  updateFilterSummary();
}

/* タグPillを追加 */
function addTagPill(wrap, input, hidden, val) {
  if (!val) return;
  // 重複チェック
  const existing = Array.from(wrap.querySelectorAll(".tag-pill")).map(p=>p.dataset.val);
  if (existing.includes(val)) return;
  const pill = document.createElement("span");
  pill.className = "tag-pill"; pill.dataset.val = val;
  pill.innerHTML = `${val}<span class="tag-pill-del" role="button">×</span>`;
  pill.querySelector(".tag-pill-del").addEventListener("click", e => {
    e.stopPropagation(); pill.remove();
    syncTagHidden(wrap, hidden);
    updateFilterSummary();
    if (typeof saveState === "function") saveState();
  });
  wrap.insertBefore(pill, input);
  syncTagHidden(wrap, hidden);
}

/* hidden inputに現在のタグを同期 */
function syncTagHidden(wrap, hidden) {
  if (!hidden) return;
  const vals = Array.from(wrap.querySelectorAll(".tag-pill")).map(p=>p.dataset.val);
  hidden.value = vals.join(",");
  state.filters.mustUse = hidden.value;
}

/* フィルター選択状況サマリー */
function updateFilterSummary() {
  const allChips = document.querySelectorAll(".chip.active");
  const tagPills = document.querySelectorAll(".tag-pill");
  const total = allChips.length + tagPills.length;
  const timeVal2 = $("maxTimeSlider") ? Number($("maxTimeSlider").value) : 30;

  const badge = $("filterCountBadge");
  if (badge) {
    badge.textContent = total > 0 ? `${total}件選択中` : "0件選択中";
    badge.style.background = total > 0 ? "var(--accent-bg)" : "";
    badge.style.borderColor = total > 0 ? "var(--accent)" : "";
    badge.style.color = total > 0 ? "var(--accent)" : "";
  }

  const summary = $("filterSummaryText");
  if (summary) {
    const parts = [];
    if (timeVal2 !== 30) parts.push(`${timeVal2}分以内`);
    if (total > 0) parts.push(`${total}条件`);
    summary.textContent = parts.length ? parts.join("・") : "条件なし";
  }
}

function bindRecipeEvents() {
  if (!$("cookToday")) return;
  $("cookToday").addEventListener("click", () => {
    if (!state.selected) return;
    const note = $("cookNote") ? $("cookNote").value.trim() : "";
    const date = new Date().toLocaleDateString("ja-JP");
    state.history.unshift({id:state.selected.id, name:state.selected.name, date, note});
    state.history = state.history.slice(0,10);
    buildShoppingFromSelected(); saveState();
    location.href = "shopping.html";
  });
  if ($("favToggle")) {
    $("favToggle").addEventListener("click", () => {
      if (!state.selected) return;
      const isFav = state.favorites.includes(state.selected.id);
      if (isFav) {
        state.favorites = state.favorites.filter(id=>id!==state.selected.id);
        showToast("お気に入りから削除しました");
      } else {
        state.favorites.push(state.selected.id);
        showToast("お気に入りに追加しました");
      }
      saveState(); updateFavButton();
    });
  }
  if ($("printBtn")) {
    $("printBtn").addEventListener("click", () => window.print());
  }
  
  // Custom logic for the dynamically populated recipe servings select
  if ($("servingsSelect")) {
    // Initialize default value once if we haven't
    if (state.selected) {
       const initialServings = state.profile.servings || state.selected.servings || 2;
       $("servingsSelect").value = initialServings;
    }
    
    $("servingsSelect").addEventListener("change", () => {
      // Re-render ingredients with new multiplier
      renderSelectedRecipe();
    });
  }
}

function bindShoppingEvents() {
  if (!$("addItemBtn")) return;
  $("addItemBtn").addEventListener("click", () => {
    const v = $("addItem").value.trim(); if (!v) return;
    state.shopping.push({name:v, done:false}); $("addItem").value=""; saveState(); renderShopping();
  });
  $("addItem").addEventListener("keydown", e => { if (e.key==="Enter") $("addItemBtn").click(); });
  $("clearDone").addEventListener("click", () => { state.shopping=state.shopping.filter(i=>!i.done); saveState(); renderShopping(); });
  $("clearAll").addEventListener("click", () => { if(!confirm("全て削除しますか？"))return; state.shopping=[]; saveState(); renderShopping(); });
  
  if ($("copyList")) {
    $("copyList").addEventListener("click", () => {
      if (!state.shopping.length) return alert("買い物リストは空です");
      const text = state.shopping.map(i => `${i.done?'☑':'☐'} ${i.name}`).join("\n");
      // Use general fallback if navigator.clipboard is missing
      const fullText = `🛒 買い物リスト\n${text}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(fullText).then(() => showToast("コピーしました！")).catch(() => alert("コピーに失敗しました"));
      } else {
        const ta = document.createElement("textarea");
        ta.value = fullText; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); showToast("コピーしました！"); } 
        catch (e) { alert("手動でコピーしてください:\n\n" + fullText); }
        document.body.removeChild(ta);
      }
    });
  }
}

/* ════════════════════════════════
   Init
   ════════════════════════════════ */

async function initApp() {
  loadState(); normalizeState();
  applyProfileInputs(); applyMenuFilters();
  bindProfileEvents(); bindMenuEvents(); bindRecipeEvents(); bindShoppingEvents();

  if ($("menuList")) {
    // プロフィール未設定かつメニューが空なら自動生成しない
    const hasProfile = state.profile.dislikes || state.profile.genres.length ||
                       state.profile.goal || state.profile.servings || state.profile.fridgeMemo;
    if (state.menu.length > 0) {
      // 前回の結果を表示
      renderMenuList(); renderNutrition(); renderHome(); renderAiStatus();
    } else if (hasProfile || state.profileLocked) {
      // プロフィール設定済みなら自動生成
      await generateMenu();
      renderMenuList(); renderNutrition(); renderHome(); renderAiStatus(); saveState();
    } else {
      // 未設定：空メッセージを表示してプロフィール入力を促す
      state.menuNotice = "👤 まずプロフィールを設定してから「AIに相談」を押してください";
      renderMenuList(); renderHome(); renderAiStatus();
    }
  } else {
    renderHome(); renderAiStatus();
  }
  
  // Home Accordion bindings
  if ($("favToggleHeader")) {
    $("favToggleHeader").addEventListener("click", () => {
      const body = $("favBody");
      const arrow = $("favArrow");
      if (body.style.display === "none") {
        body.style.display = "block";
        arrow.style.transform = "rotate(180deg)";
      } else {
        body.style.display = "none";
        arrow.style.transform = "rotate(0deg)";
      }
    });
  }
  
  renderSelectedRecipe();
  renderShopping();
  renderHistory();
}

document.addEventListener("DOMContentLoaded", () => {
  initApp();
  // Apply theme immediately before everything
  if (state.theme === "dark") {
    document.body.classList.add("dark-theme");
  } else if (state.theme !== "light" && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.body.classList.add("dark-theme");
    state.theme = "dark";
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW registration failed:', err));
  }
});
