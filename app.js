const config = window.APP_CONFIG || {};
const hasConfig = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
let supabase = null;

const $ = (selector) => document.querySelector(selector);
const LOCAL_STORAGE_KEY = "group-ledger-local-v1";
const state = {
  user: null,
  profile: null,
  localMode: false,
  localData: null,
  groups: [],
  group: null,
  members: [],
  entries: [],
  savingsJars: [],
  savingsTransactions: [],
  savingsLoadError: "",
  quickChoices: [],
  entryType: "expense",
  editingEntryId: null,
  editingSavingsJarId: null,
  pendingDeletion: null,
  resetSelectedEntryIds: new Set(),
  quickChoiceKind: null,
  channel: null,
  toastTimer: null,
};

const roleNames = { owner: "เจ้าของ", admin: "ผู้ดูแล", member: "สมาชิก" };
const descriptionQuickChoices = {
  expense: [
    { label: "ค่าอาหาร", value: "ค่าอาหาร", category: "อาหาร" },
    { label: "ค่าน้ำมัน", value: "ค่าน้ำมัน", category: "เดินทาง" },
    { label: "ค่าเดินทาง", value: "ค่าเดินทาง", category: "เดินทาง" },
    { label: "ค่าที่พัก", value: "ค่าที่พัก", category: "ที่พัก" },
    { label: "ของใช้ในบ้าน", value: "ของใช้ในบ้าน", category: "ของใช้" },
    { label: "ค่าไฟ", value: "ค่าไฟ", category: "บิลและค่าสาธารณูปโภค" },
    { label: "ค่าน้ำ", value: "ค่าน้ำ", category: "บิลและค่าสาธารณูปโภค" },
  ],
  income: [
    { label: "เงินเดือน", value: "เงินเดือน", category: "เงินเดือน" },
    { label: "ขายสินค้า", value: "ขายสินค้า", category: "ขายสินค้า" },
    { label: "รายรับอื่นๆ", value: "รายรับอื่นๆ", category: "อื่นๆ" },
  ],
};
const amountQuickChoices = [50, 100, 200, 500, 1000, 2000];
const quickChoiceSettings = {
  description: { title: "เพิ่มชื่อรายการ", label: "ชื่อรายการ", maxLength: 120 },
  category: { title: "เพิ่มหมวดหมู่", label: "ชื่อหมวดหมู่", maxLength: 60 },
  amount: { title: "เพิ่มจำนวนเงิน", label: "จำนวนเงิน (บาท)", type: "number" },
  spender: { title: "เพิ่มผู้ใช้เงิน", label: "ชื่อผู้ใช้เงิน", maxLength: 80 },
};
const currency = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
});
const thaiDate = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function showMessage(selector, message, isError = false) {
  const element = $(selector);
  element.textContent = message || "";
  element.classList.toggle("error", isError);
}

function displayError(error) {
  return error?.message || "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง";
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove("visible"), 2800);
}

function setSyncStatus(status) {
  $("#syncDot").className = `sync-dot ${status}`;
  $("#syncLabel").textContent =
    status === "online" ? "เชื่อมต่อแล้ว" : status === "offline" ? "กำลังเชื่อมต่อใหม่" : status === "local" ? "โหมดในเครื่อง" : "กำลังเชื่อมต่อ";
  $("#syncDetail").textContent =
    status === "local" ? "บันทึกในเบราว์เซอร์นี้" : status === "online" ? "ซิงก์ข้อมูลเรียลไทม์" : "ซิงก์ข้อมูลเรียลไทม์";
}

function setBusy(form, busy, label) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalLabel || label;
  }
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (!dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog.open) dialog.close();
}

function getGroupRole() {
  return state.group?.role || "member";
}

function isAdmin() {
  return ["owner", "admin"].includes(getGroupRole());
}

function setAuthView(isSignedIn) {
  $("#authView").hidden = isSignedIn;
  $("#appView").hidden = !isSignedIn;
}

function saveLocalData() {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state.localData));
}

async function startLocalMode() {
  let data;
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (saved) {
    data = JSON.parse(saved);
    if (!data || !Array.isArray(data.groups) || !Array.isArray(data.entries)) {
      throw new Error("ข้อมูลในโหมดทดลองไม่ถูกต้อง กรุณาล้างข้อมูลเว็บไซต์แล้วลองใหม่");
    }
  } else {
    const now = new Date().toISOString();
    const group = {
      id: crypto.randomUUID(),
      name: "กลุ่มของฉัน",
      role: "owner",
      created_at: now,
    };
    data = {
      userId: `local-${crypto.randomUUID()}`,
      profileName: createGuestName(),
      activeGroupId: group.id,
      groups: [group],
      entries: [],
      savingsJars: [],
      savingsTransactions: [],
    };
  }

  if (data.groups.length === 0) {
    data.groups.push({
      id: crypto.randomUUID(),
      name: "กลุ่มของฉัน",
      role: "owner",
      created_at: new Date().toISOString(),
    });
  }
  if (!Array.isArray(data.quickChoices)) data.quickChoices = [];
  if (!Array.isArray(data.savingsJars)) data.savingsJars = [];
  if (!Array.isArray(data.savingsTransactions)) data.savingsTransactions = [];
  state.localMode = true;
  state.localData = data;
  state.user = { id: data.userId || `local-${crypto.randomUUID()}` };
  state.localData.userId = state.user.id;
  state.profile = { display_name: data.profileName || "สมาชิกในเครื่อง" };
  state.localData.profileName = state.profile.display_name;
  $("#accountName").textContent = state.profile.display_name;
  $("#avatar").textContent = [...state.profile.display_name][0] || "ก";
  state.groups = data.groups.map((group) => ({ ...group, role: "owner" }));
  state.group =
    state.groups.find((group) => group.id === data.activeGroupId) || state.groups[0];
  state.localData.activeGroupId = state.group.id;
  saveLocalData();

  setAuthView(true);
  $("#dashboard").hidden = false;
  $("#emptyGroups").hidden = true;
  $("#localModeNotice").hidden = false;
  renderGroupOptions();
  updateGroupHeader();
  await loadGroupData();
  subscribeToGroup();

  if (new URLSearchParams(location.search).has("invite")) {
    toast("ลิงก์เชิญต้องใช้ Supabase เพื่อเข้าร่วมกลุ่มร่วมกับผู้อื่น");
  } else {
    toast("เริ่มใช้งานในเครื่องนี้แล้ว");
  }
}

function createGuestName() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return `สมาชิก ${String(value[0] % 1000000).padStart(6, "0")}`;
}

async function createGuestSession() {
  const { data, error } = await supabase.auth.signInAnonymously({
    options: { data: { display_name: createGuestName() } },
  });
  if (error) throw error;
  await handleAuthChange("SIGNED_IN", data.session);
}

async function handleAuthChange(event, session) {
  state.user = session?.user || null;
  if (!state.user) {
    state.profile = null;
    state.groups = [];
    state.group = null;
    state.entries = [];
    state.savingsJars = [];
    state.savingsTransactions = [];
    state.savingsLoadError = "";
    state.members = [];
    state.quickChoices = [];
    if (state.channel) {
      await supabase.removeChannel(state.channel);
      state.channel = null;
    }
    setAuthView(false);
    return;
  }

  setAuthView(true);
  await loadProfile();
  const inviteCode =
    new URLSearchParams(location.search).get("invite") ||
    localStorage.getItem("pending-group-invite");
  if (inviteCode) {
    await redeemInvite(inviteCode);
    localStorage.removeItem("pending-group-invite");
  }
  await loadGroups();
  if (event === "SIGNED_IN") toast(`ยินดีต้อนรับ ${state.profile?.display_name || ""}`);
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("id", state.user.id)
    .maybeSingle();
  if (error) throw error;
  state.profile = data || { display_name: state.user.email?.split("@")[0] || "สมาชิก" };
  $("#accountName").textContent = state.profile.display_name;
  $("#avatar").textContent = [...state.profile.display_name][0] || "ก";
}

async function redeemInvite(code) {
  const { error } = await supabase.rpc("join_group_with_code", { p_code: code });
  if (error) {
    toast(`เข้าร่วมกลุ่มไม่สำเร็จ: ${displayError(error)}`);
  } else {
    toast("เข้าร่วมกลุ่มเรียบร้อยแล้ว");
  }
  const url = new URL(location.href);
  url.searchParams.delete("invite");
  history.replaceState({}, "", url);
}

