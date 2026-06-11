import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import { ref, onValue, set, push, serverTimestamp } from "firebase/database";

// ── 車両定義
const DEFAULT_VEHICLES = [
  { id: "amb1", label: "救急車", icon: "🚑", color: "#f97316", bg: "#fff7ed", type: "ambulance" },
  { id: "doc1", label: "ドクターカー", icon: "🚗", color: "#a855f7", bg: "#faf5ff", type: "doctor" },
];

const VEHICLE_ACTIONS = {
  ambulance: [
    { id: "amb_transport",  label: "搬送開始", icon: "🏥", color: "#ef4444", nextStatus: "TRANSPORTING" },
    { id: "amb_hosp_arr",   label: "病院到着", icon: "🏨", color: "#8b5cf6", nextStatus: "TRANSPORTING" },
    { id: "amb_returning",  label: "帰院開始", icon: "↩️",  color: "#3b82f6", nextStatus: "RETURNING" },
    { id: "amb_standby",    label: "帰院",     icon: "✅", color: "#16a34a", nextStatus: "STANDBY" },
  ],
  doctor: [
    { id: "doc_pre_dispatch", label: "出場予告", icon: "📢", color: "#f97316", nextStatus: "DISPATCHED" },
    { id: "doc_dispatch",     label: "出場",     icon: "🚗", color: "#a855f7", nextStatus: "DISPATCHED" },
    { id: "doc_scene_arr",    label: "現場到着", icon: "📍", color: "#f97316", nextStatus: "DISPATCHED" },
    { id: "doc_transport",    label: "搬送開始", icon: "🏥", color: "#ef4444", nextStatus: "TRANSPORTING" },
    { id: "doc_hosp_arr",     label: "病院到着", icon: "🏨", color: "#3b82f6", nextStatus: "RETURNING" },
    { id: "doc_returning",    label: "帰院開始", icon: "↩️",  color: "#3b82f6", nextStatus: "RETURNING" },
    { id: "doc_standby",      label: "帰院",     icon: "✅", color: "#16a34a", nextStatus: "STANDBY" },
  ],
};
const ALL_ACTIONS = [...VEHICLE_ACTIONS.ambulance, ...VEHICLE_ACTIONS.doctor];

const STATUS = {
  STANDBY:      { label: "待機中", color: "#16a34a", bg: "#f0fdf4" },
  DISPATCHED:   { label: "出動中", color: "#f97316", bg: "#fff7ed" },
  TRANSPORTING: { label: "搬送中", color: "#ef4444", bg: "#fef2f2" },
  RETURNING:    { label: "帰院中", color: "#3b82f6", bg: "#eff6ff" },
  UNAVAILABLE:  { label: "不在",   color: "#9ca3af", bg: "#f9fafb" },
};

const ACTIVE_STATUSES = ["DISPATCHED", "TRANSPORTING"];

const DEFAULT_MEMBERS = [
  { id: 1, name: "田中 隊長",     role: "救急救命士", avatar: "田", vehicleId: "amb1" },
  { id: 2, name: "佐藤 隊員",     role: "救急救命士", avatar: "佐", vehicleId: "amb1" },
  { id: 3, name: "鈴木 隊員",     role: "救急救命士", avatar: "鈴", vehicleId: "amb1" },
  { id: 4, name: "高橋 ドクター", role: "医師",       avatar: "高", vehicleId: "doc1" },
  { id: 5, name: "伊藤 看護師",   role: "看護師",     avatar: "伊", vehicleId: "doc1" },
  { id: 6, name: "控え 隊員",     role: "救急救命士", avatar: "控", vehicleId: null },
];

const ROLES = ["医師", "研修医", "看護師", "救急救命士", "その他"];

const ALARM_TYPES = [
  { id: "beep",   label: "ピンポンパン",   desc: "短いビープ音×3" },
  { id: "siren",  label: "サイレン",       desc: "ウーウー上下" },
  { id: "urgent", label: "緊急アラート",   desc: "高速ビープ" },
  { id: "red",    label: "レッドアラート", desc: "低音＋高音の交互" },
  { id: "alarm",  label: "防災警報風",     desc: "消防サイレン風" },
  { id: "yelp",   label: "イエルプ",       desc: "" },
  { id: "tfd",    label: "ピーポーピーポー", desc: "" },
];

function timeStr() {
  return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}
