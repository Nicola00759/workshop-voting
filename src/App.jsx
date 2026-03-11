import { useState, useEffect } from "react";
import { ref, set, onValue, remove } from "firebase/database";
import { db } from "./firebase";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer
} from "recharts";

const C = {
  bg: "#F7F6F3", surface: "#FFFFFF", border: "#E5E4DF",
  text: "#1A1918", muted: "#6B6965", faint: "#AEACA7",
  danger: "#B91C1C"
};
const COLORS = ["#1E3A5F","#7B3F00","#1A4731","#4A1942","#374151","#5C3317","#0D3B66","#4B3832"];

function scheduleIdeas(ids, cfg) {
  const starts = {}, visited = new Set();
  const visit = (id, depth = 0) => {
    if (depth > ids.length || visited.has(id)) return;
    const deps = (cfg[id]?.deps || []).filter(d => ids.includes(d));
    deps.forEach(d => visit(d, depth + 1));
    visited.add(id);
    const depEnd = deps.length
      ? Math.max(...deps.map(d => (starts[d] || 0) + (cfg[d]?.duration || 2)))
      : 0;
    starts[id] = depEnd;
  };
  ids.forEach(id => visit(id));
  return starts;
}

function GanttChart({ ids, ideas, cfg, schedule, totalWeeks }) {
  const ROW_H = 46, LABEL_W = 170, PAD = 16;
  const WEEK_W = Math.max(32, Math.min(64, Math.floor(640 / totalWeeks)));
  const H = ids.length * ROW_H + 40 + PAD * 2;
  const W = LABEL_W + totalWeeks * WEEK_W + PAD;
  const bounds = id => {
    const s = schedule[id] || 0, dur = cfg[id]?.duration || 2, idx = ids.indexOf(id);
    return { x: LABEL_W + PAD + s * WEEK_W, y: PAD + 40 + idx * ROW_H, w: dur * WEEK_W, mid: PAD + 40 + idx * ROW_H + ROW_H / 2 };
  };
  return (
    <svg width={W} height={H} style={{ display: "block", minWidth: W }}>
      <defs>
        <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill={C.faint} />
        </marker>
      </defs>
      {Array.from({ length: totalWeeks }).map((_, w) => (
        <g key={w}>
          <rect x={LABEL_W + PAD + w * WEEK_W} y={PAD} width={WEEK_W} height={32}
            fill={w % 2 === 0 ? "#FAFAF8" : "#F3F2EF"} stroke={C.border} strokeWidth={0.5} />
          <text x={LABEL_W + PAD + w * WEEK_W + WEEK_W / 2} y={PAD + 20}
            textAnchor="middle" fontSize={10} fill={C.faint} fontFamily="-apple-system,sans-serif">W{w + 1}</text>
        </g>
      ))}
      {ids.map((id, i) => {
        const idea = ideas.find(ii => ii.id === id);
        const color = COLORS[ideas.findIndex(ii => ii.id === id) % COLORS.length];
        const { x, y, w } = bounds(id);
        return (
          <g key={id}>
            <rect x={0} y={y} width={W} height={ROW_H} fill={i % 2 === 0 ? "#FAFAF8" : "#F7F6F3"} />
            <text x={10} y={y + ROW_H / 2 + 4} fontSize={12} fill={C.text}
              fontFamily="-apple-system,sans-serif" fontWeight={500}>
              {idea?.name?.length > 20 ? idea.name.slice(0, 20) + "…" : idea?.name}
            </text>
            <rect x={x + 2} y={y + 9} width={Math.max(w - 4, 4)} height={ROW_H - 18} rx={4} fill={color} opacity={0.9} />
            {w > 32 && (
              <text x={x + w / 2} y={y + ROW_H / 2 + 4} textAnchor="middle"
                fontSize={10} fill="white" fontFamily="-apple-system,sans-serif" fontWeight={600}>
                {cfg[id]?.duration || 2}w
              </text>
            )}
          </g>
        );
      })}
      {ids.map(id =>
        (cfg[id]?.deps || []).filter(d => ids.includes(d)).map(depId => {
          const fr = bounds(depId), to = bounds(id);
          const mx = (fr.x + fr.w + to.x) / 2;
          return (
            <path key={`${depId}-${id}`}
              d={`M${fr.x + fr.w},${fr.mid} C${mx},${fr.mid} ${mx},${to.mid} ${to.x},${to.mid}`}
              fill="none" stroke={C.faint} strokeWidth={1.5} strokeDasharray="4 3" markerEnd="url(#arr)" />
          );
        })
      )}
      {Array.from({ length: totalWeeks + 1 }).map((_, w) => (
        <line key={w} x1={LABEL_W + PAD + w * WEEK_W} y1={PAD + 32}
          x2={LABEL_W + PAD + w * WEEK_W} y2={H} stroke={C.border} strokeWidth={0.5} />
      ))}
      <line x1={LABEL_W + PAD - 1} y1={0} x2={LABEL_W + PAD - 1} y2={H} stroke={C.border} strokeWidth={1} />
    </svg>
  );
}