async function loadGroups(preferredGroupId = null) {
  if (state.localMode) {
    state.groups = state.localData.groups.map((group) => ({ ...group, role: "owner" }));
    const storedId = state.localData.activeGroupId || localStorage.getItem("selected-group");
    const nextId = preferredGroupId || state.group?.id || storedId;
    state.group = state.groups.find((group) => group.id === nextId) || state.groups[0] || null;
    renderGroupOptions();
    if (!state.group) {
      $("#dashboard").hidden = true;
      $("#emptyGroups").hidden = false;
      return;
    }
    state.localData.activeGroupId = state.group.id;
    localStorage.setItem("selected-group", state.group.id);
    saveLocalData();
    $("#dashboard").hidden = false;
    $("#emptyGroups").hidden = true;
    updateGroupHeader();
    await loadGroupData();
    subscribeToGroup();
    return;
  }

  const { data, error } = await supabase
    .from("group_members")
    .select("group_id, role, groups(id, name, created_at)")
    .eq("user_id", state.user.id)
    .order("joined_at", { ascending: true });
  if (error) {
    toast(`โหลดกลุ่มไม่สำเร็จ: ${displayError(error)}`);
    return;
  }

  state.groups = (data || [])
    .filter((row) => row.groups)
    .map((row) => ({ ...row.groups, role: row.role }));
  const storedId = localStorage.getItem("selected-group");
  const nextId = preferredGroupId || state.group?.id || storedId;
  state.group = state.groups.find((group) => group.id === nextId) || state.groups[0] || null;
  renderGroupOptions();
  if (!state.group) {
    if (state.channel) {
      await supabase.removeChannel(state.channel);
      state.channel = null;
    }
    $("#dashboard").hidden = true;
    $("#emptyGroups").hidden = false;
    setSyncStatus("online");
    return;
  }

  localStorage.setItem("selected-group", state.group.id);
  $("#dashboard").hidden = false;
  $("#emptyGroups").hidden = true;
  updateGroupHeader();
  await loadGroupData();
  subscribeToGroup();
}

function renderGroupOptions() {
  const select = $("#groupSelect");
  select.replaceChildren();
  for (const group of state.groups) {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.name;
    option.selected = group.id === state.group?.id;
    select.append(option);
  }
  select.hidden = state.groups.length === 0;
  $("#createGroupButton").hidden = state.groups.length === 0;
}

function updateGroupHeader() {
  const name = state.group?.name || "กลุ่มของฉัน";
  $("#topGroupName").textContent = name;
  $("#pageGroupName").textContent = name;
  $("#roleBadge").textContent = roleNames[getGroupRole()];
  $("#roleBadge").hidden = !state.group;
  $("#renameGroupButton").hidden = !isAdmin();
  $("#inviteButton").hidden = !isAdmin() || state.localMode;
  $("#membersInviteButton").hidden = state.localMode;
  $("#localModeNotice").hidden = !state.localMode;
  $("#memberCount").textContent = `${state.members.length || ""} สมาชิก`;
  $("#transactionCaption").textContent = state.localMode
    ? "รายการที่บันทึกไว้ในเบราว์เซอร์นี้"
    : "รายการล่าสุดของกลุ่ม อัปเดตให้ทุกคนทันที";
  $("#pageFooter").textContent = state.localMode
    ? "ข้อมูลจะบันทึกอัตโนมัติในเบราว์เซอร์นี้ และไม่ซิงก์ไปยังอุปกรณ์อื่น"
    : "ข้อมูลของกลุ่มจะซิงก์อัตโนมัติเมื่อสมาชิกเพิ่มหรือแก้ไขรายการ";
}

async function loadGroupData() {
  if (!state.group) return;
  const groupId = state.group.id;
  if (state.localMode) {
    state.entries = state.localData.entries
      .filter((entry) => entry.group_id === groupId)
      .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));
    state.savingsJars = state.localData.savingsJars
      .filter((jar) => jar.group_id === groupId && jar.owner_id === state.user.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    state.savingsTransactions = state.localData.savingsTransactions
      .filter((transaction) => transaction.group_id === groupId && transaction.owner_id === state.user.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    state.savingsLoadError = "";
    state.members = [{
      user_id: state.user.id,
      role: "owner",
      joined_at: state.group.created_at,
      profiles: { display_name: state.profile.display_name },
    }];
    state.quickChoices = state.localData.quickChoices
      .filter((choice) => choice.group_id === groupId);
    updateGroupHeader();
    renderEntries();
    renderSavingsJars();
    renderMembers();
    renderEntryQuickChoices();
    setSyncStatus("local");
    return;
  }

  const [entriesResult, membersResult, choicesResult, savingsJarsResult, savingsTransactionsResult] = await Promise.all([
    supabase
      .from("ledger_entries")
      .select("id, type, amount, category, description, spent_by, occurred_on, created_by, created_at")
      .eq("group_id", groupId)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("group_members")
      .select("user_id, role, joined_at, profiles(display_name)")
      .eq("group_id", groupId)
      .order("joined_at", { ascending: true }),
    supabase
      .from("group_entry_choices")
      .select("id, group_id, kind, entry_type, value, category, created_by, created_at")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true }),
    supabase
      .from("savings_jars")
      .select("id, group_id, owner_id, name, target_amount, created_at, updated_at")
      .eq("group_id", groupId)
      .eq("owner_id", state.user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("savings_jar_transactions")
      .select("id, jar_id, group_id, owner_id, type, amount, note, ledger_entry_id, created_at")
      .eq("group_id", groupId)
      .eq("owner_id", state.user.id)
      .order("created_at", { ascending: false }),
  ]);
  if (entriesResult.error) {
    toast(`โหลดรายการไม่สำเร็จ: ${displayError(entriesResult.error)}`);
    return;
  }
  if (membersResult.error) {
    toast(`โหลดสมาชิกไม่สำเร็จ: ${displayError(membersResult.error)}`);
    return;
  }
  if (state.group?.id !== groupId) return;
  state.entries = entriesResult.data || [];
  state.members = membersResult.data || [];
  if (choicesResult.error) {
    state.quickChoices = [];
    toast(`โหลดตัวเลือกที่เพิ่มเองไม่สำเร็จ: ${displayError(choicesResult.error)}`);
  } else {
    state.quickChoices = choicesResult.data || [];
  }
  if (savingsJarsResult.error || savingsTransactionsResult.error) {
    const error = savingsJarsResult.error || savingsTransactionsResult.error;
    state.savingsJars = [];
    state.savingsTransactions = [];
    state.savingsLoadError = `โหลดกระปุกออมสินไม่สำเร็จ: ${displayError(error)}`;
    toast(state.savingsLoadError);
  } else {
    state.savingsJars = savingsJarsResult.data || [];
    state.savingsTransactions = savingsTransactionsResult.data || [];
    state.savingsLoadError = "";
  }
  updateGroupHeader();
  renderEntries();
  renderSavingsJars();
  renderMembers();
  renderEntryQuickChoices();
}