function datStr() {
  return new Date().toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit", weekday: "short" });
}
function mapsUrl(loc) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`;
}

export default function App() {
  const [tab, setTab]             = useState("home");
  const [chatVehicle, setChatVehicle] = useState("amb1");
  const [vehicles, setVehicles]   = useState(DEFAULT_VEHICLES);
  const [vehicleStatuses, setVehicleStatuses] = useState({ amb1: "STANDBY", doc1: "STANDBY" });
  const [members, setMembers]     = useState(DEFAULT_MEMBERS);
  const [messages, setMessages]   = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [modalVehicleId, setModalVehicleId] = useState(null);
  const [selectedType, setSelectedType]     = useState(null);
  const [dispatchNote, setDispatchNote]     = useState("");
  const [dispatchLocation, setDispatchLocation] = useState("");
  const [locationLoading, setLocationLoading]   = useState(false);
  const [pulse, setPulse]         = useState(false);
  const [alert, setAlert]         = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [editForm, setEditForm]   = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [assigningMember, setAssigningMember] = useState(null);
  const [alarmType, setAlarmType] = useState("beep");
  const chatRef    = useRef(null);
  const audioCtx   = useRef(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const alertTimer = useRef(null);
  const dragItem   = useRef(null);
  const dragOver   = useRef(null);

  // ── Firebase リアルタイム同期
  useEffect(() => {
    // 車両ステータス
    const statusRef = ref(db, "vehicleStatuses");
    const unsubStatus = onValue(statusRef, snap => {
      if (snap.exists()) setVehicleStatuses(snap.val());
      else set(statusRef, { amb1: "STANDBY", doc1: "STANDBY" });
    });
    // メンバー
    const membersRef = ref(db, "members");
    const unsubMembers = onValue(membersRef, snap => {
      if (snap.exists()) setMembers(Object.values(snap.val()).map(m => ({ ...m, vehicleId: m.vehicleId === "none" ? null : (m.vehicleId || null) })));
      else set(membersRef, Object.fromEntries(DEFAULT_MEMBERS.map(m => [m.id, m])));
    });
    // メッセージ
    const messagesRef = ref(db, "messages");
    const unsubMessages = onValue(messagesRef, snap => {
      if (snap.exists()) {
        const msgs = Object.values(snap.val()).sort((a, b) => (a.ts || 0) - (b.ts || 0));
        setMessages(msgs);
      }
    });
    // 車両順序
    const vehiclesRef = ref(db, "vehicles");
    const unsubVehicles = onValue(vehiclesRef, snap => {
      if (snap.exists()) setVehicles(snap.val());
      else set(vehiclesRef, DEFAULT_VEHICLES);
    });
    // 出場予告アラートフラグ監視（stateの更新のみ）
    const alertRef = ref(db, "alertFlag");
    const unsubAlert = onValue(alertRef, snap => {
      if (snap.exists()) {
        setAlert(snap.val().active === true);
      }
    });
    return () => { unsubStatus(); unsubMembers(); unsubMessages(); unsubVehicles(); unsubAlert(); };
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, tab, chatVehicle]);

  useEffect(() => {
    const t = setInterval(() => setPulse(p => !p), 1500);
    return () => clearInterval(t);
  }, []);

  // alertがfalseになったらタイマーを確実に止める
  useEffect(() => {
    if (!alert) {
      if (alertTimer.current) { clearInterval(alertTimer.current); alertTimer.current = null; }
    }
  }, [alert]);

  // ── Firebase 書き込み関数
  function fbSetVehicleStatus(vehicleId, status) {
    set(ref(db, `vehicleStatuses/${vehicleId}`), status);
  }
  function fbSetMembers(newMembers) {
    // nullはFirebaseに保存できないので"none"に変換
    const data = Object.fromEntries(newMembers.map(m => [
      m.id, { ...m, vehicleId: m.vehicleId === null ? "none" : m.vehicleId }
    ]));
    set(ref(db, "members"), data);
  }
  function toMember(m) {
    return { ...m, vehicleId: m.vehicleId === "none" ? null : m.vehicleId };
  }
  function fbPushMessage(msg) {
    push(ref(db, "messages"), { ...msg, ts: Date.now() });
  }
  function fbSetVehicles(newVehicles) {
    set(ref(db, "vehicles"), newVehicles);
  }

  function handleDragStart(index) { dragItem.current = index; }
  function handleDragEnter(index) { dragOver.current = index; }
  function handleDragEnd() {
    const newVehicles = [...vehicles];
    const dragged = newVehicles.splice(dragItem.current, 1)[0];
    newVehicles.splice(dragOver.current, 0, dragged);
    fbSetVehicles(newVehicles);
    dragItem.current = null; dragOver.current = null;
  }
  function assignMember(memberId, vehicleId) {
    const newMembers = members.map(m => m.id === memberId ? { ...m, vehicleId } : m);
    fbSetMembers(newMembers);
    setAssigningMember(null);
  }

  function enableAudio() {
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.current.resume().then(() => {
        setAudioEnabled(true);
        const ctx = audioCtx.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        osc.start(); osc.stop(ctx.currentTime + 0.001);
      });
    } catch(e) {}
  }

  function getAlarmDuration() {
    const d = { beep: 900, siren: 1800, urgent: 950, red: 1650, alarm: 1800, yelp: 1450, tfd: 2150 };
    return (d[alarmType] || 1500) + 500;
  }

  function playAlertSound() {
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx.current;
      const now = ctx.currentTime;
      if (alarmType === "beep") {
        [0, 0.3, 0.6].forEach(offset => {
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = "square";
          osc.frequency.setValueAtTime(880, now + offset);
          osc.frequency.setValueAtTime(660, now + offset + 0.15);
          gain.gain.setValueAtTime(0.4, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.28);
          osc.start(now + offset); osc.stop(now + offset + 0.28);
        });
      } else if (alarmType === "siren") {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(800, now + 0.5);
        osc.frequency.linearRampToValueAtTime(400, now + 1.0);
        osc.frequency.linearRampToValueAtTime(800, now + 1.5);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
        osc.start(now); osc.stop(now + 1.8);
      } else if (alarmType === "urgent") {
        for (let i = 0; i < 6; i++) {
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = "square";
          osc.frequency.setValueAtTime(1200, now + i * 0.15);
          gain.gain.setValueAtTime(0.3, now + i * 0.15);
          gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.1);
          osc.start(now + i * 0.15); osc.stop(now + i * 0.15 + 0.1);
        }
      } else if (alarmType === "red") {
        for (let i = 0; i < 4; i++) {
          const offset = i * 0.4;
          const osc1 = ctx.createOscillator(); const gain1 = ctx.createGain();
          osc1.connect(gain1); gain1.connect(ctx.destination);
          osc1.type = "sawtooth"; osc1.frequency.setValueAtTime(220, now + offset);
          gain1.gain.setValueAtTime(0.5, now + offset);
          gain1.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.18);
          osc1.start(now + offset); osc1.stop(now + offset + 0.18);
          const osc2 = ctx.createOscillator(); const gain2 = ctx.createGain();
          osc2.connect(gain2); gain2.connect(ctx.destination);
          osc2.type = "sawtooth"; osc2.frequency.setValueAtTime(880, now + offset + 0.2);
          gain2.gain.setValueAtTime(0.5, now + offset + 0.2);
          gain2.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.38);
          osc2.start(now + offset + 0.2); osc2.stop(now + offset + 0.38);
        }
      } else if (alarmType === "alarm") {
        for (let i = 0; i < 2; i++) {
          const offset = i * 0.9;
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(300, now + offset);
          osc.frequency.linearRampToValueAtTime(1100, now + offset + 0.35);
          osc.frequency.linearRampToValueAtTime(300, now + offset + 0.7);
          gain.gain.setValueAtTime(0, now + offset);
          gain.gain.linearRampToValueAtTime(0.5, now + offset + 0.05);
          gain.gain.setValueAtTime(0.5, now + offset + 0.65);
          gain.gain.linearRampToValueAtTime(0, now + offset + 0.75);
          osc.start(now + offset); osc.stop(now + offset + 0.8);
        }
      } else if (alarmType === "yelp") {
        for (let i = 0; i < 4; i++) {
          const offset = i * 0.35;
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(600, now + offset);
          osc.frequency.linearRampToValueAtTime(1400, now + offset + 0.15);
          osc.frequency.linearRampToValueAtTime(600, now + offset + 0.3);
          gain.gain.setValueAtTime(0, now + offset);
          gain.gain.linearRampToValueAtTime(0.5, now + offset + 0.02);
          gain.gain.setValueAtTime(0.5, now + offset + 0.28);
          gain.gain.linearRampToValueAtTime(0, now + offset + 0.32);
          osc.start(now + offset); osc.stop(now + offset + 0.35);
        }
      } else if (alarmType === "tfd") {
        for (let i = 0; i < 3; i++) {
          const offset = i * 0.7;
          const osc1 = ctx.createOscillator(); const gain1 = ctx.createGain();
          osc1.connect(gain1); gain1.connect(ctx.destination);
          osc1.type = "sine"; osc1.frequency.setValueAtTime(960, now + offset);
          gain1.gain.setValueAtTime(0, now + offset);
          gain1.gain.linearRampToValueAtTime(0.5, now + offset + 0.03);
          gain1.gain.setValueAtTime(0.5, now + offset + 0.3);
          gain1.gain.linearRampToValueAtTime(0, now + offset + 0.33);
          osc1.start(now + offset); osc1.stop(now + offset + 0.35);
          const osc2 = ctx.createOscillator(); const gain2 = ctx.createGain();
          osc2.connect(gain2); gain2.connect(ctx.destination);
          osc2.type = "sine"; osc2.frequency.setValueAtTime(770, now + offset + 0.35);
          gain2.gain.setValueAtTime(0, now + offset + 0.35);
          gain2.gain.linearRampToValueAtTime(0.5, now + offset + 0.38);
          gain2.gain.setValueAtTime(0.5, now + offset + 0.65);
          gain2.gain.linearRampToValueAtTime(0, now + offset + 0.68);
          osc2.start(now + offset + 0.35); osc2.stop(now + offset + 0.7);
        }
      }
    } catch(e) {}
  }

  function startAlert() {
    set(ref(db, "alertFlag"), { active: true, ts: Date.now() });
    try {
      if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.current.resume().then(() => {
        setAlert(true);
        setTimeout(() => {
          playAlertSound();
          if (alertTimer.current) clearInterval(alertTimer.current);
          alertTimer.current = setInterval(() => playAlertSound(), getAlarmDuration());
        }, 50);
      });
    } catch(e) {
      setAlert(true);
    }
  }
  function stopAlert() {
    setAlert(false);
    if (alertTimer.current) { clearInterval(alertTimer.current); alertTimer.current = null; }
    // AudioContextを一時停止して音を強制停止
    try {
      if (audioCtx.current) audioCtx.current.suspend();
    } catch(e) {}
  }

  function closeModal() {
    setShowModal(false); setSelectedType(null);
    setDispatchNote(""); setDispatchLocation(""); setLocationLoading(false);
  }

  function getCurrentLocation() {
    if (!navigator.geolocation) { alert("位置情報がこのブラウザでは使えません"); return; }
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        setDispatchLocation(`${latitude.toFixed(6)},${longitude.toFixed(6)}`);
        setLocationLoading(false);
      },
      () => { alert("位置情報の取得に失敗しました。"); setLocationLoading(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function sendDispatch(typeId) {
    const action  = ALL_ACTIONS.find(a => a.id === typeId);
    const vehicle = vehicles.find(v => v.id === modalVehicleId);
    const loc  = dispatchLocation.trim();
    const note = dispatchNote.trim();
    const text = `${vehicle.icon} ${vehicle.label}　${action.label}` + (loc ? `：${loc}` : "") + (note ? `　${note}` : "");
    fbSetVehicleStatus(modalVehicleId, action.nextStatus);
    fbPushMessage({ vehicleId: modalVehicleId, type: typeId, text, location: loc || null, time: timeStr(), date: datStr() });
    if (typeId === "doc_pre_dispatch") startAlert();
    closeModal();
    setChatVehicle(modalVehicleId);
    setTab("chat");
  }

  function sendChat() {
    if (!chatInput.trim()) return;
    fbPushMessage({ vehicleId: chatVehicle, type: "chat", text: chatInput.trim(), time: timeStr(), date: datStr(), location: null });
    setChatInput("");
  }

  function MapBtn({ location, small }) {
    if (!location) return null;
    return (
      <a href={mapsUrl(location)} target="_blank" rel="noopener noreferrer" style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        marginTop: small ? 3 : 6, padding: small ? "2px 8px" : "4px 10px",
        borderRadius: 20, background: "#f0fdf4", border: "1px solid #86efac",
        color: "#16a34a", fontSize: small ? 10 : 11, fontWeight: 700, textDecoration: "none"
      }}>🗺 {small ? "マップ" : "Googleマップで開く"}</a>
    );
  }

  const chatMessages = messages.filter(m => m.vehicleId === chatVehicle);
  const ambDispatched = vehicles.filter(v => v.type === "ambulance" && ACTIVE_STATUSES.includes(vehicleStatuses[v.id])).length;
  const docDispatched = vehicles.filter(v => v.type === "doctor"    && ACTIVE_STATUSES.includes(vehicleStatuses[v.id])).length;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", color: "#1e293b", fontFamily: "'Noto Sans JP','Hiragino Sans',sans-serif", display: "flex", flexDirection: "column", maxWidth: 430, margin: "0 auto" }}>

      {/* 音を有効にするバナー */}
      {!audioEnabled && (
        <div style={{
          position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)",
          width: "100%", maxWidth: 430, zIndex: 300,
          background: "#f97316", padding: "10px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)"
        }}>
          <span style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>🔔 出場予告の音を受信するには音を有効にしてください</span>
          <button onClick={enableAudio} style={{
            background: "#fff", color: "#f97316", border: "none",
            borderRadius: 20, padding: "5px 12px", cursor: "pointer",
            fontSize: 12, fontWeight: 800, flexShrink: 0, marginLeft: 8
          }}>有効にする</button>
        </div>
      )}

      {alert && (
        <div onClick={stopAlert} style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", animation: "flash 0.5s infinite" }}>
          <style>{`@keyframes flash { 0%,100%{background:rgba(249,115,22,0.92)} 50%{background:rgba(239,68,68,0.95)} }`}</style>
          <div style={{ fontSize: 64, marginBottom: 16 }}>📢</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", letterSpacing: 2, marginBottom: 8 }}>出場予告</div>
          <div style={{ fontSize: 15, color: "#fff", opacity: 0.9, marginBottom: 40 }}>ドクターカー出場予告が発令されました</div>
          <div style={{ background: "#fff", color: "#f97316", fontWeight: 800, fontSize: 16, padding: "14px 40px", borderRadius: 40 }}>タップして閉じる</div>
        </div>
      )}

      {/* Header */}
      <div style={{ padding: "14px 18px 10px", background: "#ffffff", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>🆘</span>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1, color: "#1e293b" }}>Call7000</div>
              <div style={{ fontSize: 9, color: "#94a3b8", letterSpacing: 2 }}>EMERGENCY COMM</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {ambDispatched > 0 && <div style={{ background: "#f97316", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff", opacity: pulse ? 1 : 0.3, transition: "opacity 0.3s", display: "inline-block" }} />🚑 出動中</div>}
            {docDispatched > 0 && <div style={{ background: "#a855f7", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff", opacity: pulse ? 1 : 0.3, transition: "opacity 0.3s", display: "inline-block" }} />🚗 出動中</div>}
            {vehicles.every(v => !ACTIVE_STATUSES.includes(vehicleStatuses[v.id]) && vehicleStatuses[v.id] !== "RETURNING") && <div style={{ background: "#f0fdf4", color: "#16a34a", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, border: "1px solid #86efac" }}>✅ 待機中</div>}
            {vehicles.some(v => vehicleStatuses[v.id] === "RETURNING") && vehicles.filter(v => vehicleStatuses[v.id] === "RETURNING").map(v => <div key={v.id} style={{ background: "#eff6ff", color: "#3b82f6", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, border: "1px solid #bfdbfe" }}>{v.icon} 帰院中</div>)}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>

        {/* HOME */}
        {tab === "home" && (
          <div style={{ padding: "18px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 2, fontWeight: 600 }}>車両ステータス</div>
              <div style={{ fontSize: 10, color: "#cbd5e1" }}>⠿ ドラッグで並び替え</div>
            </div>
            {vehicles.map((v, idx) => {
              const st      = STATUS[vehicleStatuses[v.id]] || STATUS.STANDBY;
              const crew    = members.filter(m => m.vehicleId === v.id);
              const actions = VEHICLE_ACTIONS[v.type];
              return (
                <div key={v.id} draggable onDragStart={() => handleDragStart(idx)} onDragEnter={() => handleDragEnter(idx)} onDragEnd={handleDragEnd} onDragOver={e => e.preventDefault()}
                  style={{ background: "#ffffff", border: `1px solid ${v.color}30`, borderRadius: 16, padding: "16px", marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", cursor: "grab" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 24 }}>{v.icon}</span>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "#1e293b" }}>{v.label}</div>
                        <div style={{ fontSize: 10, color: "#94a3b8" }}>乗務員 {crew.length}名</div>
                      </div>
                    </div>
                    <div style={{ background: st.bg, color: st.color, fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 20, border: `1px solid ${st.color}30`, display: "flex", alignItems: "center", gap: 4 }}>
                      {ACTIVE_STATUSES.includes(vehicleStatuses[v.id]) && <span style={{ width: 5, height: 5, borderRadius: "50%", background: st.color, opacity: pulse ? 1 : 0.3, transition: "opacity 0.3s", display: "inline-block" }} />}
                      {st.label}
                    </div>
                  </div>
                  {crew.length > 0 && (
                    <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                      {crew.map(m => (
                        <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 5, background: v.bg, border: `1px solid ${v.color}30`, borderRadius: 20, padding: "4px 10px" }}>
                          <div style={{ width: 22, height: 22, borderRadius: "50%", background: v.color + "30", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: v.color }}>{m.avatar}</div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#334155" }}>{m.name}</span>
                          <span style={{ fontSize: 10, color: "#94a3b8" }}>{m.role}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {actions.map(action => (
                      <button key={action.id} onClick={() => { setModalVehicleId(v.id); setSelectedType(action.id); setShowModal(true); }}
                        style={{ background: `${action.color}10`, border: `1.5px solid ${action.color}40`, borderRadius: 12, padding: "11px 8px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                        onMouseDown={e => e.currentTarget.style.transform = "scale(0.95)"}
                        onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}>
                        <span style={{ fontSize: 20 }}>{action.icon}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: action.color, textAlign: "left", lineHeight: 1.3 }}>{action.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {messages.length > 0 && (
              <>
                <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 2, marginBottom: 10, fontWeight: 600, marginTop: 4 }}>最新連絡</div>
                {[...messages].reverse().slice(0, 3).map(msg => {
                  const action  = ALL_ACTIONS.find(a => a.id === msg.type);
                  const vehicle = vehicles.find(v => v.id === msg.vehicleId);
                  return (
                    <div key={msg.id} style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 12px", marginBottom: 7, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                        <span style={{ fontSize: 11, color: action ? action.color : "#64748b", fontWeight: 700 }}>{vehicle?.icon} {action?.label || "メッセージ"}</span>
                        <span style={{ fontSize: 9, color: "#94a3b8" }}>{msg.time}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>{msg.text}</div>
                      <MapBtn location={msg.location} small />
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* CHAT */}
        {tab === "chat" && (
          <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 148px)" }}>
            <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", background: "#ffffff" }}>
              {vehicles.map(v => (
                <button key={v.id} onClick={() => setChatVehicle(v.id)} style={{ flex: 1, padding: "10px 6px", cursor: "pointer", border: "none", background: "transparent", borderBottom: chatVehicle === v.id ? `2px solid ${v.color}` : "2px solid transparent", fontSize: 12, fontWeight: 700, color: chatVehicle === v.id ? v.color : "#94a3b8" }}>{v.icon} {v.label}</button>
              ))}
            </div>
            <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: "14px", background: "#f8fafc" }}>
              {chatMessages.length === 0 && <div style={{ textAlign: "center", color: "#cbd5e1", fontSize: 12, marginTop: 40 }}>まだメッセージはありません</div>}
              {chatMessages.map((msg, i) => {
                const action = ALL_ACTIONS.find(a => a.id === msg.type);
                const showDate = i === 0 || chatMessages[i-1].date !== msg.date;
                return (
                  <div key={msg.id || i}>
                    {showDate && <div style={{ textAlign: "center", fontSize: 9, color: "#94a3b8", margin: "6px 0" }}>{msg.date}</div>}
                    <div style={{ marginBottom: 9 }}>
                      <div style={{ background: msg.type !== "chat" ? (action ? `${action.color}12` : "#f1f5f9") : "#ffffff", border: `1px solid ${msg.type !== "chat" && action ? action.color + "30" : "#e2e8f0"}`, borderRadius: 12, padding: "9px 12px", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                        {msg.type !== "chat" && action && <div style={{ fontSize: 9, color: action.color, fontWeight: 700, marginBottom: 3 }}>{action.icon} {action.label}</div>}
                        <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.5 }}>{msg.text}</div>
                        <MapBtn location={msg.location} />
                      </div>
                      <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{msg.time}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "8px 10px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 7, background: "#ffffff" }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendChat()} placeholder={`${vehicles.find(v => v.id === chatVehicle)?.label}へ送信...`} style={{ flex: 1, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 22, padding: "9px 14px", color: "#1e293b", fontSize: 13, outline: "none" }} />
              <button onClick={sendChat} style={{ width: 38, height: 38, borderRadius: "50%", background: vehicles.find(v => v.id === chatVehicle)?.color || "#3b82f6", border: "none", cursor: "pointer", fontSize: 16, flexShrink: 0, color: "#fff" }}>↑</button>
            </div>
          </div>
        )}

        {/* HISTORY */}
        {tab === "history" && (
          <div style={{ padding: "18px 14px" }}>
            <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 2, marginBottom: 12, fontWeight: 600 }}>通知履歴</div>
            {[...messages].reverse().filter(m => m.type !== "chat").map((msg, i) => {
              const action  = ALL_ACTIONS.find(a => a.id === msg.type);
              const vehicle = vehicles.find(v => v.id === msg.vehicleId);
              return (
                <div key={msg.id || i} style={{ background: "#ffffff", border: `1px solid ${action?.color}20`, borderLeft: `3px solid ${action?.color || "#e2e8f0"}`, borderRadius: 10, padding: "11px 13px", marginBottom: 7, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: action?.color, fontWeight: 700 }}>{action?.icon} {action?.label}　{vehicle?.icon} {vehicle?.label}</span>
                    <span style={{ fontSize: 9, color: "#94a3b8" }}>{msg.date} {msg.time}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{msg.text}</div>
                  <MapBtn location={msg.location} small />
                </div>
              );
            })}
            {messages.filter(m => m.type !== "chat").length === 0 && <div style={{ textAlign: "center", color: "#cbd5e1", fontSize: 12, marginTop: 40 }}>履歴はありません</div>}
          </div>
        )}

        {/* SETTINGS */}
        {tab === "settings" && (
          <div style={{ padding: "18px 14px" }}>
            <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 2, marginBottom: 10, fontWeight: 600 }}>🔔 出場予告アラーム音</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
              {ALARM_TYPES.map(a => (
                <button key={a.id} onClick={() => { setAlarmType(a.id); try { if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.current.state === "suspended") audioCtx.current.resume(); } catch(e) {} setTimeout(() => playAlertSound(), 50); }}
                  style={{ background: alarmType === a.id ? "#eff6ff" : "#f8fafc", border: `1.5px solid ${alarmType === a.id ? "#3b82f6" : "#e2e8f0"}`, borderRadius: 12, padding: "10px", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: alarmType === a.id ? "#3b82f6" : "#334155", marginBottom: 2 }}>{a.label}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>{a.desc}</div>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 2, marginBottom: 4, fontWeight: 600 }}>乗務員配置</div>
            <div style={{ fontSize: 10, color: "#cbd5e1", marginBottom: 14 }}>「配置」ボタンで車両・控え室に移動</div>
            {[...vehicles, { id: null, label: "控え室", icon: "🏠", color: "#64748b", bg: "#f1f5f9" }].map(zone => (
              <div key={String(zone.id)} style={{ background: "#f8fafc", border: `2px dashed ${zone.color}40`, borderRadius: 14, padding: "12px", marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: zone.color, marginBottom: 8 }}>{zone.icon} {zone.label}</div>
                {members.filter(m => m.vehicleId === zone.id).map(member => {
                  const isEditing = editingMember === member.id;
                  return (
                    <div key={member.id} style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 12px", marginBottom: 7, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                      {!isEditing ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 34, height: 34, borderRadius: "50%", background: zone.color + "20", border: `2px solid ${zone.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: zone.color, flexShrink: 0 }}>{member.avatar}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>{member.name}</div>
                            <div style={{ fontSize: 10, color: "#94a3b8" }}>{member.role}</div>
                          </div>
                          <div style={{ display: "flex", gap: 5 }}>
                            <button onClick={() => setAssigningMember(member.id)} style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 11, color: "#3b82f6", fontWeight: 600 }}>配置</button>
                            <button onClick={() => { setEditingMember(member.id); setEditForm({ name: member.name, role: member.role }); }} style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 11, color: "#64748b", fontWeight: 600 }}>編集</button>
                            <button onClick={() => setConfirmDelete(member.id)} style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 7, padding: "4px 8px", cursor: "pointer", fontSize: 11, color: "#ef4444", fontWeight: 600 }}>削除</button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>名前</div>
                          <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} style={{ width: "100%", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "#1e293b", outline: "none", marginBottom: 7, boxSizing: "border-box" }} />
                          <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>役職</div>
                          <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))} style={{ width: "100%", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "#1e293b", outline: "none", marginBottom: 10, boxSizing: "border-box" }}>
                            {ROLES.map(r => <option key={r}>{r}</option>)}
                          </select>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => { const avatar = editForm.name.trim().charAt(0) || member.avatar; const newMembers = members.map(m => m.id === member.id ? { ...m, ...editForm, avatar } : m); fbSetMembers(newMembers); setEditingMember(null); }} style={{ flex: 1, background: "#3b82f6", border: "none", borderRadius: 8, padding: "8px", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#fff" }}>保存</button>
                            <button onClick={() => setEditingMember(null)} style={{ flex: 1, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px", cursor: "pointer", fontSize: 12, color: "#64748b" }}>キャンセル</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {members.filter(m => m.vehicleId === zone.id).length === 0 && <div style={{ textAlign: "center", fontSize: 11, color: "#cbd5e1", padding: "8px 0" }}>未配置</div>}
              </div>
            ))}
            <button onClick={() => { const newId = Date.now(); const newMember = { id: newId, name: "新しい乗務員", role: "救急救命士", avatar: "新", vehicleId: null }; const newMembers = [...members, newMember]; fbSetMembers(newMembers); setEditingMember(newId); setEditForm({ name: "新しい乗務員", role: "救急救命士" }); }} style={{ width: "100%", background: "#f0fdf4", border: "1.5px dashed #86efac", borderRadius: 12, padding: "13px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#16a34a" }}>＋ 乗務員を追加（控え室へ）</button>
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "#ffffff", borderTop: "1px solid #e2e8f0", display: "flex", padding: "7px 0 14px", boxShadow: "0 -2px 8px rgba(0,0,0,0.06)" }}>
        {[{ id: "home", icon: "⚡", label: "ホーム" }, { id: "chat", icon: "💬", label: "チャット" }, { id: "history", icon: "📋", label: "履歴" }, { id: "settings", icon: "⚙️", label: "設定" }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "5px 0" }}>
            <span style={{ fontSize: 19 }}>{t.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 600, color: tab === t.id ? "#3b82f6" : "#94a3b8" }}>{t.label}</span>
            {tab === t.id && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#3b82f6" }} />}
          </button>
        ))}
      </div>

      {/* Assign Modal */}
      {assigningMember && (() => {
        const member = members.find(m => m.id === assigningMember);
        const zones = [...vehicles, { id: null, label: "控え室", icon: "🏠", color: "#64748b", bg: "#f1f5f9" }];
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 200 }} onClick={() => setAssigningMember(null)}>
            <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 430, padding: "22px 18px 34px", boxShadow: "0 -4px 24px rgba(0,0,0,0.12)" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 4 }}>配置先を選択</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 16 }}>{member?.name}</div>
              {zones.map(zone => (
                <button key={String(zone.id)} onClick={() => assignMember(assigningMember, zone.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: member?.vehicleId === zone.id ? zone.bg : "#f8fafc", border: `1.5px solid ${member?.vehicleId === zone.id ? zone.color : "#e2e8f0"}`, borderRadius: 12, padding: "13px 16px", cursor: "pointer", marginBottom: 8 }}>
                  <span style={{ fontSize: 22 }}>{zone.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: zone.color }}>{zone.label}</span>
                  {member?.vehicleId === zone.id && <span style={{ marginLeft: "auto", fontSize: 11, color: zone.color }}>現在</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Delete Confirm Modal */}
      {confirmDelete && (() => {
        const target = members.find(m => m.id === confirmDelete);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: "0 24px" }} onClick={() => setConfirmDelete(null)}>
            <div style={{ background: "#fff", borderRadius: 16, padding: "24px 20px", width: "100%", maxWidth: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.16)" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 20, textAlign: "center", marginBottom: 8 }}>🗑️</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", textAlign: "center", marginBottom: 6 }}>乗務員を削除</div>
              <div style={{ fontSize: 13, color: "#64748b", textAlign: "center", marginBottom: 20 }}>「{target?.name}」を削除しますか？</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 10, padding: "11px", cursor: "pointer", fontSize: 13, color: "#64748b", fontWeight: 600 }}>キャンセル</button>
                <button onClick={() => { const newMembers = members.filter(m => m.id !== confirmDelete); fbSetMembers(newMembers); setConfirmDelete(null); }} style={{ flex: 1, background: "#ef4444", border: "none", borderRadius: 10, padding: "11px", cursor: "pointer", fontSize: 13, color: "#fff", fontWeight: 700 }}>削除する</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Dispatch Modal */}
      {showModal && (() => {
        const vehicle = vehicles.find(v => v.id === modalVehicleId);
        const actions = VEHICLE_ACTIONS[vehicle?.type] || [];
        const action  = ALL_ACTIONS.find(a => a.id === selectedType);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100 }} onClick={closeModal}>
            <div style={{ background: "#ffffff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 430, padding: "22px 18px 34px", boxShadow: "0 -4px 24px rgba(0,0,0,0.12)" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 13, fontWeight: 700, color: vehicle?.color, marginBottom: 14 }}>{vehicle?.icon} {selectedType ? action?.label : "送信する内容を選択"}</div>
              {!selectedType ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {actions.map(a => (
                    <button key={a.id} onClick={() => setSelectedType(a.id)} style={{ background: `${a.color}08`, border: `1.5px solid ${a.color}30`, borderRadius: 12, padding: "14px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 24 }}>{a.icon}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: a.color }}>{a.label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 5, letterSpacing: 1 }}>📍 目的地（Googleマップ連携）</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <input value={dispatchLocation} onChange={e => setDispatchLocation(e.target.value)} placeholder="住所・場所名を入力　例：渋谷区道玄坂1-1" style={{ flex: 1, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: "11px 13px", color: "#1e293b", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                    <button onClick={getCurrentLocation} style={{ flexShrink: 0, background: locationLoading ? "#f1f5f9" : "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: "0 12px", cursor: locationLoading ? "not-allowed" : "pointer", fontSize: 18, color: locationLoading ? "#94a3b8" : "#16a34a" }}>{locationLoading ? "⏳" : "📍"}</button>
                  </div>
                  {dispatchLocation && dispatchLocation.match(/^-?\d+\.\d+,-?\d+\.\d+$/) && <div style={{ fontSize: 10, color: "#16a34a", marginBottom: 6 }}>✅ 現在地を取得しました</div>}
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 5, letterSpacing: 1 }}>📝 メモ（任意）</div>
                  <input value={dispatchNote} onChange={e => setDispatchNote(e.target.value)} placeholder="例：3名負傷・意識あり" style={{ width: "100%", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 12, padding: "11px 13px", color: "#1e293b", fontSize: 13, outline: "none", marginBottom: 12, boxSizing: "border-box" }} />
                  <button onClick={() => sendDispatch(selectedType)} style={{ width: "100%", background: action?.color, border: "none", borderRadius: 12, padding: "13px", cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 8 }}>送信する</button>
                  <button onClick={() => setSelectedType(null)} style={{ width: "100%", background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 12, padding: "6px" }}>← 戻る</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
