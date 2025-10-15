/**
 * Shelly-Aussenbeleuchtung_mit_Astrosteuerung_V2.1
 * Improved coding standards, readability, and maintainability.
 * For Shelly Plus relay devices.
 */

// Configuration constants
const CONFIG = {
  debug: false,
  relayId: 0,
  scriptId: (typeof Shelly !== "undefined" && typeof Shelly.getCurrentScriptId === "function")
    ? Shelly.getCurrentScriptId() : 1,
  location: { lat: "51.11829868440072", lng: "9.533486384966086" },
  twilight: { morning: "sunrise", evening: "civil_end" },
  guards: { morningRequireRefAfterOn: true, eveningRequireRefBeforeOff: true },
  schedules: {
    weekday: { morning: { enabled: true, onH: 6, onM: 30, offOffsetMin: 10 },
               evening: { enabled: true, onOffsetBeforeRefMin: 10, offH: 22, offM: 0 } },
    weekend: { morning: { enabled: true, onH: 7, onM: 0, offOffsetMin: 10 },
               evening: { enabled: true, onOffsetBeforeRefMin: 10, offH: 22, offM: 0 } }
  },
  kvsKeys: {
    lastEveOn: "ab_last_eve_on_hhmm",
    lastMornOff: "ab_last_morn_off_hhmm",
    lastSuccessDate: "ab_last_success_date"
  },
  httpTimeout: 10000,
  maxRetries: 3,
  retryDelay: 2000,
  startupDelay: 1000,
  rpcTimeout: 5000
};

// Utility functions
const Utils = {
  log: (...args) => { if (CONFIG.debug) print.apply(null, args); },
  pad: n => (n < 10 ? "0" : "") + n,
  clamp: (v, min, max) => Math.min(Math.max(v, min), max),
  normHM: (h, m) => ({ H: ((h % 24) + 24) % 24, M: ((m % 60) + 60) % 60 }),
  cronAllDays: (h, m) => `0 ${m} ${h} * * *`,
  hmsToSec: (h, m, s = 0) => ((h * 60) + m) * 60 + s,
  secToHM: sec => {
    sec = ((sec % 86400) + 86400) % 86400;
    return { H: Math.floor(sec / 3600), M: Math.floor((sec % 3600) / 60) };
  },
  parseHHMM: s => {
    const p = (s || "").split(":");
    if (p.length < 2) return null;
    const h = +p[0], m = +p[1];
    if (isNaN(h) || isNaN(m)) return null;
    return Utils.normHM(h, m);
  },
  isWeekend: d => {
    const day = d.getDay();
    return day === 0 || day === 6;
  },
  formatDate: d => `${d.getFullYear()}-${Utils.pad(d.getMonth() + 1)}-${Utils.pad(d.getDate())}`
};

// Validate configuration
(function validateConfig() {
  const s = CONFIG.schedules;
  ["weekday", "weekend"].forEach(type => {
    const morning = s[type].morning;
    const evening = s[type].evening;
    let hm = Utils.normHM(morning.onH, morning.onM);
    morning.onH = hm.H; morning.onM = hm.M;
    morning.offOffsetMin = Utils.clamp(morning.offOffsetMin, 0, 180);
    evening.onOffsetBeforeRefMin = Utils.clamp(evening.onOffsetBeforeRefMin, 0, 180);
    hm = Utils.normHM(evening.offH, evening.offM);
    evening.offH = hm.H; evening.offM = hm.M;
  });
})();

// RPC queue manager
const RPC = (() => {
  let queue = [], index = 0, busy = false;
  function enqueue(method, params, cb, timeout) {
    queue.push({ method, params: params || {}, cb, timeout: timeout || CONFIG.rpcTimeout });
    pump();
  }
  function pump() {
    if (busy) return;
    if (index >= queue.length) { queue = []; index = 0; return; }
    busy = true;
    const job = queue[index++];
    let timedOut = false;
    let timer = Timer.set(job.timeout, false, () => {
      if (timedOut) return;
      timedOut = true;
      Utils.log("RPC timeout:", job.method);
      try { job.cb && job.cb(null, -1, "timeout"); } catch (e) {}
      busy = false; pump();
    });
    Shelly.call(job.method, job.params, (res, code, msg) => {
      if (timedOut) return;
      if (timer) { Timer.clear(timer); timer = null; }
      try { job.cb && job.cb(res, code, msg); } catch (e) {}
      busy = false; pump();
    }, null);
  }
  return { call: enqueue, pump };
})();