function subscribeToGroup() {
  if (state.localMode) {
    setSyncStatus("local");
    return;
  }
  if (state.channel) supabase.removeChannel(state.channel);
  const groupId = state.group.id;
  setSyncStatus("");
  state.channel = supabase
    .channel(`group-${groupId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ledger_entries", filter: `group_id=eq.${groupId}` },
      () => loadGroupData(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "group_members", filter: `group_id=eq.${groupId}` },
      () => {
        loadGroups();
        loadGroupData();
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "groups", filter: `id=eq.${groupId}` },
      () => loadGroups(groupId),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "group_entry_choices", filter: `group_id=eq.${groupId}` },
      () => loadGroupData(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "savings_jars", filter: `group_id=eq.${groupId}` },
      () => loadGroupData(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "savings_jar_transactions", filter: `group_id=eq.${groupId}` },
      () => loadGroupData(),
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setSyncStatus("online");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setSyncStatus("offline");
      }
    });
}

function getSavingsJarBalance(jarId) {
  return state.savingsTransactions.reduce((balance, transaction) => {
    if (transaction.jar_id !== jarId) return balance;
    const amount = Number(transaction.amount);
    return balance + (transaction.type === "deposit" ? amount : -amount);
  }, 0);
}

function renderSavingsJars() {
  const list = $("#savingsJarList");
  list.replaceChildren();
  $("#savingsLoadError").hidden = !state.savingsLoadError;
  $("#savingsLoadErrorMessage").textContent = state.savingsLoadError;
  $("#savingsEmpty").hidden = Boolean(state.savingsLoadError) || state.savingsJars.length > 0;
  if (state.savingsLoadError) return;

  for (const jar of state.savingsJars) {
    const balance = getSavingsJarBalance(jar.id);
    const target = Number(jar.target_amount);
    const progress = target > 0 ? Math.min(100, Math.max(0, (balance / target) * 100)) : 0;
    const card = document.createElement("article");
    card.className = "savings-card";

    const heading = document.createElement("div");
    heading.className = "savings-card-heading";
    const icon = document.createElement("span");
    icon.className = "savings-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "◎";
    const title = document.createElement("div");
    title.className = "savings-card-title";
    const name = document.createElement("h3");
    name.textContent = jar.name;
    const goalLabel = document.createElement("span");
    goalLabel.textContent = "เป้าหมายส่วนตัว";
    title.append(name, goalLabel);
    const edit = document.createElement("button");
    edit.className = "icon-button savings-edit-button";
    edit.type = "button";
    edit.setAttribute("aria-label", `แก้ไขเป้าหมาย ${jar.name}`);
    edit.title = "แก้ไขชื่อหรือยอดเป้าหมาย";
    edit.textContent = "✎";
    edit.addEventListener("click", () => openSavingsJarDialog(jar));
    heading.append(icon, title, edit);

    const balanceBlock = document.createElement("div");
    balanceBlock.className = "savings-balance-block";
    const balanceLabel = document.createElement("span");
    balanceLabel.textContent = "ออมแล้ว";
    const balanceValue = document.createElement("strong");
    balanceValue.textContent = currency.format(balance);
    balanceBlock.append(balanceLabel, balanceValue);

    const progressTrack = document.createElement("div");
    progressTrack.className = "savings-progress";
    progressTrack.setAttribute("role", "progressbar");
    progressTrack.setAttribute("aria-label", `ความคืบหน้า ${jar.name}`);
    progressTrack.setAttribute("aria-valuemin", "0");
    progressTrack.setAttribute("aria-valuemax", "100");
    progressTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
    const progressBar = document.createElement("span");
    progressBar.style.width = `${progress}%`;
    progressTrack.append(progressBar);

    const targetRow = document.createElement("div");
    targetRow.className = "savings-target-row";
    const targetText = document.createElement("span");
    targetText.textContent = `เป้าหมาย ${currency.format(target)}`;
    const progressText = document.createElement("strong");
    progressText.textContent = `${Math.round(progress)}%`;
    targetRow.append(targetText, progressText);

    const actions = document.createElement("div");
    actions.className = "savings-actions";
    const deposit = document.createElement("button");
    deposit.className = "button button-primary";
    deposit.type = "button";
    deposit.textContent = "＋ ฝากเงิน";
    deposit.addEventListener("click", () => openSavingsTransactionDialog(jar, "deposit"));
    const withdraw = document.createElement("button");
    withdraw.className = "button button-secondary";
    withdraw.type = "button";
    withdraw.textContent = "ถอนเงิน";
    withdraw.disabled = balance <= 0;
    withdraw.addEventListener("click", () => openSavingsTransactionDialog(jar, "withdrawal"));
    actions.append(deposit, withdraw);

    const history = document.createElement("ul");
    history.className = "savings-history";
    const recentTransactions = state.savingsTransactions
      .filter((transaction) => transaction.jar_id === jar.id)
      .slice(0, 2);
    if (recentTransactions.length) {
      for (const transaction of recentTransactions) {
        const row = document.createElement("li");
        const label = document.createElement("span");
        const direction = transaction.type === "deposit" ? "ฝาก" : "ถอน";
        const date = thaiDate.format(new Date(transaction.created_at));
        label.textContent = `${direction} · ${date}${transaction.note ? ` · ${transaction.note}` : ""}`;
        const amount = document.createElement("strong");
        amount.textContent = `${transaction.type === "deposit" ? "+" : "−"}${currency.format(Number(transaction.amount))}`;
        amount.className = transaction.type === "deposit" ? "deposit" : "withdrawal";
        row.append(label, amount);
        history.append(row);
      }
    } else {
      const emptyHistory = document.createElement("li");
      emptyHistory.className = "savings-history-empty";
      emptyHistory.textContent = "ยังไม่มีรายการฝากหรือถอน";
      history.append(emptyHistory);
    }

    card.append(heading, balanceBlock, progressTrack, targetRow, actions, history);
    list.append(card);
  }
}

function isSavingsLedgerEntry(entry) {
  return entry.category === "ออมเงิน"
    && ["ฝากเงินเข้ากระปุกส่วนตัว", "ถอนเงินจากกระปุกส่วนตัว"].includes(entry.description);
}

function renderEntries() {
  const rows = $("#transactionRows");
  rows.replaceChildren();
  const filter = $("#typeFilter").value;
  const visibleEntries = state.entries.filter((entry) => filter === "all" || entry.type === filter);
  const formatter = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" });
  const today = new Date();
  $("#periodLabel").textContent = `สรุปประจำเดือน${formatter.format(today)}`;
  const monthEntries = state.entries.filter((entry) => {
    const date = new Date(`${entry.occurred_on}T00:00:00`);
    return date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  });
  const income = monthEntries
    .filter((entry) => entry.type === "income")
    .reduce((sum, entry) => sum + Number(entry.amount), 0);
  const expense = monthEntries
    .filter((entry) => entry.type === "expense")
    .reduce((sum, entry) => sum + Number(entry.amount), 0);
  $("#incomeValue").textContent = currency.format(income);
  $("#expenseValue").textContent = currency.format(expense);
  $("#balanceValue").textContent = currency.format(income - expense);

  for (const entry of visibleEntries) {
    const member = state.members.find((item) => item.user_id === entry.created_by);
    const row = document.createElement("tr");
    const titleCell = document.createElement("td");
    const title = document.createElement("div");
    title.className = "entry-title";
    const icon = document.createElement("span");
    icon.className = `entry-icon ${entry.type}`;
    icon.textContent = entry.type === "income" ? "↗" : "↘";
    const description = document.createElement("span");
    description.textContent = entry.description;
    title.append(icon, description);
    titleCell.append(title);

    const categoryCell = document.createElement("td");
    const category = document.createElement("span");
    category.className = "type-pill";
    category.textContent = entry.category;
    categoryCell.append(category);

    const dateCell = document.createElement("td");
    dateCell.textContent = thaiDate.format(new Date(`${entry.occurred_on}T00:00:00`));

    const spentByCell = document.createElement("td");
    spentByCell.textContent = entry.spent_by || "—";

    const authorCell = document.createElement("td");
    authorCell.textContent = member?.profiles?.display_name || "สมาชิก";

    const amountCell = document.createElement("td");
    amountCell.className = `amount ${entry.type}`;
    amountCell.textContent = `${entry.type === "income" ? "+" : "−"}${currency.format(Number(entry.amount))}`;

    const actionCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "entry-actions";
    if (isSavingsLedgerEntry(entry)) {
      const locked = document.createElement("span");
      locked.className = "entry-locked-label";
      locked.textContent = "กระปุก";
      locked.title = "รายการจากกระปุกออมสิน แก้ไขหรือลบไม่ได้";
      actions.append(locked);
    } else {
      const edit = document.createElement("button");
      edit.className = "icon-button";
      edit.type = "button";
      edit.setAttribute("aria-label", "แก้ไขรายการ");
      edit.title = "แก้ไขรายการ";
      edit.textContent = "✎";
      edit.addEventListener("click", () => openEntryDialog(entry));
      const remove = document.createElement("button");
      remove.className = "icon-button";
      remove.type = "button";
      remove.setAttribute("aria-label", "ลบรายการ");
      remove.title = "ลบรายการ";
      remove.textContent = "×";
      remove.addEventListener("click", () => deleteEntry(entry));
      actions.append(edit, remove);
    }
    actionCell.append(actions);
    row.append(titleCell, categoryCell, dateCell, spentByCell, authorCell, amountCell, actionCell);
    rows.append(row);
  }
  $("#emptyTransactions").hidden = visibleEntries.length > 0;
}

function renderMembers() {
  const list = $("#membersList");
  list.replaceChildren();
  $("#memberCount").textContent = `${state.members.length} สมาชิก`;
  for (const member of state.members) {
    const name = member.profiles?.display_name || "สมาชิก";
    const row = document.createElement("div");
    row.className = "member-row";
    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = [...name][0] || "ก";
    const info = document.createElement("div");
    info.className = "member-info";
    const memberName = document.createElement("strong");
    memberName.textContent = name + (member.user_id === state.user.id ? " (คุณ)" : "");
    const joined = document.createElement("small");
    joined.textContent = `เข้าร่วม ${thaiDate.format(new Date(member.joined_at))}`;
    info.append(memberName, joined);
    const role = document.createElement("span");
    role.className = "member-role";
    role.textContent = roleNames[member.role] || roleNames.member;
    row.append(avatar, info, role);

    const canManage = isAdmin() && member.role !== "owner" &&
      (getGroupRole() === "owner" || member.role === "member");
    if (canManage) {
      const manage = document.createElement("button");
      manage.className = "member-manage";
      manage.type = "button";
      manage.title = member.role === "admin" ? "ปรับเป็นสมาชิก" : "จัดการสมาชิก";
      manage.setAttribute("aria-label", manage.title);
      manage.textContent = "⋯";
      manage.addEventListener("click", () => manageMember(member));
      row.append(manage);
    }
    list.append(row);
  }
  updateGroupHeader();
}

function renderChoiceButtons(selector, choices, selectedValue, onSelect) {
  const container = $(selector);
  container.replaceChildren();
  for (const choice of choices) {
    const item = document.createElement("span");
    item.className = "quick-choice-item";
    const button = document.createElement("button");
    button.className = "quick-choice";
    button.type = "button";
    button.textContent = choice.label;
    const selected = choice.value === selectedValue;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.addEventListener("click", () => {
      onSelect(choice);
      renderEntryQuickChoices();
    });
    item.append(button);
    if (choice.id && (state.localMode || choice.created_by === state.user.id || isAdmin())) {
      item.classList.add("removable");
      const remove = document.createElement("button");
      remove.className = "quick-choice-remove";
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `ลบตัวเลือก ${choice.label}`);
      remove.title = `ลบตัวเลือก ${choice.label}`;
      remove.addEventListener("click", () => deleteQuickChoice(choice));
      item.append(remove);
    }
    container.append(item);
  }
}

function renderCustomCategoryOptions() {
  const select = $("#entryCategory");
  const selectedValue = select.value;
  select.querySelectorAll("option[data-quick-choice], option[data-current-category]")
    .forEach((option) => option.remove());

  const customCategories = [
    ...state.quickChoices
      .filter((choice) => choice.kind === "category")
      .map((choice) => ({ value: choice.value, choice })),
    ...state.quickChoices
      .filter((choice) => choice.kind === "description")
      .map((choice) => ({ value: choice.category, choice: null })),
  ];
  const existing = new Set([...select.options].map((option) => option.value));
  for (const { value, choice } of customCategories) {
    if (!value || existing.has(value)) continue;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    if (choice) option.dataset.quickChoice = "true";
    select.append(option);
    existing.add(value);
  }
  if (selectedValue && !existing.has(selectedValue)) {
    const option = document.createElement("option");
    option.value = selectedValue;
    option.textContent = selectedValue;
    option.dataset.currentCategory = "true";
    select.append(option);
  }
  if (selectedValue) select.value = selectedValue;

  const choiceCategory = $("#quickChoiceCategory");
  if (choiceCategory) {
    const previousValue = choiceCategory.value;
    choiceCategory.replaceChildren();
    for (const option of select.options) {
      if (option.dataset.currentCategory) continue;
      const copy = document.createElement("option");
      copy.value = option.value;
      copy.textContent = option.textContent;
      choiceCategory.append(copy);
    }
    choiceCategory.value = [...choiceCategory.options].some((option) => option.value === previousValue)
      ? previousValue
      : select.value;
  }
}

function renderEntryQuickChoices() {
  renderCustomCategoryOptions();
  const descriptions = [
    ...(descriptionQuickChoices[state.entryType] || []),
    ...state.quickChoices
      .filter((choice) => choice.kind === "description" && choice.entry_type === state.entryType)
      .map((choice) => ({
        ...choice,
        label: choice.value,
        value: choice.value,
      })),
  ];
  renderChoiceButtons(
    "#descriptionQuickChoices",
    descriptions,
    $("#entryDescription").value,
    (choice) => {
      $("#entryDescription").value = choice.value;
      $("#entryCategory").value = choice.category;
    },
  );

  const memberNames = state.members.map((member) => member.profiles?.display_name || "").filter(Boolean);
  const spenderChoices = [
    ...memberNames.map((name) => ({ label: name, value: name })),
    ...state.quickChoices
      .filter((choice) => choice.kind === "spender")
      .map((choice) => ({ ...choice, label: choice.value })),
  ];
  const uniqueSpenders = [...new Map(
    spenderChoices.map((choice) => [choice.value.trim().toLocaleLowerCase(), choice]),
  ).values()];
  renderChoiceButtons(
    "#spentByQuickChoices",
    uniqueSpenders,
    $("#entrySpentBy").value,
    (choice) => { $("#entrySpentBy").value = choice.value; },
  );

  renderChoiceButtons(
    "#amountQuickChoices",
    [
      ...amountQuickChoices.map((amount) => ({
        label: new Intl.NumberFormat("th-TH").format(amount),
        value: String(amount),
      })),
      ...state.quickChoices
        .filter((choice) => choice.kind === "amount")
        .map((choice) => ({
          ...choice,
          label: new Intl.NumberFormat("th-TH").format(Number(choice.value)),
        })),
    ],
    $("#entryAmount").value,
    (choice) => { $("#entryAmount").value = choice.value; },
  );

  const categories = [...$("#entryCategory").options].map((option) => ({
    label: option.textContent,
    value: option.value,
    ...state.quickChoices.find((choice) => choice.kind === "category" && choice.value === option.value),
  }));
  renderChoiceButtons(
    "#categoryQuickChoices",
    categories,
    $("#entryCategory").value,
    (choice) => { $("#entryCategory").value = choice.value; },
  );
}

function openQuickChoiceDialog(kind) {
  const settings = quickChoiceSettings[kind];
  if (!settings) return;
  state.quickChoiceKind = kind;
  $("#quickChoiceForm").reset();
  $("#quickChoiceTitle").textContent = settings.title;
  $("#quickChoiceValueLabel").textContent = settings.label;
  $("#quickChoiceValue").type = settings.type || "text";
  $("#quickChoiceValue").maxLength = settings.maxLength || 120;
  $("#quickChoiceValue").placeholder = settings.type === "number" ? "เช่น 750" : "พิมพ์ตัวเลือก";
  $("#quickChoiceValue").removeAttribute("min");
  $("#quickChoiceValue").removeAttribute("max");
  $("#quickChoiceValue").removeAttribute("step");
  if (settings.type === "number") {
    $("#quickChoiceValue").min = "0.01";
    $("#quickChoiceValue").max = "999999999999.99";
    $("#quickChoiceValue").step = "0.01";
  }
  const hasCategory = kind === "description";
  $("#quickChoiceCategoryLabel").hidden = !hasCategory;
  $("#quickChoiceCategory").hidden = !hasCategory;
  renderCustomCategoryOptions();
  $("#quickChoiceCategory").value = $("#entryCategory").value;
  $("#quickChoiceNotice").textContent = state.localMode
    ? "ตัวเลือกจะบันทึกไว้ในเครื่องนี้เท่านั้น"
    : "ตัวเลือกนี้จะแชร์กับสมาชิกในกลุ่ม";
  showMessage("#quickChoiceError", "");
  openDialog("quickChoiceDialog");
  $("#quickChoiceValue").focus();
}

function quickChoiceExists(kind, value, entryType) {
  const isSameValue = (candidate) => kind === "amount"
    ? Number(candidate) === Number(value)
    : candidate.trim().toLocaleLowerCase() === value.trim().toLocaleLowerCase();
  let builtInValues = [];

  if (kind === "description") {
    builtInValues = (descriptionQuickChoices[entryType] || []).map((choice) => choice.value);
  } else if (kind === "category") {
    builtInValues = [...$("#entryCategory").options].map((option) => option.value);
  } else if (kind === "amount") {
    builtInValues = amountQuickChoices.map(String);
  } else if (kind === "spender") {
    builtInValues = state.members.map((member) => member.profiles?.display_name || "").filter(Boolean);
  }

  return builtInValues.some(isSameValue) || state.quickChoices.some((choice) =>
    choice.kind === kind &&
    (kind !== "description" || choice.entry_type === entryType) &&
    isSameValue(choice.value),
  );
}

async function saveQuickChoice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const kind = state.quickChoiceKind;
  const entryType = kind === "description" ? state.entryType : "";
  let value = $("#quickChoiceValue").value.trim();
  if (!kind || !value) {
    showMessage("#quickChoiceError", "กรุณากรอกตัวเลือก", true);
    return;
  }
  const maxLength = quickChoiceSettings[kind].maxLength;
  if (maxLength && value.length > maxLength) {
    showMessage("#quickChoiceError", `ตัวเลือกต้องไม่เกิน ${maxLength} ตัวอักษร`, true);
    return;
  }
  if (kind === "amount") {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99) {
      showMessage("#quickChoiceError", "กรุณากรอกจำนวนเงินมากกว่า 0", true);
      return;
    }
    value = String(amount);
    if (!/^[0-9]{1,12}([.][0-9]{1,2})?$/.test(value)) {
      showMessage("#quickChoiceError", "จำนวนเงินต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง", true);
      return;
    }
  }
  if (quickChoiceExists(kind, value, entryType)) {
    showMessage("#quickChoiceError", "ตัวเลือกนี้มีอยู่แล้ว", true);
    return;
  }

  setBusy(form, true, "กำลังเพิ่ม...");
  try {
    const payload = {
      group_id: state.group.id,
      kind,
      entry_type: entryType,
      value,
      category: kind === "description" ? $("#quickChoiceCategory").value : "",
      created_by: state.user.id,
    };
    if (state.localMode) {
      const choice = {
        ...payload,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      };
      state.localData.quickChoices.push(choice);
      try {
        saveLocalData();
      } catch (error) {
        state.localData.quickChoices = state.localData.quickChoices.filter((item) => item.id !== choice.id);
        showMessage("#quickChoiceError", `บันทึกตัวเลือกไม่สำเร็จ: ${displayError(error)}`, true);
        return;
      }
      state.quickChoices = state.localData.quickChoices.filter((choice) => choice.group_id === state.group.id);
    } else {
      const { data, error } = await supabase
        .from("group_entry_choices")
        .insert(payload)
        .select("id, group_id, kind, entry_type, value, category, created_by, created_at")
        .single();
      if (error) throw error;
      state.quickChoices = [...state.quickChoices, data];
    }
    renderEntryQuickChoices();
    closeDialog("quickChoiceDialog");
    state.quickChoiceKind = null;
    toast("เพิ่มตัวเลือกแล้ว");
  } catch (error) {
    showMessage("#quickChoiceError", `เพิ่มตัวเลือกไม่สำเร็จ: ${displayError(error)}`, true);
  } finally {
    setBusy(form, false, "");
  }
}

async function deleteQuickChoice(choice) {
  if (!confirm(`ลบตัวเลือก “${choice.value}” ใช่หรือไม่?`)) return;
  if (state.localMode) {
    const previousChoices = state.localData.quickChoices;
    state.localData.quickChoices = previousChoices.filter((item) => item.id !== choice.id);
    try {
      saveLocalData();
    } catch (error) {
      state.localData.quickChoices = previousChoices;
      toast(`ลบตัวเลือกไม่สำเร็จ: ${displayError(error)}`);
      return;
    }
    state.quickChoices = state.localData.quickChoices.filter((item) => item.group_id === state.group.id);
  } else {
    const { error } = await supabase
      .from("group_entry_choices")
      .delete()
      .eq("id", choice.id)
      .eq("group_id", state.group.id);
    if (error) {
      toast(`ลบตัวเลือกไม่สำเร็จ: ${displayError(error)}`);
      return;
    }
    state.quickChoices = state.quickChoices.filter((item) => item.id !== choice.id);
  }
  renderEntryQuickChoices();
  toast("ลบตัวเลือกแล้ว");
}

function openEntryDialog(entry = null) {
  state.editingEntryId = entry?.id || null;
  state.entryType = entry?.type || "expense";
  $("#entryDialogTitle").textContent = entry ? "แก้ไขรายการ" : "เพิ่มรายการ";
  $("#resetEntryButtonLabel").textContent = entry ? "คืนค่าเดิม" : "ล้างฟอร์ม";
  $("#resetEntryButton").title = entry ? "คืนค่ารายการเป็นข้อมูลเดิม" : "ล้างค่าที่กรอกในฟอร์ม";
  $("#entryDescription").value = entry?.description || "";
  $("#entrySpentBy").value = entry?.spent_by || "";
  $("#entryAmount").value = entry?.amount ?? "";
  const today = new Date();
  const localToday = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  $("#entryDate").value = entry?.occurred_on || localToday;
  $("#entryCategory").value = entry?.category || "อาหาร";
  document.querySelectorAll(".type-option").forEach((button) => {
    button.classList.toggle("selected", button.dataset.type === state.entryType);
  });
  renderEntryQuickChoices();
  showMessage("#entryError", "");
  openDialog("entryDialog");
}

function resetEntryForm() {
  const originalEntry = state.editingEntryId
    ? state.entries.find((item) => item.id === state.editingEntryId)
    : null;

  const today = new Date();
  const localToday = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  if (originalEntry) {
    state.entryType = originalEntry.type || "expense";
    $("#entryDescription").value = originalEntry.description || "";
    $("#entrySpentBy").value = originalEntry.spent_by || "";
    $("#entryAmount").value = originalEntry.amount ?? "";
    $("#entryDate").value = originalEntry.occurred_on || localToday;
    $("#entryCategory").value = originalEntry.category || "อาหาร";
    toast("คืนค่าเดิมของรายการแล้ว");
  } else {
    state.entryType = "expense";
    $("#entryDescription").value = "";
    $("#entrySpentBy").value = "";
    $("#entryAmount").value = "";
    $("#entryDate").value = localToday;
    $("#entryCategory").value = "อาหาร";
    toast("ล้างข้อมูลในฟอร์มแล้ว");
  }

  document.querySelectorAll(".type-option").forEach((button) => {
    button.classList.toggle("selected", button.dataset.type === state.entryType);
  });
  renderEntryQuickChoices();
  showMessage("#entryError", "");
  $("#entryDescription").focus();
}

const MAX_SAVINGS_AMOUNT = 999999999999.99;

function isValidSavingsAmount(amount) {
  return Number.isFinite(amount)
    && amount > 0
    && amount <= MAX_SAVINGS_AMOUNT
    && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001;
}

function openSavingsJarDialog(jar = null) {
  state.editingSavingsJarId = jar?.id || null;
  $("#savingsJarDialogTitle").textContent = jar ? "แก้ไขเป้าหมาย" : "สร้างกระปุกออมสิน";
  $("#savingsJarName").value = jar?.name || "";
  $("#savingsJarTarget").value = jar?.target_amount ?? "";
  showMessage("#savingsJarError", "");
  openDialog("savingsJarDialog");
}

function openSavingsTransactionDialog(jar, type) {
  const isDeposit = type === "deposit";
  $("#savingsTransactionJarId").value = jar.id;
  $("#savingsTransactionType").value = type;
  $("#savingsTransactionTitle").textContent = isDeposit ? "ฝากเงินเข้ากระปุก" : "ถอนเงินจากกระปุก";
  $("#savingsTransactionDescription").textContent = `${jar.name} · คงเหลือ ${currency.format(getSavingsJarBalance(jar.id))}`;
  $("#savingsTransactionAmount").value = "";
  $("#savingsTransactionNote").value = "";
  showMessage("#savingsTransactionError", "");
  openDialog("savingsTransactionDialog");
}

async function saveSavingsJar(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = $("#savingsJarName").value.trim();
  const targetAmount = Number($("#savingsJarTarget").value);
  if (!name || name.length > 60 || !isValidSavingsAmount(targetAmount)) {
    showMessage("#savingsJarError", "กรุณากรอกชื่อกระปุกและยอดเป้าหมายที่ถูกต้อง", true);
    return;
  }

  const payload = {
    name,
    target_amount: targetAmount,
  };
  setBusy(form, true, "กำลังบันทึก...");
  showMessage("#savingsJarError", "");
  try {
    if (state.localMode) {
      const previousJars = state.localData.savingsJars;
      const now = new Date().toISOString();
      if (state.editingSavingsJarId) {
        const existing = previousJars.find((jar) =>
          jar.id === state.editingSavingsJarId
          && jar.group_id === state.group.id
          && jar.owner_id === state.user.id,
        );
        if (!existing) throw new Error("ไม่พบกระปุกออมสินที่ต้องการแก้ไข");
        state.localData.savingsJars = previousJars.map((jar) =>
          jar.id === existing.id ? { ...jar, ...payload, updated_at: now } : jar,
        );
      } else {
        state.localData.savingsJars = [
          ...previousJars,
          {
            ...payload,
            id: crypto.randomUUID(),
            group_id: state.group.id,
            owner_id: state.user.id,
            created_at: now,
            updated_at: now,
          },
        ];
      }
      try {
        saveLocalData();
      } catch (error) {
        state.localData.savingsJars = previousJars;
        throw error;
      }
    } else {
      const query = supabase.from("savings_jars");
      const result = state.editingSavingsJarId
        ? await query
          .update(payload)
          .eq("id", state.editingSavingsJarId)
          .eq("group_id", state.group.id)
          .eq("owner_id", state.user.id)
        : await query.insert({
          ...payload,
          group_id: state.group.id,
          owner_id: state.user.id,
        });
      if (result.error) throw result.error;
    }

    closeDialog("savingsJarDialog");
    await loadGroupData();
    toast(state.editingSavingsJarId ? "บันทึกเป้าหมายแล้ว" : "สร้างกระปุกออมสินแล้ว");
  } catch (error) {
    showMessage("#savingsJarError", displayError(error), true);
  } finally {
    setBusy(form, false, "");
  }
}

async function saveSavingsTransaction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const jarId = $("#savingsTransactionJarId").value;
  const type = $("#savingsTransactionType").value;
  const amount = Number($("#savingsTransactionAmount").value);
  const note = $("#savingsTransactionNote").value.trim();
  const jar = state.savingsJars.find((item) => item.id === jarId);
  if (!jar || !["deposit", "withdrawal"].includes(type)) {
    showMessage("#savingsTransactionError", "ไม่พบกระปุกออมสินที่เลือก กรุณาลองใหม่", true);
    return;
  }
  if (!isValidSavingsAmount(amount) || note.length > 120) {
    showMessage("#savingsTransactionError", "กรุณากรอกจำนวนเงินให้ถูกต้อง (ไม่เกิน 2 ตำแหน่งทศนิยม)", true);
    return;
  }
  if (type === "withdrawal" && amount > getSavingsJarBalance(jar.id)) {
    showMessage("#savingsTransactionError", "ยอดถอนมากกว่ายอดเงินในกระปุก", true);
    return;
  }

  setBusy(form, true, "กำลังบันทึก...");
  showMessage("#savingsTransactionError", "");
  try {
    if (state.localMode) {
      const previousTransactions = state.localData.savingsTransactions;
      const previousEntries = state.localData.entries;
      const now = new Date().toISOString();
      const ledgerId = crypto.randomUUID();
      state.localData.savingsTransactions = [
        ...previousTransactions,
        {
          id: crypto.randomUUID(),
          jar_id: jar.id,
          group_id: state.group.id,
          owner_id: state.user.id,
          type,
          amount,
          note,
          ledger_entry_id: ledgerId,
          created_at: now,
        },
      ];
      state.localData.entries = [
        ...previousEntries,
        {
          id: ledgerId,
          group_id: state.group.id,
          type: type === "deposit" ? "expense" : "income",
          amount,
          category: "ออมเงิน",
          description: type === "deposit" ? "ฝากเงินเข้ากระปุกส่วนตัว" : "ถอนเงินจากกระปุกส่วนตัว",
          spent_by: "",
          occurred_on: getLocalDateKey(new Date()),
          created_by: state.user.id,
          updated_by: state.user.id,
          created_at: now,
        },
      ];
      try {
        saveLocalData();
      } catch (error) {
        state.localData.savingsTransactions = previousTransactions;
        state.localData.entries = previousEntries;
        throw error;
      }
    } else {
      const { error } = await supabase.rpc("record_savings_jar_transaction", {
        p_jar_id: jar.id,
        p_type: type,
        p_amount: amount,
        p_note: note,
      });
      if (error) throw error;
    }

    closeDialog("savingsTransactionDialog");
    await loadGroupData();
    toast(type === "deposit" ? "บันทึกเงินฝากแล้ว" : "บันทึกการถอนแล้ว");
  } catch (error) {
    const message = error?.message?.includes("exceeds the savings jar balance")
      ? "ยอดถอนมากกว่ายอดเงินในกระปุก"
      : displayError(error);
    showMessage("#savingsTransactionError", message, true);
  } finally {
    setBusy(form, false, "");
  }
}

async function saveEntry(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const description = $("#entryDescription").value.trim();
  const amount = Number($("#entryAmount").value);
  if (!description || !Number.isFinite(amount) || amount <= 0) {
    showMessage("#entryError", "กรุณากรอกชื่อรายการและจำนวนเงินที่มากกว่า 0", true);
    return;
  }
  const payload = {
    type: state.entryType,
    amount,
    description,
    spent_by: $("#entrySpentBy").value.trim(),
    category: $("#entryCategory").value,
    occurred_on: $("#entryDate").value,
    updated_by: state.user.id,
  };
  if (!state.editingEntryId) {
    payload.group_id = state.group.id;
    payload.created_by = state.user.id;
  }
  setBusy(form, true, "กำลังบันทึก...");
  showMessage("#entryError", "");
  try {
    if (state.localMode) {
      if (state.editingEntryId) {
        const existing = state.localData.entries.find((entry) => entry.id === state.editingEntryId);
        if (!existing) throw new Error("ไม่พบรายการที่ต้องการแก้ไข");
        Object.assign(existing, payload, { updated_at: new Date().toISOString() });
      } else {
        state.localData.entries.push({
          ...payload,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        });
      }
      saveLocalData();
      closeDialog("entryDialog");
      await loadGroupData();
      toast(state.editingEntryId ? "แก้ไขรายการแล้ว" : "เพิ่มรายการแล้ว");
      return;
    }

    const query = supabase.from("ledger_entries");
    const { error } = state.editingEntryId
      ? await query.update(payload).eq("id", state.editingEntryId).eq("group_id", state.group.id)
      : await query.insert(payload);
    if (error) throw error;
    closeDialog("entryDialog");
    await loadGroupData();
    toast(state.editingEntryId ? "แก้ไขรายการแล้ว" : "เพิ่มรายการแล้ว");
  } catch (error) {
    showMessage("#entryError", displayError(error), true);
  } finally {
    setBusy(form, false, "");
  }
}

async function deleteEntry(entry) {
  if (isSavingsLedgerEntry(entry)) {
    toast("รายการจากกระปุกออมสินแก้ไขหรือลบไม่ได้");
    return;
  }
  if (!confirm(`ลบรายการ “${entry.description}” ใช่หรือไม่?`)) return;
  if (state.localMode) {
    state.localData.entries = state.localData.entries.filter((item) => item.id !== entry.id);
    try {
      saveLocalData();
    } catch (error) {
      toast(`ลบรายการไม่สำเร็จ: ${displayError(error)}`);
      return;
    }
    await loadGroupData();
    toast("ลบรายการแล้ว");
    return;
  }

  const { error } = await supabase
    .from("ledger_entries")
    .delete()
    .eq("id", entry.id)
    .eq("group_id", state.group.id);
  if (error) {
    toast(`ลบรายการไม่สำเร็จ: ${displayError(error)}`);
    return;
  }
  await loadGroupData();
  toast("ลบรายการแล้ว");
}

function getLocalDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getDeletionRange(scope, referenceDate = new Date()) {
  const firstDay = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  let start = firstDay;
  let end = firstDay;

  if (scope === "week") {
    const daysSinceMonday = (firstDay.getDay() + 6) % 7;
    start = new Date(firstDay);
    start.setDate(firstDay.getDate() - daysSinceMonday);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  } else if (scope === "month") {
    start = new Date(firstDay.getFullYear(), firstDay.getMonth(), 1);
    end = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0);
  }

  return { start: getLocalDateKey(start), end: getLocalDateKey(end) };
}

function formatDeletionRange({ start, end }) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (start === end) return thaiDate.format(startDate);

  const dayAndMonth = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" });
  const year = thaiDate.format(endDate).split(" ").pop();
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();
  if (sameMonth) {
    const month = new Intl.DateTimeFormat("th-TH", { month: "short" }).format(endDate);
    return `${startDate.getDate()}–${endDate.getDate()} ${month} ${year}`;
  }
  if (sameYear) return `${dayAndMonth.format(startDate)}–${dayAndMonth.format(endDate)} ${year}`;
  return `${thaiDate.format(startDate)}–${thaiDate.format(endDate)}`;
}

function deletionScopeDescription(scope) {
  return scope === "all" ? "ทุกรายการในกลุ่มนี้" : formatDeletionRange(getDeletionRange(scope));
}

function entriesInDeletionScopes(scopes) {
  if (scopes.includes("all")) return state.entries.filter((entry) => !isSavingsLedgerEntry(entry));
  const ranges = scopes.map((scope) => getDeletionRange(scope));
  return state.entries.filter((entry) =>
    !isSavingsLedgerEntry(entry)
      && ranges.some(({ start, end }) => entry.occurred_on >= start && entry.occurred_on <= end),
  );
}

function selectedDeletionScopes() {
  return [...document.querySelectorAll(".reset-scope:checked")].map((checkbox) => checkbox.value);
}

function updateResetSelection() {
  const counts = {
    day: entriesInDeletionScopes(["day"]).length,
    week: entriesInDeletionScopes(["week"]).length,
    month: entriesInDeletionScopes(["month"]).length,
    all: entriesInDeletionScopes(["all"]).length,
  };
  $("#resetDayCount").textContent = counts.day;
  $("#resetWeekCount").textContent = counts.week;
  $("#resetMonthCount").textContent = counts.month;
  $("#resetAllCount").textContent = counts.all;
  $("#resetIndividualCount").textContent = counts.all;
  $("#resetDayRange").textContent = deletionScopeDescription("day");
  $("#resetWeekRange").textContent = deletionScopeDescription("week");
  $("#resetMonthRange").textContent = deletionScopeDescription("month");

  const scopes = selectedDeletionScopes();
  const manualMode = $("#resetManualSelection").checked;
  const candidates = manualMode
    ? state.entries.filter((entry) => !isSavingsLedgerEntry(entry))
    : entriesInDeletionScopes(scopes);
  const selectedEntries = candidates.filter((entry) => state.resetSelectedEntryIds.has(entry.id));
  const selectedCount = selectedEntries.length;
  $("#resetSelectionCount").classList.toggle("has-selection", selectedCount > 0);
  $("#resetSelectionCount").textContent = scopes.length || manualMode
    ? `เลือกไว้ ${selectedCount} รายการ`
    : "กรุณาเลือกช่วงเวลาหรือรายการทั้งหมดที่ต้องการลบ";
  $("#openDeleteConfirmButton").disabled = selectedCount === 0;
  $("#resetPreview").hidden = candidates.length === 0 || (!manualMode && scopes.length === 0);
  $("#resetPreview").open = manualMode && candidates.length > 0;
  $("#resetPreviewTitle").textContent = manualMode ? "เลือกรายการที่จะลบ" : "ดูรายการที่จะลบ";
  $("#resetPreviewCount").textContent = `${selectedCount}/${candidates.length} รายการ`;
  const previewList = $("#resetPreviewItems");
  previewList.replaceChildren();
  for (const entry of candidates) {
    const item = document.createElement("li");
    const selection = document.createElement("label");
    selection.className = "reset-preview-item";
    const checkbox = document.createElement("input");
    checkbox.className = "reset-entry-checkbox";
    checkbox.type = "checkbox";
    checkbox.value = entry.id;
    checkbox.checked = state.resetSelectedEntryIds.has(entry.id);
    checkbox.setAttribute(
      "aria-label",
      `เลือกลบ ${entry.description || "ไม่มีชื่อรายการ"} วันที่ ${thaiDate.format(new Date(`${entry.occurred_on}T00:00:00`))}`,
    );
    const description = document.createElement("strong");
    description.className = "reset-preview-description";
    description.textContent = entry.description || "ไม่มีชื่อรายการ";
    const details = document.createElement("span");
    details.className = "reset-preview-detail";
    details.textContent = `${thaiDate.format(new Date(`${entry.occurred_on}T00:00:00`))} · ${entry.type === "income" ? "รายรับ" : "รายจ่าย"} · ${currency.format(Number(entry.amount))}`;
    const copy = document.createElement("span");
    copy.className = "reset-preview-copy";
    copy.append(description, details);
    selection.append(checkbox, copy);
    item.append(selection);
    previewList.append(item);
  }
}

function openResetDialog() {
  state.pendingDeletion = null;
  state.resetSelectedEntryIds = new Set();
  $("#resetPreview").open = false;
  $("#resetManualSelection").checked = false;
  $("#resetManualSelection").closest(".reset-option").classList.remove("is-selected");
  document.querySelectorAll(".reset-scope").forEach((checkbox) => {
    checkbox.checked = false;
    checkbox.closest(".reset-option").classList.remove("is-selected");
  });
  updateResetSelection();
  openDialog("resetDialog");
}

function requestSelectedDeletion(event) {
  event.preventDefault();
  const scopes = selectedDeletionScopes();
  const manualMode = $("#resetManualSelection").checked;
  const candidates = manualMode
    ? state.entries.filter((entry) => !isSavingsLedgerEntry(entry))
    : entriesInDeletionScopes(scopes);
  const entries = candidates.filter((entry) => state.resetSelectedEntryIds.has(entry.id));
  if (!state.group || entries.length === 0) return;

  const scopeNames = { day: "วันนี้", week: "สัปดาห์นี้", month: "เดือนนี้", all: "รายการทั้งหมด" };
  const scopeSummary = manualMode
    ? "เลือกรายการเอง"
    : scopes.map((scope) => `${scopeNames[scope]} (${deletionScopeDescription(scope)})`).join(", ");
  state.pendingDeletion = {
    groupId: state.group.id,
    entryIds: entries.map((entry) => entry.id),
  };
  $("#deleteConfirmMessage").textContent =
    `คุณกำลังจะลบ ${entries.length} รายการ (${scopeSummary}) จากกลุ่ม “${state.group.name}” ข้อมูลที่ลบแล้วจะกู้คืนไม่ได้`;
  showMessage("#deleteConfirmError", "");
  closeDialog("resetDialog");
  openDialog("deleteConfirmDialog");
}

async function confirmSelectedDeletion() {
  const pending = state.pendingDeletion;
  if (!pending) return;
  if (state.group?.id !== pending.groupId) {
    state.pendingDeletion = null;
    closeDialog("deleteConfirmDialog");
    toast("กลุ่มที่เลือกเปลี่ยนไปแล้ว กรุณาเลือกข้อมูลที่จะลบอีกครั้ง");
    return;
  }

  const button = $("#confirmDeleteButton");
  button.disabled = true;
  showMessage("#deleteConfirmError", "");
  try {
    if (state.localMode) {
      const selectedIds = new Set(pending.entryIds);
      const previousEntries = state.localData.entries;
      state.localData.entries = previousEntries.filter(
        (entry) => entry.group_id !== pending.groupId || !selectedIds.has(entry.id),
      );
      try {
        saveLocalData();
      } catch (error) {
        state.localData.entries = previousEntries;
        throw error;
      }
    } else {
      const { error } = await supabase
        .from("ledger_entries")
        .delete()
        .eq("group_id", pending.groupId)
        .in("id", pending.entryIds);
      if (error) throw error;
    }

    state.pendingDeletion = null;
    closeDialog("deleteConfirmDialog");
    toast(`ลบ ${pending.entryIds.length} รายการแล้ว`);
    await loadGroupData();
  } catch (error) {
    showMessage("#deleteConfirmError", `ลบรายการไม่สำเร็จ: ${displayError(error)}`, true);
  } finally {
    button.disabled = false;
  }
}

async function createGroup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = $("#groupNameInput").value.trim();
  if (!name) return showMessage("#groupError", "กรุณาระบุชื่อกลุ่ม", true);
  setBusy(form, true, "กำลังสร้าง...");
  showMessage("#groupError", "");
  if (state.localMode) {
    try {
      const group = {
        id: crypto.randomUUID(),
        name,
        role: "owner",
        created_at: new Date().toISOString(),
      };
      state.localData.groups.push(group);
      saveLocalData();
      closeDialog("groupDialog");
      $("#groupForm").reset();
      await loadGroups(group.id);
      toast("สร้างกลุ่มในเครื่องแล้ว");
    } catch (error) {
      showMessage("#groupError", displayError(error), true);
    } finally {
      setBusy(form, false, "");
    }
    return;
  }

  const { data, error } = await supabase
    .from("groups")
    .insert({ name, created_by: state.user.id })
    .select("id")
    .single();
  setBusy(form, false, "");
  if (error) {
    showMessage("#groupError", displayError(error), true);
    return;
  }
  closeDialog("groupDialog");
  $("#groupForm").reset();
  await loadGroups(data.id);
  toast("สร้างกลุ่มเรียบร้อย");
}

async function createInvite(event) {
  event.preventDefault();
  if (state.localMode) {
    showMessage("#inviteError", "การเชิญสมาชิกต้องตั้งค่า Supabase เพื่อแชร์ข้อมูลข้ามอุปกรณ์", true);
    return;
  }
  const button = $("#createInviteButton");
  button.disabled = true;
  button.textContent = "กำลังสร้าง...";
  showMessage("#inviteError", "");
  $("#inviteLinkBox").hidden = true;
  try {
    const { data, error } = await supabase.rpc("create_group_invite", {
      p_group_id: state.group.id,
    });
    if (error) throw error;
    const link = new URL(location.href);
    link.search = "";
    link.hash = "";
    link.searchParams.set("invite", data);
    $("#inviteLink").value = link.toString();
    $("#inviteLinkBox").hidden = false;
  } catch (error) {
    showMessage("#inviteError", displayError(error), true);
  } finally {
    button.disabled = false;
    button.textContent = "สร้างลิงก์เชิญ";
  }
}

async function manageMember(member) {
  const name = member.profiles?.display_name || "สมาชิก";
  const canChangeRole = getGroupRole() === "owner";
  const newRole = member.role === "admin" ? "member" : "admin";
  const promptText = canChangeRole
    ? `จัดการ ${name}\nพิมพ์ "${newRole}" เพื่อเปลี่ยนบทบาท หรือ "remove" เพื่อนำออก`
    : `นำ ${name} ออกจากกลุ่มหรือไม่? พิมพ์ "remove" เพื่อยืนยัน`;
  const action = prompt(promptText);
  if (!action) return;
  const normalizedAction = action.trim().toLowerCase();
  let nextRole = null;
  if (canChangeRole && normalizedAction === newRole) nextRole = newRole;
  else if (normalizedAction !== "remove") {
    showMessage("#membersError", "คำสั่งไม่ถูกต้อง", true);
    return;
  }
  const { error } = await supabase.rpc("manage_group_member", {
    p_group_id: state.group.id,
    p_user_id: member.user_id,
    p_role: nextRole,
  });
  if (error) {
    showMessage("#membersError", displayError(error), true);
    return;
  }
  showMessage("#membersError", "");
  await loadGroupData();
  toast(nextRole ? "ปรับบทบาทสมาชิกแล้ว" : "นำสมาชิกออกจากกลุ่มแล้ว");
}

async function renameGroup(event) {
  event.preventDefault();
  const name = $("#renameGroupInput").value.trim();
  if (!name) return showMessage("#renameError", "กรุณาระบุชื่อกลุ่ม", true);
  if (state.localMode) {
    try {
      const group = state.localData.groups.find((item) => item.id === state.group.id);
      if (!group) throw new Error("ไม่พบกลุ่มที่ต้องการแก้ไข");
      group.name = name;
      saveLocalData();
      closeDialog("renameDialog");
      await loadGroups(group.id);
      toast("เปลี่ยนชื่อกลุ่มแล้ว");
    } catch (error) {
      showMessage("#renameError", displayError(error), true);
    }
    return;
  }

  const { error } = await supabase
    .from("groups")
    .update({ name })
    .eq("id", state.group.id);
  if (error) {
    showMessage("#renameError", displayError(error), true);
    return;
  }
  closeDialog("renameDialog");
  await loadGroups(state.group.id);
  toast("เปลี่ยนชื่อกลุ่มแล้ว");
}

async function copyInviteLink() {
  try {
    await navigator.clipboard.writeText($("#inviteLink").value);
    toast("คัดลอกลิงก์แล้ว");
  } catch (error) {
    $("#inviteLink").select();
    const copied = document.execCommand("copy");
    if (!copied) {
      showMessage("#inviteError", `คัดลอกไม่สำเร็จ: ${displayError(error)}`, true);
      return;
    }
    toast("คัดลอกลิงก์แล้ว");
  }
}

function setupEvents() {
  $("#startButton").addEventListener("click", startUsing);
  $("#groupSelect").addEventListener("change", () => loadGroups($("#groupSelect").value));
  $("#createGroupButton").addEventListener("click", () => openDialog("groupDialog"));
  $("#emptyCreateGroupButton").addEventListener("click", () => openDialog("groupDialog"));
  $("#groupForm").addEventListener("submit", createGroup);
  $("#addEntryButton").addEventListener("click", () => openEntryDialog());
  $("#firstEntryButton").addEventListener("click", () => openEntryDialog());
  $("#createSavingsJarButton").addEventListener("click", () => openSavingsJarDialog());
  $("#retrySavingsButton").addEventListener("click", loadGroupData);
  $("#savingsJarForm").addEventListener("submit", saveSavingsJar);
  $("#savingsTransactionForm").addEventListener("submit", saveSavingsTransaction);
  $("#resetDashboardButton").addEventListener("click", openResetDialog);
  $("#resetForm").addEventListener("submit", requestSelectedDeletion);
  $("#resetManualSelection").addEventListener("change", (event) => {
    const manualCheckbox = event.currentTarget;
    if (manualCheckbox.checked) {
      document.querySelectorAll(".reset-scope").forEach((checkbox) => {
        checkbox.checked = false;
        checkbox.closest(".reset-option").classList.remove("is-selected");
      });
    }
    manualCheckbox.closest(".reset-option").classList.toggle("is-selected", manualCheckbox.checked);
    state.resetSelectedEntryIds = new Set();
    updateResetSelection();
  });
  document.querySelectorAll(".reset-scope").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const checkboxes = [...document.querySelectorAll(".reset-scope")];
      const manualCheckbox = $("#resetManualSelection");
      if (checkbox.value === "all" && checkbox.checked) {
        checkboxes.filter((item) => item !== checkbox).forEach((item) => {
          item.checked = false;
          item.closest(".reset-option").classList.remove("is-selected");
        });
      } else if (checkbox.value !== "all" && checkbox.checked) {
        const allCheckbox = checkboxes.find((item) => item.value === "all");
        allCheckbox.checked = false;
        allCheckbox.closest(".reset-option").classList.remove("is-selected");
      }
      if (checkbox.checked) {
        manualCheckbox.checked = false;
        manualCheckbox.closest(".reset-option").classList.remove("is-selected");
      }
      checkbox.closest(".reset-option").classList.toggle("is-selected", checkbox.checked);
      state.resetSelectedEntryIds = new Set(
        entriesInDeletionScopes(selectedDeletionScopes()).map((entry) => entry.id),
      );
      updateResetSelection();
    });
  });
  $("#resetPreviewItems").addEventListener("change", (event) => {
    const checkbox = event.target.closest(".reset-entry-checkbox");
    if (!checkbox) return;
    if (checkbox.checked) state.resetSelectedEntryIds.add(checkbox.value);
    else state.resetSelectedEntryIds.delete(checkbox.value);
    updateResetSelection();
  });
  $("#cancelDeleteConfirmButton").addEventListener("click", () => {
    state.pendingDeletion = null;
    closeDialog("deleteConfirmDialog");
  });
  $("#deleteConfirmDialog").addEventListener("close", () => {
    state.pendingDeletion = null;
  });
  $("#confirmDeleteButton").addEventListener("click", confirmSelectedDeletion);
  $("#resetEntryButton").addEventListener("click", resetEntryForm);
  $("#entryForm").addEventListener("submit", saveEntry);
  document.querySelectorAll("[data-add-choice]").forEach((button) => {
    button.addEventListener("click", () => openQuickChoiceDialog(button.dataset.addChoice));
  });
  $("#quickChoiceForm").addEventListener("submit", saveQuickChoice);
  $("#typeFilter").addEventListener("change", renderEntries);
  document.querySelectorAll(".type-option").forEach((button) => {
    button.addEventListener("click", () => {
      state.entryType = button.dataset.type;
      document.querySelectorAll(".type-option").forEach((option) => {
        option.classList.toggle("selected", option === button);
      });
      renderEntryQuickChoices();
    });
  });
  ["#entryDescription", "#entrySpentBy", "#entryAmount"].forEach((selector) => {
    $(selector).addEventListener("input", renderEntryQuickChoices);
  });
  $("#entryCategory").addEventListener("change", renderEntryQuickChoices);
  $("#inviteButton").addEventListener("click", () => {
    $("#inviteLinkBox").hidden = true;
    showMessage("#inviteError", "");
    openDialog("inviteDialog");
  });
  $("#inviteForm").addEventListener("submit", createInvite);
  $("#copyInviteButton").addEventListener("click", copyInviteLink);
  $("#membersButton").addEventListener("click", () => {
    showMessage("#membersError", "");
    openDialog("membersDialog");
  });
  $("#membersInviteButton").addEventListener("click", () => {
    closeDialog("membersDialog");
    $("#inviteLinkBox").hidden = true;
    showMessage("#inviteError", "");
    openDialog("inviteDialog");
  });
  $("#renameGroupButton").addEventListener("click", () => {
    $("#renameGroupInput").value = state.group?.name || "";
    showMessage("#renameError", "");
    openDialog("renameDialog");
  });
  $("#renameForm").addEventListener("submit", renameGroup);
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(button.dataset.close));
  });
}

async function startUsing() {
  const button = $("#startButton");
  button.disabled = true;
  button.textContent = "กำลังเตรียมบัญชี...";
  $("#bootIndicator").hidden = false;
  showMessage("#authMessage", supabase ? "กำลังเชื่อมต่ออย่างปลอดภัย..." : "กำลังเปิดโหมดทดลอง...");
  try {
    if (!supabase) {
      await startLocalMode();
      return;
    }

    const inviteCode = new URLSearchParams(location.search).get("invite");
    if (inviteCode) localStorage.setItem("pending-group-invite", inviteCode);
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session) await handleAuthChange("INITIAL_SESSION", data.session);
    else await createGuestSession();
    supabase.auth.onAuthStateChange((event, session) => {
      queueMicrotask(() => {
        handleAuthChange(event, session).catch((authError) => {
          console.error(authError);
          setAuthView(false);
          $("#bootIndicator").hidden = true;
          showMessage("#authMessage", `เริ่มต้นแอปไม่สำเร็จ: ${displayError(authError)}`, true);
        });
      });
    });
  } catch (error) {
    console.error(error);
    setAuthView(false);
    $("#bootIndicator").hidden = true;
    button.disabled = false;
    button.textContent = "เริ่มใช้งานเลย →";
    showMessage("#authMessage", `เข้าใช้งานไม่สำเร็จ: ${displayError(error)}`, true);
  }
}

async function start() {
  setupEvents();
  $("#configWarning").hidden = hasConfig;
  if (hasConfig) {
    try {
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
      supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    } catch (error) {
      console.error(error);
      $("#configWarning").hidden = false;
      showMessage("#authMessage", `โหลดระบบซิงก์ออนไลน์ไม่สำเร็จ: ${displayError(error)} ใช้โหมดในเครื่องได้`, true);
      return;
    }
  }
  if (!hasConfig) {
    showMessage("#authMessage", "กดปุ่มเพื่อเริ่มใช้ในเครื่องนี้ได้เลย");
  }
}

start().catch((error) => {
  console.error(error);
  showMessage("#authMessage", `เริ่มต้นแอปไม่สำเร็จ: ${displayError(error)}`, true);
});
