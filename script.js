(() => {
  "use strict";
  // Change this if your backend runs somewhere else.
  const API_BASE = "https://mental-health-score-hv5r.onrender.com";
  const CIRC = 779.2; // 2 * pi * 124
  const REQUEST_TIMEOUT_MS = 70000; // Render free plan can take up to a minute to wake up
  const SLOW_HINT_MS = 4000;        // after this, tell the user the server is waking up

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
  function syncStress() {
    segBtns.forEach((x) => {
      const on = x.dataset.value === $("stress_level").value;
      x.classList.toggle("active", on);
      x.setAttribute("aria-pressed", String(on));
    });
  }
  segBtns.forEach((b) => b.addEventListener("click", () => {
    $("stress_level").value = b.dataset.value;
    syncStress();
    schedule();
  }));
  syncStress();

  // ---- validation
  const AGE = [18, 24];
  const COUNTRY_MAX = 60;
  function setErr(el, msg) { const f = el.closest(".field"); if (!f) return; f.classList.toggle("field-error", !!msg); const m = f.querySelector(".error-msg"); if (m) m.textContent = msg || ""; }
  function collect() {
    return {
      age: Number($("age").value),
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
    if ($("age").value.trim() === "" || !Number.isInteger(p.age) || p.age < AGE[0] || p.age > AGE[1]) {
      setErr($("age"), `Enter a whole number from ${AGE[0]} to ${AGE[1]}.`); ok = false;
    }
    if (!p.country) { setErr($("country"), "Enter a country."); ok = false; }
    else if (p.country.length > COUNTRY_MAX) { setErr($("country"), `Use at most ${COUNTRY_MAX} characters.`); ok = false; }
    return ok;
  }

  // ---- result rendering
  // Bands follow the quartiles of Mental_Health_Score in the dataset:
  // bottom 25% is below 5.1, top 25% is 7.1 or above.
  const BAND_LOW = 5.1, BAND_HIGH = 7.1;
  function bandFor(s) {
    if (s < BAND_LOW) return ["Strained right now", "Lower than most students in the data. Small shifts in sleep or screen time can go a long way."];
    if (s < BAND_HIGH) return ["Balanced and steady", "In the middle range of students in the data, with some room to recover."];
    return ["Strong and resilient", "Higher than most students in the data. Your habits point to a well-supported baseline."];
  }
  let shown = 0, raf = null, goal = 0, hasScore = false;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function paintNum(v) { numEl.textContent = v.toFixed(2); }
  function step() { shown += (goal - shown) * 0.16; if (Math.abs(goal - shown) < 0.004) { shown = goal; raf = null; } else raf = requestAnimationFrame(step); paintNum(shown); }
  function setStatus(msg, isErr) { statusEl.textContent = msg; statusEl.classList.toggle("err", !!isErr); }
  function render(score) {
    const c = Math.max(0, Math.min(10, score)), [b, t] = bandFor(c);
    bandEl.textContent = b; ctxEl.textContent = t; setStatus("", false);
    fill.style.strokeDashoffset = String(CIRC * (1 - c / 10));
    goal = c; hasScore = true;
    if (reduce) { shown = c; paintNum(c); } else if (!raf) raf = requestAnimationFrame(step);
  }
  function showError(msg) {
    setStatus(msg, true);
    if (!hasScore) {
      bandEl.textContent = "We couldn't read your signal";
      ctxEl.textContent = "Please try again in a moment.";
    }
  }
  async function errorDetail(res) {
    try {
      const body = await res.json();
      if (Array.isArray(body.detail) && body.detail.length && body.detail[0].msg) {
        return body.detail[0].msg.replace(/^Value error, /, "");
      }
    } catch (_) { /* body was not JSON */ }
    return "";
  }

  // ---- API
  let seq = 0, controller = null;
  async function predict() {
    const p = collect();
    if (!validate(p)) { setStatus("Fix the highlighted field to update your score.", true); return; }
    const mine = ++seq;
    if (controller) controller.abort();         // cancel the older request, only the newest one matters
    controller = new AbortController();
    const ctrl = controller;
    const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const slow = setTimeout(() => { if (mine === seq) setStatus("Waking up the server. This can take up to a minute the first time…", false); }, SLOW_HINT_MS);
    submitBtn.disabled = true;
    setStatus("Updating…", false);
    try {
      const res = await fetch(`${API_BASE}/predict`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p), signal: ctrl.signal });
      if (mine !== seq) return;
      if (res.status === 422) {
        const detail = await errorDetail(res);
        if (mine !== seq) return;
        showError(detail ? `The server rejected an answer: ${detail}` : "The server rejected one of the answers. Please check them and try again.");
        return;
      }
      if (!res.ok) { showError(`The server responded with status ${res.status}. Please try again.`); return; }
      const data = await res.json();
      if (mine !== seq) return;
      if (typeof data.predicted_mental_health_score !== "number") { showError("The server replied without a score."); return; }
      render(data.predicted_mental_health_score);
    } catch (e) {
      if (mine !== seq) return;                  // aborted because a newer request started
      if (e.name === "AbortError") showError("The server took too long to answer. Please try again.");
      else showError("Can't reach the server right now. Please check your connection and try again.");
    } finally {
      clearTimeout(timeout); clearTimeout(slow);
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