// Job signature helpers
function jobSigTimespec(h, m) { return `0 ${m | 0} ${h | 0} * * *`; }
function jobSigSwitch(h, m, on) { return `SW:${jobSigTimespec(h, m)}:id=${CONFIG.relayId}:on=${on ? 1 : 0}`; }
function jobSigEval(h, m, code) { return `EV:${jobSigTimespec(h, m)}:${code}`; }

function indexJobsBySignature(map) {
  const sigToId = {};
  for (const k in map) {
    if (!map.hasOwnProperty(k)) continue;
    const j = map[k];
    if (!j || !j.calls || !j.calls[0]) continue;
    const call = j.calls[0];
    const ts = j.timespec || "";
    if (call.method === "Switch.Set") {
      const p = call.params || {};
      const sig = `SW:${ts}:id=${p.id}:on=${p.on ? 1 : 0}`;
      sigToId[sig] = String(j.id);
    } else if (call.method === "Script.Eval") {
      const p2 = call.params || {};
      const code = p2.code || "";
      const sig2 = `EV:${ts}:${code}`;
      sigToId[sig2] = String(j.id);
    }
  }
  return sigToId;
}

// Schedule manager
const ScheduleManager = (() => {
  function ensureSwitchAt(h, m, on, existingMap, sigIndex) {
    const desired = {
      timespec: jobSigTimespec(h, m),
      enable: true,
      calls: [{ method: "Switch.Set", params: { id: CONFIG.relayId, on: !!on } }]
    };
    const sig = jobSigSwitch(h, m, on);
    const curId = sigIndex[sig];
    if (curId) {
      const upd = { id: curId, timespec: desired.timespec, enable: true, calls: desired.calls };
      RPC.call("Schedule.Update", upd, (res, code) => { if (code !== 0 && CONFIG.debug) Utils.log("[Sched] Update fail", code); });
      Utils.log("[Sched] switch OK at", h, m, "on=", !!on, "id=", curId);
    } else {
      RPC.call("Schedule.Create", desired, (res, code) => { if (code !== 0 && CONFIG.debug) Utils.log("[Sched] Create fail", code); });
    }
  }
  function ensureEvalAt(h, m, code, existingMap, sigIndex) {
    const desired = {
      timespec: jobSigTimespec(h, m),
      enable: true,
      calls: [{ method: "Script.Eval", params: { id: CONFIG.scriptId, code } }]
    };
    const sig = jobSigEval(h, m, code);
    const curId = sigIndex[sig];
    if (curId) {
      const upd = { id: curId, timespec: desired.timespec, enable: true, calls: desired.calls };
      RPC.call("Schedule.Update", upd, (res, code) => { if (code !== 0 && CONFIG.debug) Utils.log("[Sched] Update fail", code); });
      Utils.log("[Sched] eval OK at", h, m, "id=", curId);
    } else {
      RPC.call("Schedule.Create", desired, (res, code) => { if (code !== 0 && CONFIG.debug) Utils.log("[Sched] Create fail", code); });
    }
  }
  function pruneSwitchForRelayExcept(signatures, existingMap) {
    for (const k in existingMap) {
      if (!existingMap.hasOwnProperty(k)) continue;
      const j = existingMap[k];
      if (!j || !j.calls || !j.calls[0]) continue;
      const c = j.calls[0];
      if (c.method === "Switch.Set") {
        const p = c.params || {};
        if (p.id === CONFIG.relayId) {
          const ts = j.timespec || "";
          const sigOn = `SW:${ts}:id=${p.id}:on=1`;
          const sigOff = `SW:${ts}:id=${p.id}:on=0`;
          const sig = p.on ? sigOn : sigOff;
          if (!signatures[sig]) {
            RPC.call("Schedule.Delete", { id: String(j.id) }, (res, code) => { if (code !== 0 && CONFIG.debug) Utils.log("[Sched] Delete fail", code); });
            Utils.log("[Sched] pruned foreign switch id=", j.id, ts);
          }
        }
      }
    }
  }
  function listAsMap(done) {
    RPC.call("Schedule.List", {}, (list, code) => {
      const map = {};
      if (code === 0 && list && list.jobs) {
        for (let i = 0; i < list.jobs.length; i++) {
          const j = list.jobs[i];
          if (!j) continue;
          map[String(j.id)] = j;
        }
      }
      done(map);
    });
  }
  return { ensureSwitchAt, ensureEvalAt, pruneSwitchForRelayExcept, listAsMap };
})();