export default function App() {
  const [view, setView] = useState("admin");
  const [ideas, setIdeas] = useState([]);
  const [votes, setVotes] = useState({});
  const [roadmap, setRoadmap] = useState({});
  const [newIdea, setNewIdea] = useState("");
  const [participant, setParticipant] = useState("");
  const [curVotes, setCurVotes] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (window.location.hash === "#vote") setView("vote");
  }, []);

  useEffect(() => {
    const unsubs = [];
    unsubs.push(onValue(ref(db, "ideas"), snap => {
      const val = snap.val();
      setIdeas(val ? Object.values(val) : []);
      setLoading(false);
    }));
    unsubs.push(onValue(ref(db, "votes"), snap => setVotes(snap.val() || {})));
    unsubs.push(onValue(ref(db, "roadmap"), snap => setRoadmap(snap.val() || {})));
    return () => unsubs.forEach(u => u());
  }, []);

  const saveIdeas = list => set(ref(db, "ideas"), Object.fromEntries(list.map(i => [i.id, i])));
  const saveRoadmap = r => set(ref(db, "roadmap"), r);

  const addIdea = () => {
    if (!newIdea.trim()) return;
    saveIdeas([...ideas, { id: Date.now().toString(), name: newIdea.trim() }]);
    setNewIdea("");
  };

  const removeIdea = id => {
    saveIdeas(ideas.filter(i => i.id !== id));
    remove(ref(db, `votes/${id}`));
    const r = { ...roadmap }; delete r[id]; saveRoadmap(r);
  };

  const submitVotes = () => {
    if (!participant.trim()) return;
    const p = participant.trim();
    ideas.forEach(idea => {
      set(ref(db, `votes/${idea.id}/${p.replace(/[.#$[\]]/g, "_")}`), {
        participant: p,
        rilevanza: curVotes[idea.id]?.rilevanza || 0,
        aspettativa: curVotes[idea.id]?.aspettativa || 0
      });
    });
    setSubmitted(true);
  };

  const resetVotes = () => { remove(ref(db, "votes")); setConfirmReset(false); };

  const allVoted = participant.trim() && ideas.length > 0 &&
    ideas.every(i => curVotes[i.id]?.rilevanza && curVotes[i.id]?.aspettativa);

  const votesFlat = Object.entries(votes).flatMap(([ideaId, byP]) =>
    Object.values(byP || {}).map(v => ({ ...v, ideaId }))
  );
  const uniqueP = [...new Set(votesFlat.map(v => v.participant))];

  const chartData = ideas.map((idea, i) => {
    const iv = votesFlat.filter(v => v.ideaId === idea.id);
    if (!iv.length) return null;
    const avgR = iv.reduce((s, v) => s + v.rilevanza, 0) / iv.length;
    const avgA = iv.reduce((s, v) => s + v.aspettativa, 0) / iv.length;
    return { id: idea.id, name: idea.name, x: Math.round(avgR * 10) / 10, y: Math.round(avgA * 10) / 10, votes: iv.length, color: COLORS[i % COLORS.length] };
  }).filter(Boolean);

  const sortedData = [...chartData].sort((a, b) => (b.x + b.y) - (a.x + a.y));
  const selectedIds = Object.keys(roadmap).filter(id => roadmap[id]?.selected);
  const schedule = selectedIds.length > 0 ? scheduleIdeas(selectedIds, roadmap) : {};
  const totalWeeks = selectedIds.length > 0
    ? Math.max(...selectedIds.map(id => (schedule[id] || 0) + (roadmap[id]?.duration || 2))) : 0;

  const toggleSelect = id => {
    const cur = roadmap[id]?.selected;
    if (!cur && selectedIds.length >= 5) return;
    saveRoadmap({ ...roadmap, [id]: { ...(roadmap[id] || { duration: 2, deps: [] }), selected: !cur } });
  };
  const updateField = (id, f, v) =>
    saveRoadmap({ ...roadmap, [id]: { ...(roadmap[id] || { duration: 2, deps: [], selected: true }), [f]: v } });

  const baseUrl = window.location.href.split("#")[0];
  const voteUrl = `${baseUrl}#vote`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=10&data=${encodeURIComponent(voteUrl)}`;

  const inp = { padding: "8px 11px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box", background: C.surface, color: C.text, fontFamily: "inherit" };
  const btn = (v = "primary") => ({ padding: "8px 16px", background: v === "primary" ? C.text : v === "danger" ? C.danger : C.surface, color: v === "secondary" ? C.text : "#fff", border: v === "secondary" ? `1px solid ${C.border}` : "none", borderRadius: 6, cursor: "pointer", fontWeight: 500, fontSize: 13, fontFamily: "inherit" });
  const lbl = { fontSize: 11, fontWeight: 600, color: C.muted, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" };
  const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "18px 22px", marginBottom: 12 };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: C.muted, fontSize: 13, fontFamily: "-apple-system,sans-serif" }}>
      Caricamento…
    </div>
  );

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',sans-serif", minHeight: "100vh", background: C.bg, color: C.text }}>

      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, position: "sticky", top: 0, zIndex: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>Workshop Voting</span>
        <nav style={{ display: "flex" }}>
          {[["admin","Admin"],["vote","Vota"],["results","Risultati"],["roadmap","Roadmap"]].map(([v, l]) => (
            <button key={v} onClick={() => { setView(v); setSubmitted(false); }}
              style={{ padding: "0 14px", height: 52, border: "none", borderBottom: view === v ? `2px solid ${C.text}` : "2px solid transparent", background: "transparent", color: view === v ? C.text : C.muted, fontSize: 13, fontWeight: view === v ? 600 : 400, cursor: "pointer", fontFamily: "inherit" }}>
              {l}
            </button>
          ))}
        </nav>
        <span style={{ fontSize: 11, color: C.faint }}>{ideas.length} idee · {uniqueP.length} partecipanti</span>
      </div>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 20px" }}>

        {view === "admin" && <>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 20px", letterSpacing: "-0.01em" }}>Gestione idee</h2>
          <div style={{ ...card, background: C.text, border: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "white", marginBottom: 6 }}>Link e QR Code per i partecipanti</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6, marginBottom: 10 }}>
                  Condividi questo link o proietta il QR code. I partecipanti accedono direttamente alla scheda di votazione.
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", wordBreak: "break-all" }}>{voteUrl}</div>
              </div>
              <img src={qrUrl} alt="QR Code" style={{ width: 160, height: 160, borderRadius: 8, flexShrink: 0 }} />
            </div>
          </div>
          <div style={card}>
            <label style={lbl}>Nuova idea</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={newIdea} onChange={e => setNewIdea(e.target.value)} onKeyDown={e => e.key === "Enter" && addIdea()} placeholder="Titolo dell'idea…" style={inp} />
              <button onClick={addIdea} style={{ ...btn("primary"), whiteSpace: "nowrap" }}>Aggiungi</button>
            </div>
          </div>
          {ideas.length === 0
            ? <div style={{ textAlign: "center", padding: "44px 0", color: C.muted, fontSize: 13, border: `1px dashed ${C.border}`, borderRadius: 8 }}>Nessuna idea. Inizia aggiungendone alcune.</div>
            : <div style={card}>
              <label style={lbl}>Idee ({ideas.length})</label>
              {ideas.map((idea, i) => {
                const cnt = [...new Set(votesFlat.filter(v => v.ideaId === idea.id).map(v => v.participant))].length;
                return (
                  <div key={idea.id} style={{ display: "flex", alignItems: "center", padding: "9px 0", borderBottom: i < ideas.length - 1 ? `1px solid ${C.border}` : "none" }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: COLORS[i % COLORS.length], marginRight: 10, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13 }}>{idea.name}</span>
                    <span style={{ fontSize: 11, color: C.faint, marginRight: 14 }}>{cnt} voto/i</span>
                    <button onClick={() => removeIdea(idea.id)} style={{ background: "none", border: "none", cursor: "pointer", color: C.faint, fontSize: 17, lineHeight: 1, padding: "0 2px" }}>×</button>
                  </div>
                );
              })}
            </div>}
          {votesFlat.length > 0 && (
            <div style={{ ...card, background: "#FEF9F9", border: `1px solid #FED7D7` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.danger, marginBottom: 4 }}>Reset voti</div>
              <div style={{ fontSize: 13, color: "#7F1D1D", marginBottom: 12 }}>{votesFlat.length} voti da {uniqueP.length} partecipanti. Azione irreversibile.</div>
              {!confirmReset
                ? <button onClick={() => setConfirmReset(true)} style={btn("danger")}>Azzera tutti i voti</button>
                : <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "#7F1D1D" }}>Sei sicuro?</span>
                  <button onClick={resetVotes} style={btn("danger")}>Conferma</button>
                  <button onClick={() => setConfirmReset(false)} style={btn("secondary")}>Annulla</button>
                </div>}
            </div>
          )}
        </>}

        {view === "vote" && <>
          {submitted
            ? <div style={{ textAlign: "center", padding: "64px 0" }}>
              <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#F0FDF4", border: "1px solid #BBF7D0", margin: "0 auto 18px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#166534" }}>✓</div>
              <h3 style={{ fontWeight: 600, margin: "0 0 8px", fontSize: 16 }}>Voto registrato</h3>
              <p style={{ color: C.muted, fontSize: 13, margin: "0 0 24px" }}>Grazie, {participant}. Il tuo contributo è stato salvato.</p>
              <button onClick={() => { setSubmitted(false); setParticipant(""); setCurVotes({}); }} style={btn("primary")}>Nuovo votante</button>
            </div>
            : <>
              <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 6px", letterSpacing: "-0.01em" }}>Scheda di votazione</h2>
              <p style={{ fontSize: 13, color: C.muted, margin: "0 0 20px" }}>Valuta ogni idea da 1 (basso) a 5 (alto).</p>
              <div style={card}>
                <label style={lbl}>Il tuo nome</label>
                <input value={participant} onChange={e => setParticipant(e.target.value)} placeholder="Nome e cognome" style={{ ...inp, maxWidth: 280 }} />
              </div>
              {ideas.length === 0
                ? <div style={{ color: C.muted, fontSize: 13, padding: 24, textAlign: "center" }}>Nessuna idea disponibile. Attendi che il facilitatore le inserisca.</div>
                : <>
                  {ideas.map((idea, i) => {
                    const col = COLORS[i % COLORS.length];
                    return (
                      <div key={idea.id} style={{ ...card, borderLeft: `3px solid ${col}`, paddingLeft: 18 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>{idea.name}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                          {[["rilevanza","Rilevanza","Pertinenza agli obiettivi"],["aspettativa","Aspettativa","Probabilità di risultati concreti"]].map(([key, label, desc]) => (
                            <div key={key}>
                              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{label}</div>
                              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>{desc}</div>
                              <div style={{ display: "flex", gap: 4 }}>
                                {[1,2,3,4,5].map(n => {
                                  const sel = curVotes[idea.id]?.[key] === n;
                                  return <button key={n} onClick={() => setCurVotes(p => ({ ...p, [idea.id]: { ...p[idea.id], [key]: n } }))}
                                    style={{ width: 36, height: 36, borderRadius: 5, border: sel ? `1.5px solid ${col}` : `1px solid ${C.border}`, background: sel ? col : C.surface, color: sel ? "white" : C.muted, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>{n}</button>;
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <button onClick={submitVotes} disabled={!allVoted}
                    style={{ ...btn(allVoted ? "primary" : "secondary"), width: "100%", padding: "12px 0", fontSize: 14, marginTop: 4, cursor: allVoted ? "pointer" : "not-allowed", opacity: allVoted ? 1 : 0.45 }}>
                    Invia voto
                  </button>
                </>}
            </>}
        </>}

        {view === "results" && <>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 20px", letterSpacing: "-0.01em" }}>Risultati</h2>
          {chartData.length === 0
            ? <div style={{ textAlign: "center", padding: "44px 0", color: C.muted, fontSize: 13, border: `1px dashed ${C.border}`, borderRadius: 8 }}>Nessun voto ancora.</div>
            : <>
              <div style={card}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 22 }}>
                  {[["Priorità","Alta rilevanza + Alta aspettativa","#F0FDF4","#166534"],["Da esplorare","Alta rilevanza + Bassa aspettativa","#EFF6FF","#1E40AF"],["Rischioso","Bassa rilevanza + Alta aspettativa","#FEFCE8","#854D0E"],["Bassa priorità","Bassa rilevanza + Bassa aspettativa","#FEF9F9","#9B1C1C"]].map(([t,d,bg,tc]) => (
                    <div key={t} style={{ background: bg, borderRadius: 6, padding: "9px 12px" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: tc, marginBottom: 2 }}>{t}</div>
                      <div style={{ fontSize: 11, color: C.muted }}>{d}</div>
                    </div>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={380}>
                  <ScatterChart margin={{ top: 16, right: 24, bottom: 28, left: 8 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#EBEBEB" />
                    <XAxis type="number" dataKey="x" domain={[0.5,5.5]} ticks={[1,2,3,4,5]} name="Rilevanza"
                      label={{ value: "Rilevanza", position: "insideBottom", offset: -12, style: { fill: C.muted, fontSize: 12 } }} tick={{ fontSize: 11, fill: C.faint }} />
                    <YAxis type="number" dataKey="y" domain={[0.5,5.5]} ticks={[1,2,3,4,5]} name="Aspettativa"
                      label={{ value: "Aspettativa", angle: -90, position: "insideLeft", offset: 16, style: { fill: C.muted, fontSize: 12 } }} tick={{ fontSize: 11, fill: C.faint }} />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: "10px 14px", borderRadius: 6, fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.07)" }}>
                        <div style={{ fontWeight: 600, color: d.color, marginBottom: 6 }}>{d.name}</div>
                        <div style={{ color: C.muted }}>Rilevanza: <b style={{ color: C.text }}>{d.x}</b></div>
                        <div style={{ color: C.muted }}>Aspettativa: <b style={{ color: C.text }}>{d.y}</b></div>
                        <div style={{ color: C.faint, marginTop: 4, fontSize: 11 }}>{d.votes} voto/i</div>
                      </div>;
                    }} />
                    <ReferenceLine x={3} stroke={C.border} strokeWidth={1.5} />
                    <ReferenceLine y={3} stroke={C.border} strokeWidth={1.5} />
                    <Scatter data={chartData} shape={({ cx, cy, payload }) => (
                      <g>
                        <circle cx={cx} cy={cy} r={22} fill={payload.color} opacity={0.85} />
                        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={9} fontWeight={600}>
                          {payload.name.length > 9 ? payload.name.slice(0, 9) + "…" : payload.name}
                        </text>
                      </g>
                    )} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div style={card}>
                <label style={lbl}>Classifica</label>
                {sortedData.map((d, i) => (
                  <div key={d.id} style={{ display: "flex", alignItems: "center", padding: "9px 0", borderBottom: i < sortedData.length - 1 ? `1px solid ${C.border}` : "none" }}>
                    <span style={{ width: 20, fontSize: 12, fontWeight: 600, color: i < 3 ? C.text : C.faint }}>{i + 1}</span>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: d.color, marginRight: 10 }} />
                    <span style={{ flex: 1, fontSize: 13 }}>{d.name}</span>
                    <span style={{ fontSize: 11, color: C.muted, marginRight: 12 }}>R {d.x} · A {d.y}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{Math.round((d.x + d.y) * 10) / 10}</span>
                  </div>
                ))}
              </div>
              <div style={card}>
                <label style={lbl}>Partecipanti ({uniqueP.length})</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {uniqueP.map(p => <span key={p} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 20, padding: "4px 11px", fontSize: 12, color: C.muted }}>{p}</span>)}
                </div>
              </div>
            </>}
        </>}

        {view === "roadmap" && <>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 20px", letterSpacing: "-0.01em" }}>Roadmap</h2>
          {sortedData.length === 0
            ? <div style={{ textAlign: "center", padding: "44px 0", color: C.muted, fontSize: 13, border: `1px dashed ${C.border}`, borderRadius: 8 }}>Prima di pianificare, i partecipanti devono votare.</div>
            : <>
              <div style={card}>
                <label style={lbl}>Seleziona le idee da pianificare (max 5)</label>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Ordinate per punteggio.</div>
                {sortedData.map((d, i) => {
                  const isSel = !!roadmap[d.id]?.selected, canSel = isSel || selectedIds.length < 5;
                  return (
                    <div key={d.id} style={{ display: "flex", alignItems: "center", padding: "9px 0", borderBottom: i < sortedData.length - 1 ? `1px solid ${C.border}` : "none", opacity: !canSel ? 0.38 : 1 }}>
                      <input type="checkbox" checked={isSel} onChange={() => canSel && toggleSelect(d.id)} style={{ marginRight: 10, cursor: canSel ? "pointer" : "not-allowed", accentColor: C.text, width: 14, height: 14 }} />
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: d.color, marginRight: 10 }} />
                      <span style={{ flex: 1, fontSize: 13 }}>{d.name}</span>
                      <span style={{ fontSize: 11, color: C.faint }}>R {d.x} · A {d.y} · {Math.round((d.x + d.y) * 10) / 10}</span>
                    </div>
                  );
                })}
              </div>
              {selectedIds.length > 0 && (
                <div style={card}>
                  <label style={lbl}>Durata e dipendenze</label>
                  {selectedIds.map((id, si) => {
                    const idea = ideas.find(i => i.id === id), cfg = roadmap[id] || { duration: 2, deps: [] };
                    return (
                      <div key={id} style={{ padding: "14px 0", borderBottom: si < selectedIds.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{idea?.name}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 24, alignItems: "start" }}>
                          <div>
                            <label style={lbl}>Durata (settimane)</label>
                            <input type="number" min={1} max={52} value={cfg.duration || 2}
                              onChange={e => updateField(id, "duration", Math.max(1, parseInt(e.target.value) || 1))}
                              style={{ ...inp, width: 72 }} />
                          </div>
                          <div>
                            <label style={lbl}>Inizia dopo</label>
                            {selectedIds.filter(s => s !== id).length === 0
                              ? <span style={{ fontSize: 12, color: C.faint, fontStyle: "italic" }}>Nessun'altra idea selezionata</span>
                              : <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {selectedIds.filter(s => s !== id).map(sid => {
                                  const dep = ideas.find(i => i.id === sid), isDep = (cfg.deps || []).includes(sid);
                                  return dep ? <button key={sid} onClick={() => {
                                    const deps = cfg.deps || [];
                                    updateField(id, "deps", isDep ? deps.filter(d => d !== sid) : [...deps, sid]);
                                  }} style={{ padding: "5px 11px", borderRadius: 4, border: `1px solid ${isDep ? C.text : C.border}`, background: isDep ? C.text : C.surface, color: isDep ? "white" : C.muted, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: isDep ? 500 : 400 }}>{dep.name}</button> : null;
                                })}
                              </div>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {selectedIds.length > 0 && totalWeeks > 0 && (
                <div style={{ ...card, overflowX: "auto" }}>
                  <label style={lbl}>Gantt — settimane</label>
                  <div style={{ marginTop: 12 }}>
                    <GanttChart ids={selectedIds} ideas={ideas} cfg={roadmap} schedule={schedule} totalWeeks={totalWeeks} />
                  </div>
                </div>
              )}
            </>}
        </>}

      </div>
    </div>
  );
}
