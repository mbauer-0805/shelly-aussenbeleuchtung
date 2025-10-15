/* Shelly-Aussenbeleuchtung_mit_Astrosteuerung_V2.0 - ID-less scheduling (compat tweaks)
 
*/

/*** ====== ATTRIBUTION ====== ***/
var CONFIG = {
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

var Utils = {
  log: function(){ if (CONFIG.debug) print.apply(null, arguments); },
  pad: function(n){ return (n < 10 ? "0" : "") + n; },
  clamp: function(v,min,max){ return v < min ? min : (v > max ? max : v); },
  normHM: function(h,m){ h=((h%24)+24)%24; m=((m%60)+60)%60; return {H:h,M:m}; },
  cronAllDays: function(h,m){ return "0 " + m + " " + h + " * * *"; },
  hmsToSec: function(h,m,s){ return ((h*60)+m)*60 + (s||0); },
  secToHM: function(sec){ sec=((sec%86400)+86400)%86400; var H=(sec/3600)|0; var M=((sec%3600)/60)|0; return {H:H,M:M}; },
  parseHHMM: function(s){ var p=(s||"").split(":"); if(p.length<2)return null; var h=+p[0],m=+p[1]; if(isNaN(h)||isNaN(m))return null; return this.normHM(h,m); },
  isWeekend: function(d){ var day=d.getDay(); return day===0||day===6; },
  formatDate: function(d){ return d.getFullYear()+"-"+this.pad(d.getMonth()+1)+"-"+this.pad(d.getDate()); }
};

(function validateConfig(){
  var s=CONFIG.schedules;
  ["weekday","weekend"].forEach(function(t){
    var morning=s[t].morning; var evening=s[t].evening;
    var hm=Utils.normHM(morning.onH,morning.onM); morning.onH=hm.H; morning.onM=hm.M;
    morning.offOffsetMin=Utils.clamp(morning.offOffsetMin,0,180);
    evening.onOffsetBeforeRefMin=Utils.clamp(evening.onOffsetBeforeRefMin,0,180);
    hm=Utils.normHM(evening.offH,evening.offM); evening.offH=hm.H; evening.offM=hm.M;
  });
})();

var RPC=(function(){
  var q=[],i=0,busy=false;
  function enqueue(method,params,cb,timeout){
    q.push({method:method,params:params||{},cb:cb,timeout:timeout||CONFIG.rpcTimeout});
    pump();
  }
  function pump(){
    if(busy) return;
    if(i>=q.length){ q=[]; i=0; return; }
    busy=true;
    var job=q[i++]; var timedOut=false; var t=null;
    t=Timer.set(job.timeout,false,function(){
      if(timedOut) return; timedOut=true; Utils.log("RPC timeout:",job.method);
      try{ job.cb&&job.cb(null,-1,"timeout"); }catch(e){}
      busy=false; pump();
    });
    Shelly.call(job.method, job.params, function(res,code,msg){
      if(timedOut) return;
      if(t){ Timer.clear(t); t=null; }
      try{ job.cb&&job.cb(res,code,msg); }catch(e){}
      busy=false; pump();
    }, null);
  }
  return { call:enqueue, pump:pump };
})();

function jobSigTimespec(h,m){ return "0 " + (m|0) + " " + (h|0) + " * * *"; }
function jobSigSwitch(h,m,on){ return "SW:" + jobSigTimespec(h,m) + ":id=" + CONFIG.relayId + ":on=" + (on?1:0); }
function jobSigEval(h,m,code){ return "EV:" + jobSigTimespec(h,m) + ":" + code; }

function indexJobsBySignature(map){
  var sigToId={};
  for(var k in map){
    if(!map.hasOwnProperty(k)) continue;
    var j=map[k]; if(!j||!j.calls||!j.calls[0]) continue;
    var call=j.calls[0]; var ts=j.timespec||"";
    if(call.method==="Switch.Set"){
      var p=call.params||{};
      var sig="SW:"+ts+":id="+p.id+":on="+(p.on?1:0);
      sigToId[sig]=String(j.id);
    } else if(call.method==="Script.Eval"){
      var p2=call.params||{}; var code=(p2.code||"");
      var sig2="EV:"+ts+":"+code;
      sigToId[sig2]=String(j.id);
    }
  }
  return sigToId;
}

var ScheduleManager=(function(){
  function ensureSwitchAt(h,m,on,existingMap,sigIndex){
    var desired={ timespec:jobSigTimespec(h,m), enable:true,
      calls:[{method:"Switch.Set", params:{id:CONFIG.relayId, on:!!on}}] };
    var sig=jobSigSwitch(h,m,on); var curId=sigIndex[sig];
    if(curId){
      var upd={ id:curId, timespec:desired.timespec, enable:true,
        calls:[{method:"Switch.Set", params:{id:CONFIG.relayId, on:!!on}}] };
      RPC.call("Schedule.Update", upd, function(res,code){ if(code!==0&&CONFIG.debug) Utils.log("[Sched] Update fail",code); });
      Utils.log("[Sched] switch OK at",h,m,"on=",!!on,"id=",curId);
    } else {
      RPC.call("Schedule.Create", desired, function(res,code){ if(code!==0&&CONFIG.debug) Utils.log("[Sched] Create fail",code); });
    }
  }
  function ensureEvalAt(h,m,code,existingMap,sigIndex){
    var desired={ timespec:jobSigTimespec(h,m), enable:true,
      calls:[{method:"Script.Eval", params:{id:CONFIG.scriptId, code:code}}] };
    var sig=jobSigEval(h,m,code); var curId=sigIndex[sig];
    if(curId){
      var upd={ id:curId, timespec:desired.timespec, enable:true,
        calls:[{method:"Script.Eval", params:{id:CONFIG.scriptId, code:code}}] };
      RPC.call("Schedule.Update", upd, function(res,code){ if(code!==0&&CONFIG.debug) Utils.log("[Sched] Update fail",code); });
      Utils.log("[Sched] eval OK at",h,m,"id=",curId);
    } else {
      RPC.call("Schedule.Create", desired, function(res,code){ if(code!==0&&CONFIG.debug) Utils.log("[Sched] Create fail",code); });
    }
  }
  function pruneSwitchForRelayExcept(signatures, existingMap){
    for(var k in existingMap){
      if(!existingMap.hasOwnProperty(k)) continue;
      var j=existingMap[k]; if(!j||!j.calls||!j.calls[0]) continue;
      var c=j.calls[0];
      if(c.method==="Switch.Set"){
        var p=c.params||{};
        if(p.id===CONFIG.relayId){
          var ts=j.timespec||"";
          var sigOn="SW:"+ts+":id="+p.id+":on=1";
          var sigOff="SW:"+ts+":id="+p.id+":on=0";
          var sig=p.on?sigOn:sigOff;
          if(!signatures[sig]){
            RPC.call("Schedule.Delete",{id:String(j.id)},function(res,code){ if(code!==0&&CONFIG.debug) Utils.log("[Sched] Delete fail",code); });
            Utils.log("[Sched] pruned foreign switch id=",j.id,ts);
          }
        }
      }
    }
  }
  function listAsMap(done){
    RPC.call("Schedule.List",{},function(list,code){
      var map={};
      if(code===0 && list && list.jobs){
        for(var i=0;i<list.jobs.length;i++){ var j=list.jobs[i]; if(!j) continue; map[String(j.id)]=j; }
      }
      done(map);
    });
  }
  return { ensureSwitchAt:ensureSwitchAt, ensureEvalAt:ensureEvalAt, pruneSwitchForRelayExcept:pruneSwitchForRelayExcept, listAsMap:listAsMap };
})();

var TwilightAPI={
  keyMap:{ sunrise:"sunrise", civil_begin:"civil_twilight_begin", nautical_begin:"nautical_twilight_begin",
           astronomical_begin:"astronomical_twilight_begin", sunset:"sunset", civil_end:"civil_twilight_end",
           nautical_end:"nautical_twilight_end", astronomical_end:"astronomical_twilight_end" },
  fetch:function(date,cb,retry){
    retry=retry||0;
    var dateStr=Utils.formatDate(date);
    var url="https://api.sunrise-sunset.org/json?lat="+CONFIG.location.lat+"&lng="+CONFIG.location.lng+"&formatted=0&date="+dateStr;
    var self=this;
    Shelly.call("HTTP.GET",{url:url,timeout:CONFIG.httpTimeout},function(res,code){
      if(code!==0||!res||res.code!==200){
        if(retry<CONFIG.maxRetries){
          Utils.log("HTTP failed, retry",retry+1,"code=",code);
          Timer.set(CONFIG.retryDelay,false,function(){ self.fetch(date,cb,retry+1); });
        } else { print("HTTP request failed after "+CONFIG.maxRetries+" retries"); cb(null); }
        return;
      }
      var obj; try{ obj=JSON.parse(res.body||"{}"); }catch(e){ print("JSON parse error: "+e); cb(null); return; }
      if(!obj.results){ print("Invalid API response"); cb(null); return; }
      cb(obj.results);
    }, null);
  },
  getKey:function(ref){ return this.keyMap[ref]||this.keyMap.sunrise; }
};

var RunLock=(function(){ var locked=false; return {
  acquire:function(){ if(locked) return false; locked=true; Utils.log("RunLock acquired"); return true; },
  release:function(){ locked=false; Utils.log("RunLock released"); }
};})();

function updateSchedulesForToday(){
  if(!RunLock.acquire()){ Utils.log("Update skipped: runlock active"); return; }
  var now=new Date(); Utils.log("Re-Plan start:",now.toISOString());
  var isWeekend=Utils.isWeekend(now);
  var schedule=CONFIG.schedules[isWeekend?"weekend":"weekday"];
  TwilightAPI.fetch(now,function(results){
    if(!results){ print("API failed, using fallback"); applySmartFallback(isWeekend,function(){ RunLock.release(); }); return; }
    var morningKey=TwilightAPI.getKey(CONFIG.twilight.morning);
    var eveningKey=TwilightAPI.getKey(CONFIG.twilight.evening);
    var morningRef=results[morningKey]; var eveningRef=results[eveningKey];
    if(!morningRef||!eveningRef){ print("Missing twilight data, using fallback"); applySmartFallback(isWeekend,function(){ RunLock.release(); }); return; }
    var morningDate=new Date(morningRef); var eveningDate=new Date(eveningRef);
    var refMornSec=Utils.hmsToSec(morningDate.getHours(), morningDate.getMinutes(), 0);
    var refEveSec =Utils.hmsToSec(eveningDate.getHours(), eveningDate.getMinutes(), 0);
    ScheduleManager.listAsMap(function(existingMap){
      var sigIndex=indexJobsBySignature(existingMap);
      applySchedulesDiff(schedule,refMornSec,refEveSec,morningDate,eveningDate,existingMap,sigIndex);
      ensureDailyJobs(existingMap,sigIndex);
      RPC.pump(); RunLock.release();
    });
  });
}

function applySchedulesDiff(schedule, refMornSec, refEveSec, morningDate, eveningDate, existingMap, sigIndex){
  var morning=schedule.morning; var evening=schedule.evening;
  var mornOnSec=Utils.hmsToSec(morning.onH,morning.onM,0);
  var eveOffSec=Utils.hmsToSec(evening.offH,evening.offM,0);
  var desiredSignatures={};
  var morningAllowed= morning.enabled && (!CONFIG.guards.morningRequireRefAfterOn || refMornSec>=mornOnSec);
  if(morningAllowed){
    ScheduleManager.ensureSwitchAt(morning.onH,morning.onM,true,existingMap,sigIndex);
    desiredSignatures[jobSigSwitch(morning.onH,morning.onM,true)]=true;
    var offH=morningDate.getHours(); var offM=morningDate.getMinutes()+morning.offOffsetMin;
    if(offM>=60){ offH=(offH+Math.floor(offM/60))%24; offM=offM%60; }
    ScheduleManager.ensureSwitchAt(offH,offM,false,existingMap,sigIndex);
    desiredSignatures[jobSigSwitch(offH,offM,false)]=true;
    RPC.call("KVS.Set",{key:CONFIG.kvsKeys.lastMornOff, value:Utils.pad(offH)+":"+Utils.pad(offM)},function(){});
  }
  var eveningAllowed= evening.enabled && (!CONFIG.guards.eveningRequireRefBeforeOff || refEveSec<=eveOffSec);
  if(eveningAllowed){
    var onSec=refEveSec - (evening.onOffsetBeforeRefMin*60);
    var onHM=Utils.secToHM(onSec);
    ScheduleManager.ensureSwitchAt(onHM.H,onHM.M,true,existingMap,sigIndex);
    desiredSignatures[jobSigSwitch(onHM.H,onHM.M,true)]=true;
    ScheduleManager.ensureSwitchAt(evening.offH,evening.offM,false,existingMap,sigIndex);
    desiredSignatures[jobSigSwitch(evening.offH,evening.offM,false)]=true;
    RPC.call("KVS.Set",{key:CONFIG.kvsKeys.lastEveOn, value:Utils.pad(onHM.H)+":"+Utils.pad(onHM.M)},function(){});
  }
  RPC.call("KVS.Set",{key:CONFIG.kvsKeys.lastSuccessDate, value:Utils.formatDate(new Date())},function(){});
  ScheduleManager.pruneSwitchForRelayExcept(desiredSignatures, existingMap);
}

function applySmartFallback(isWeekend, done){
  Utils.log("Applying fallback");
  var schedule=CONFIG.schedules[isWeekend?"weekend":"weekday"];
  ScheduleManager.listAsMap(function(existingMap){
    var sigIndex=indexJobsBySignature(existingMap);
    var desiredSignatures={};
    if(schedule.morning.enabled){
      ScheduleManager.ensureSwitchAt(schedule.morning.onH, schedule.morning.onM, true, existingMap, sigIndex);
      desiredSignatures[jobSigSwitch(schedule.morning.onH, schedule.morning.onM, true)]=true;
    }
    if(schedule.evening.enabled){
      ScheduleManager.ensureSwitchAt(schedule.evening.offH, schedule.evening.offM, false, existingMap, sigIndex);
      desiredSignatures[jobSigSwitch(schedule.evening.offH, schedule.evening.offM, false)]=true;
    }
    function handleEveningOn(next){
      if(!schedule.evening.enabled){ next(); return; }
      RPC.call("KVS.Get",{key:CONFIG.kvsKeys.lastEveOn},function(res,code){
        var time=(code===0 && res && res.value) ? Utils.parseHHMM(res.value) : null;
        var h,m; if(time){ h=time.H; m=time.M; } else { h=(schedule.evening.offH+24-2)%24; m=schedule.evening.offM; }
        ScheduleManager.ensureSwitchAt(h,m,true,existingMap,sigIndex);
        desiredSignatures[jobSigSwitch(h,m,true)]=true;
        next();
      });
    }
    function handleMorningOff(next){
      if(!schedule.morning.enabled){ next(); return; }
      RPC.call("KVS.Get",{key:CONFIG.kvsKeys.lastMornOff},function(res,code){
        var time=(code===0 && res && res.value) ? Utils.parseHHMM(res.value) : null;
        var offH,offM;
        if(time){ offH=time.H; offM=time.M; }
        else { offM=schedule.morning.onM+schedule.morning.offOffsetMin; offH=schedule.morning.onH; if(offM>=60){ offH=(offH+Math.floor(offM/60))%24; offM=offM%60; } }
        ScheduleManager.ensureSwitchAt(offH,offM,false,existingMap,sigIndex);
        desiredSignatures[jobSigSwitch(offH,offM,false)]=true;
        next();
      });
    }
    handleEveningOn(function(){
      handleMorningOff(function(){
        ensureDailyJobs(existingMap,sigIndex);
        RPC.call("KVS.Set",{key:CONFIG.kvsKeys.lastSuccessDate, value:Utils.formatDate(new Date())},function(){});
        ScheduleManager.pruneSwitchForRelayExcept(desiredSignatures, existingMap);
        RPC.pump();
        if(done) done();
      });
    });
  });
}

function ensureDailyJobs(existingMap, sigIndex){
  ScheduleManager.ensureEvalAt(0,5,"updateSchedulesForToday();",existingMap,sigIndex);
  ScheduleManager.ensureEvalAt(0,10,"guardCheckAndReplan();",existingMap,sigIndex);
  if(CONFIG.debug===true){
    ScheduleManager.ensureEvalAt(0,15,"printCurrentScheduleStatus();",existingMap,sigIndex);
  } else {
    for(var k in existingMap){
      if(!existingMap.hasOwnProperty(k)) continue;
      var j=existingMap[k]; if(!j||!j.calls||!j.calls[0]) continue;
      var c=j.calls[0];
      if(c.method==="Script.Eval" && (c.params&&c.params.code)==="printCurrentScheduleStatus();"){
        RPC.call("Schedule.Delete",{id:String(j.id)},function(){});
      }
    }
  }
}

function guardCheckAndReplan(){
  RPC.call("KVS.Get",{ key:CONFIG.kvsKeys.lastSuccessDate }, function(kv,code){
    var today=Utils.formatDate(new Date());
    var lastDate=(code===0 && kv && kv.value) ? kv.value : null;
    if(lastDate!==today){ Utils.log("Guard: date mismatch -> forcing replan"); updateSchedulesForToday(); return; }
    RPC.call("Schedule.List",{},function(list,lcode){
      if(lcode!==0 || !list || !list.jobs){ Utils.log("Guard: Schedule.List failed -> forcing replan"); updateSchedulesForToday(); return; }
      var found=false;
      for(var i=0;i<list.jobs.length;i++){
        var j=list.jobs[i]; if(!j||!j.calls||!j.calls[0]) continue;
        var c=j.calls[0]; if(c.method==="Switch.Set" && (c.params&&c.params.id)===CONFIG.relayId){ found=true; break; }
      }
      if(!found){ Utils.log("Guard: no day jobs for this relay -> forcing replan"); updateSchedulesForToday(); }
      else { Utils.log("Guard: OK"); }
    });
  });
}

function printCurrentScheduleStatus(){
  print("=== Schedule Status ===");
  RPC.call("Schedule.List",{},function(r,code){
    if(code!==0){ print("Error: code="+code); return; }
    if(r && r.jobs && r.jobs.length>0){
      for(var i=0;i<r.jobs.length;i++){
        var j=r.jobs[i]; if(!j) continue;
        try{
          var status=j.enable ? "EN" : "DIS";
          var method=(j.calls && j.calls[0]) ? j.calls[0].method : "?";
          print("• #"+j.id+" "+status+" "+j.timespec+" "+method);
        }catch(ex){}
      }
    } else { print("No jobs"); }
    print("=== End ===");
  });
}

function cleanupOnStartup(next){
  RPC.call("Schedule.List",{},function(list,code){
    if(code!==0 || !list || !list.jobs){ if(next) Timer.set(500,false,next); return; }
    for(var i=0;i<list.jobs.length;i++){
      var j=list.jobs[i]; if(!j||!j.calls||!j.calls[0]) continue;
      var c=j.calls[0];
      if(c.method==="Script.Eval"){
        var cs=(c.params&&c.params.code)||"";
        if(cs.indexOf("updateSchedulesForToday()")>=0 ||
           cs.indexOf("guardCheckAndReplan()")>=0   ||
           cs.indexOf("printCurrentScheduleStatus()")>=0){
          RPC.call("Schedule.Delete",{id:String(j.id)},function(){});
        }
      }
    }
    for(var k=0;k<list.jobs.length;k++){
      var jj=list.jobs[k]; if(!jj||!jj.calls||!jj.calls[0]) continue;
      var cc=jj.calls[0];
      if(cc.method==="Switch.Set"){
        var p=cc.params||{};
        if(p.id===CONFIG.relayId){
          RPC.call("Schedule.Delete",{id:String(jj.id)},function(){});
        }
      }
    }
    if(next) Timer.set(500,false,next);
  });
}

cleanupOnStartup(function(){
  Timer.set(CONFIG.startupDelay,false,function(){
    updateSchedulesForToday();
    RPC.pump();
  });
});