// Twilight API
const TwilightAPI = {
  keyMap: {
    sunrise: "sunrise",
    civil_begin: "civil_twilight_begin",
    nautical_begin: "nautical_twilight_begin",
    astronomical_begin: "astronomical_twilight_begin",
    sunset: "sunset",
    civil_end: "civil_twilight_end",
    nautical_end: "nautical_twilight_end",
    astronomical_end: "astronomical_twilight_end"
  },
  fetch(date, cb, retry = 0) {
    const dateStr = Utils.formatDate(date);
    const url = `https://api.sunrise-sunset.org/json?lat=${CONFIG.location.lat}&lng=${CONFIG.location.lng}&formatted=0&date=${dateStr}`;
    Shelly.call("HTTP.GET", { url, timeout: CONFIG.httpTimeout }, (res, code) => {
      if (code !== 0 || !res || res.code !== 200) {
        if (retry < CONFIG.maxRetries) {
          Utils.log("HTTP failed, retry", retry + 1, "code=", code);
          Timer.set(CONFIG.retryDelay, false, () => { TwilightAPI.fetch(date, cb, retry + 1); });
        } else {
          print("HTTP request failed after " + CONFIG.maxRetries + " retries");
          cb(null);
        }
        return;
      }
      let obj;
      try { obj = JSON.parse(res.body || "{}"); }
      catch (e) { print("JSON parse error: " + e); cb(null); return; }
      if (!obj.results) { print("Invalid API response"); cb(null); return; }
      cb(obj.results);
    }, null);
  },
  getKey(ref) { return this.keyMap[ref] || this.keyMap.sunrise; }
};

// RunLock for concurrency control
const RunLock = (() => {
  let locked = false;
  return {
    acquire() { if (locked) return false; locked = true; Utils.log("RunLock acquired"); return true; },
    release() { locked = false; Utils.log("RunLock released"); }
  };
})();

/**
 * Main schedule update logic
 */
function updateSchedulesForToday() {
  if (!RunLock.acquire()) { Utils.log("Update skipped: runlock active"); return; }
  const now = new Date();
  Utils.log("Re-Plan start:", now.toISOString());
  const isWeekend = Utils.isWeekend(now);
  const schedule = CONFIG.schedules[isWeekend ? "weekend" : "weekday"];
  TwilightAPI.fetch(now, results => {
    if (!results) { print("API failed, using fallback"); applySmartFallback(isWeekend, () => { RunLock.release(); }); return; }
    const morningKey = TwilightAPI.getKey(CONFIG.twilight.morning);
    const eveningKey = TwilightAPI.getKey(CONFIG.twilight.evening);
    const morningRef = results[morningKey], eveningRef = results[eveningKey];
    if (!morningRef || !eveningRef) { print("Missing twilight data, using fallback"); applySmartFallback(isWeekend, () => { RunLock.release(); }); return; }
    const morningDate = new Date(morningRef), eveningDate = new Date(eveningRef);
    const refMornSec = Utils.hmsToSec(morningDate.getHours(), morningDate.getMinutes(), 0);
    const refEveSec = Utils.hmsToSec(eveningDate.getHours(), eveningDate.getMinutes(), 0);
    ScheduleManager.listAsMap(existingMap => {
      const sigIndex = indexJobsBySignature(existingMap);
      applySchedulesDiff(schedule, refMornSec, refEveSec, morningDate, eveningDate, existingMap, sigIndex);
      ensureDailyJobs(existingMap, sigIndex);
      RPC.pump(); RunLock.release();
    });
  });
}

/**
 * Apply calculated schedule differences
 */
