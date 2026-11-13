(() => {
  "use strict";
  // Change this if your backend runs somewhere else.
  const API_BASE = "https://mental-health-score-hv5r.onrender.com";
  const CIRC = 779.2; // 2 * pi * 124

  const $ = (id) => document.getElementById(id);
  const form = $("predict-form"), submitBtn = $("submit-btn");
  const fill = $("ring-fill"), numEl = $("score-number"), bandEl = $("score-band"), ctxEl = $("score-context"), statusEl = $("status");

  // ---- sliders: label text + filled track
  const sliders = [
    ["avg_daily_usage_hours", "o-usage", (v) => v.toFixed(1) + " h"],
    ["sleep_hours_per_night", "o-sleep", (v) => v.toFixed(1) + " h"],
    ["study_hours", "o-study", (v) => v.toFixed(1) + " h"],
    ["physical_activity_hours", "o-act", (v) => v.toFixed(1) + " h"],
    ["daily_unlocks", "o-unl", (v) => String(Math.round(v))],
  ];
  function syncSlider([id, out, fmt]) {
    const el = $(id), v = parseFloat(el.value);
    $(out).textContent = fmt(v);
    el.style.setProperty("--p", ((v - el.min) / (el.max - el.min)) * 100 + "%");
  }
  sliders.forEach((s) => { syncSlider(s); $(s[0]).addEventListener("input", () => { syncSlider(s); schedule(); }); });

  // ---- stress segmented control
  const segBtns = document.querySelectorAll(".seg-btn");
  segBtns.forEach((b) => b.addEventListener("click", () => {
    segBtns.forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $("stress_level").value = b.dataset.value;
    schedule();
  }));

  // ---- validation
  const RULES = { age: [18, 24], avg_daily_usage_hours: [0, 24], daily_unlocks: [0, Infinity], study_hours: [0, 24], physical_activity_hours: [0, 24], sleep_hours_per_night: [0, 24] };
  function setErr(el, msg) { const f = el.closest(".field"); if (!f) return; f.classList.toggle("field-error", !!msg); const m = f.querySelector(".error-msg"); if (m) m.textContent = msg || ""; }
  function collect() {
    return {
      age: parseInt($("age").value, 10),
      gender: $("gender").value,
      country: $("country").value.trim(),
      academic_level: $("academic_level").value,
      most_used_platform: $("most_used_platform").value,
      purpose_of_use: $("purpose_of_use").value,
      avg_daily_usage_hours: parseFloat($("avg_daily_usage_hours").value),
      daily_unlocks: parseInt($("daily_unlocks").value, 10),
      study_hours: parseFloat($("study_hours").value),
      physical_activity_hours: parseFloat($("physical_activity_hours").value),
      sleep_hours_per_night: parseFloat($("sleep_hours_per_night").value),
      stress_level: $("stress_level").value,
    };
  }
  function validate(p) {
    let ok = true;
    ["age", "country"].forEach((k) => setErr($(k), ""));
    const a = RULES.age;
    if (Number.isNaN(p.age) || p.age < a[0] || p.age > a[1]) { setErr($("age"), `Enter an age from ${a[0]} to ${a[1]}.`); ok = false; }
    if (!p.country) { setErr($("country"), "Enter a country."); ok = false; }
    return ok;
  }

  // ---- result rendering
  function bandFor(s) {
    if (s < 4) return ["Strained right now", "Small shifts in sleep or screen time can go a long way."];
    if (s < 7) return ["Balanced and steady", "Your rhythm looks fairly steady, with some room to recover."];
    return ["Strong and resilient", "Your habits point to a well-supported baseline. Keep it up."];
  }
  let shown = 0, raf = null, goal = 0;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function paintNum(v) { numEl.textContent = v.toFixed(2); }
  function step() { shown += (goal - shown) * 0.16; if (Math.abs(goal - shown) < 0.004) { shown = goal; raf = null; } else raf = requestAnimationFrame(step); paintNum(shown); }
  function render(score) {
    const c = Math.max(0, Math.min(10, score)), [b, t] = bandFor(c);
    bandEl.textContent = b; ctxEl.textContent = t; statusEl.textContent = ""; statusEl.classList.remove("err");
    fill.style.strokeDashoffset = String(CIRC * (1 - c / 10));
    goal = score;
    if (reduce) { shown = score; paintNum(score); } else if (!raf) raf = requestAnimationFrame(step);
  }
    function showError(msg) {
    statusEl.textContent = msg; statusEl.classList.add("err");
    if (!/\d/.test(numEl.textContent)) {   // no score has been shown yet
      bandEl.textContent = "We couldn't read your signal";
      ctxEl.textContent = "Please try again in a moment.";
    }
  }

  // ---- API
  let seq = 0;
  async function predict() {
    const p = collect();
    if (!validate(p)) return;
    const mine = ++seq;
    submitBtn.disabled = true; if (!statusEl.classList.contains("err")) statusEl.textContent = "Updating…";
    try {
      const res = await fetch(`${API_BASE}/predict`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
      if (mine !== seq) return;
      if (res.status === 422) { showError("The server rejected one of the answers. Please check them and try again."); return; }
      if (!res.ok) { showError(`The server responded with status ${res.status}.`); return; }
      const data = await res.json();
      if (typeof data.predicted_mental_health_score !== "number") { showError("The server replied without a score."); return; }
      render(data.predicted_mental_health_score);
    } catch (e) {
      if (mine === seq) showError("Can't reach the server right now. Please check your connection and try again.");
    } finally {
      if (mine === seq) submitBtn.disabled = false;
    }
  }
  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(predict, 300); }

  form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); predict(); });
  ["age", "gender", "country", "academic_level", "most_used_platform", "purpose_of_use"].forEach((id) => {
    $(id).addEventListener("input", schedule); $(id).addEventListener("change", schedule);
  });

  predict(); // first reading on load
})();