function applySchedulesDiff(schedule, refMornSec, refEveSec, morningDate, eveningDate, existingMap, sigIndex) {
  const morning = schedule.morning, evening = schedule.evening;
  const mornOnSec = Utils.hmsToSec(morning.onH, morning.onM, 0);
  const eveOffSec = Utils.hmsToSec(evening.offH, evening.offM, 0);
  const desiredSignatures = {};
  const morningAllowed = morning.enabled && (!CONFIG.guards.morningRequireRefAfterOn || refMornSec >= mornOnSec);
  if (morningAllowed) {
    ScheduleManager.ensureSwitchAt(morning.onH, morning.onM, true, existingMap, sigIndex);
    desiredSignatures[jobSigSwitch(morning.onH, morning.onM, true)] = true;
    let offH = morningDate.getHours(), offM = morningDate.getMinutes() + morning.offOffsetMin;
    if (offM >= 60) { offH = (offH + Math.floor(offM / 60)) % 24; offM = offM % 60; }
    ScheduleManager.ensureSwitchAt(offH, offM, false, existingMap, sigIndex);
    desiredSignatures[jobSigSwitch(offH, offM, false)] = true;
    RPC.call("KVS.Set", { key: CONFIG.kvsKeys.lastMornOff, value: Utils.pad(offH) + ":" + Utils.pad(offM) }, () => {});
  }
  const eveningAllowed = evening.enabled && (!CONFIG.guards.eveningRequireRefBeforeOff || refEveSec <= eveOffSec);
  if (eveningAllowed) {
    const onSec = refEveSec - (evening.onOffsetBeforeRefMin * 60);
    const onHM = Utils.secToHM(onSec);
    ScheduleManager.ensureSwitchAt(onHM.H, onHM.M, true, existingMap, sigIndex);
    desiredSignatures[jobSigSwitch(onHM.H, onHM.M, true)] = true;
    ScheduleManager.ensureSwitchAt(evening.offH, evening.offM, false, existingMap, sigIndex);
    desiredSignatures[jobSigSwitch(evening.offH, evening.offM, false)] = true;
    RPC.call("KVS.Set", { key: CONFIG.kvsKeys.lastEveOn, value: Utils.pad(onHM.H) + ":" + Utils.pad(onHM.M) }, () => {});
  }
  RPC.call("KVS.Set", { key: CONFIG.kvsKeys.lastSuccessDate, value: Utils.formatDate(new Date()) }, () => {});
  ScheduleManager.pruneSwitchForRelayExcept(desiredSignatures, existingMap);
}

/**
 * Fallback logic if API fails
 */
function applySmartFallback(isWeekend, done) {
  Utils.log("Applying fallback");
  const schedule = CONFIG.schedules[isWeekend ? "weekend" : "weekday"];
  ScheduleManager.listAsMap(existingMap => {
    const sigIndex = indexJobsBySignature(existingMap);
    const desiredSignatures = {};
    if (schedule.morning.enabled) {
      ScheduleManager.ensureSwitchAt(schedule.morning.onH, schedule.morning.onM, true, existingMap, sigIndex);
      desiredSignatures[jobSigSwitch(schedule.morning.onH, schedule.morning.onM, true)] = true;
    }
    if (schedule.evening.enabled) {
      ScheduleManager.ensureSwitchAt(schedule.evening.offH, schedule.evening.offM, false, existingMap, sigIndex);
      desiredSignatures[jobSigSwitch(schedule.evening.offH, schedule.evening.offM, false)] = true;
    }
    function handleEveningOn(next) {
      if (!schedule.evening.enabled) { next(); return; }
      RPC.call("KVS.Get", { key: CONFIG.kvsKeys.lastEveOn }, (res, code) => {
        const time = (code === 0 && res && res.value) ? Utils.parseHHMM(res.value) : null;
        let h, m;
        if (time) { h = time.H; m = time.M; }
        else { h = (schedule.evening.offH + 24 - 2) % 24; m = schedule.evening.offM; }
        ScheduleManager.ensureSwitchAt(h, m, true, existingMap, sigIndex);
        desiredSignatures[jobSigSwitch(h, m, true)] = true;
        next();
      });
    }
    function handleMorningOff(next) {
      if (!schedule.morning.enabled) { next(); return; }
      RPC.call("KVS.Get", { key: CONFIG.kvsKeys.lastMornOff }, (res, code) => {
        const time = (code === 0 && res && res.value) ? Utils.parseHHMM(res.value) : null;
        let offH, offM;
        if (time) { offH = time.H; offM = time.M; }
        else {
          offM = schedule.morning.onM + schedule.morning.offOffsetMin;
          offH = schedule.morning.onH;
          if (offM >= 60) { offH = (offH + Math.floor(offM / 60)) % 24; offM = offM % 60; }
        }
        ScheduleManager.ensureSwitchAt(offH, offM, false, existingMap, sigIndex);
        desiredSignatures[jobSigSwitch(offH, offM, false)] = true;
        next();
      });
    }
    handleEveningOn(() => {
      handleMorningOff(() => {
        ensureDailyJobs(existingMap, sigIndex);
        RPC.call("KVS.Set", { key: CONFIG.kvsKeys.lastSuccessDate, value: Utils.formatDate(new Date()) }, () => {});
        ScheduleManager.pruneSwitchForRelayExcept(desiredSignatures, existingMap);
        RPC.pump();
        if (done) done();
      });
    });
  });
}

/**
 * Ensure daily maintenance jobs are scheduled
 */
function ensureDailyJobs(existingMap, sigIndex) {
  ScheduleManager.ensureEvalAt(0, 5, "updateSchedulesForToday();", existingMap, sigIndex);
  ScheduleManager.ensureEvalAt(0, 10, "guardCheckAndReplan();", existingMap, sigIndex);
  if (CONFIG.debug === true) {
    ScheduleManager.ensureEvalAt(0, 15, "printCurrentScheduleStatus();", existingMap, sigIndex);
  } else {
    for (const k in existingMap) {
      if (!existingMap.hasOwnProperty(k)) continue;
      const j = existingMap[k];
      if (!j || !j.calls || !j.calls[0]) continue;
      const c = j.calls[0];
      if (c.method === "Script.Eval" && (c.params && c.params.code) === "printCurrentScheduleStatus();") {
        RPC.call("Schedule.Delete", { id: String(j.id) }, () => {});
      }
    }
  }
}

/**
 * Guard check and replan if needed
 */
function guardCheckAndReplan() {
  RPC.call("KVS.Get", { key: CONFIG.kvsKeys.lastSuccessDate }, (kv, code) => {
    const today = Utils.formatDate(new Date());
    const lastDate = (code === 0 && kv && kv.value) ? kv.value : null;
    if (lastDate !== today) { Utils.log("Guard: date mismatch -> forcing replan"); updateSchedulesForToday(); return; }
    RPC.call("Schedule.List", {}, (list, lcode) => {
      if (lcode !== 0 || !list || !list.jobs) { Utils.log("Guard: Schedule.List failed -> forcing replan"); updateSchedulesForToday(); return; }
      let found = false;
      for (let i = 0; i < list.jobs.length; i++) {
        const j = list.jobs[i];
        if (!j || !j.calls || !j.calls[0]) continue;
        const c = j.calls[0];
        if (c.method === "Switch.Set" && (c.params && c.params.id) === CONFIG.relayId) { found = true; break; }
      }
      if (!found) { Utils.log("Guard: no day jobs for this relay -> forcing replan"); updateSchedulesForToday(); }
      else { Utils.log("Guard: OK"); }
    });
  });
}

/**
 * Print current schedule status
 */
function printCurrentScheduleStatus() {
  print("=== Schedule Status ===");
  RPC.call("Schedule.List", {}, (r, code) => {
    if (code !== 0) { print("Error: code=" + code); return; }
    if (r && r.jobs && r.jobs.length > 0) {
      for (let i = 0; i < r.jobs.length; i++) {
        const j = r.jobs[i];
        if (!j) continue;
        try {
          const status = j.enable ? "EN" : "DIS";
          const method = (j.calls && j.calls[0]) ? j.calls[0].method : "?";
          print(`• #${j.id} ${status} ${j.timespec} ${method}`);
        } catch (ex) {}
      }
    } else { print("No jobs"); }
    print("=== End ===");
  });
}

/**
 * Cleanup jobs on startup
 */
function cleanupOnStartup(next) {
  RPC.call("Schedule.List", {}, (list, code) => {
    if (code !== 0 || !list || !list.jobs) { if (next) Timer.set(500, false, next); return; }
    for (let i = 0; i < list.jobs.length; i++) {
      const j = list.jobs[i];
      if (!j || !j.calls || !j.calls[0]) continue;
      const c = j.calls[0];
      if (c.method === "Script.Eval") {
        const cs = (c.params && c.params.code) || "";
        if (cs.indexOf("updateSchedulesForToday()") >= 0 ||
            cs.indexOf("guardCheckAndReplan()") >= 0 ||
            cs.indexOf("printCurrentScheduleStatus()") >= 0) {
          RPC.call("Schedule.Delete", { id: String(j.id) }, () => {});
        }
      }
    }
    for (let k = 0; k < list.jobs.length; k++) {
      const jj = list.jobs[k];
      if (!jj || !jj.calls || !jj.calls[0]) continue;
      const cc = jj.calls[0];
      if (cc.method === "Switch.Set") {
        const p = cc.params || {};
        if (p.id === CONFIG.relayId) {
          RPC.call("Schedule.Delete", { id: String(jj.id) }, () => {});
        }
      }
    }
    if (next) Timer.set(500, false, next);
  });
}

// Startup sequence
cleanupOnStartup(() => {
  Timer.set(CONFIG.startupDelay, false, () => {
    updateSchedulesForToday();
    RPC.pump();
  });
});