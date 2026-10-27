#!/usr/bin/env node
'use strict';
// Offline estimator only. Never accesses Supabase or client data.
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','player.js'),'utf8');

function activePollIntervals(text=source) {
  const block=text.match(/const BACKGROUND_POLL_INTERVALS = Object\.freeze\(\{([\s\S]*?)\}\);/);
  if(!block)throw Error('Polling intervals were not found');
  return Object.fromEntries(['commands','manifest','heartbeat'].map(name=>{
    const item=block[1].match(new RegExp('\\b'+name+'\\s*:\\s*([0-9_]+)'));
    if(!item)throw Error('Missing '+name);
    return [name,Number(item[1].replace(/_/g,''))];
  }));
}

function estimate({tvs,days=30,freeMonthlyCalls=500_000,headroom=0.3,intervals=activePollIntervals(),otherCalls=0}){
  if(!Number.isInteger(tvs)||tvs<0||!Number.isInteger(days)||days<1||days>31||
     !Number.isFinite(otherCalls)||otherCalls<0||headroom<0||headroom>=1)
    throw Error('Invalid capacity scenario');
  const perDeviceDaily=Object.entries(intervals).reduce((acc,[name,ms])=>{
    if(!Number.isFinite(ms)||ms<=0)throw Error('Invalid '+name+' interval');
    return acc+Math.ceil(86400000/ms);
  },0);
  const monthlyDeviceCalls=tvs*perDeviceDaily*days;
  const estimatedTotal=monthlyDeviceCalls+otherCalls;
  const target=freeMonthlyCalls*(1-headroom);
  return {tvs,days,perDeviceDaily,monthlyDeviceCalls,otherCalls,estimatedTotal,
    freeMonthlyCalls,operationalTarget:target,withinHeadroom:estimatedTotal<=target,
    withinPublishedLimit:estimatedTotal<=freeMonthlyCalls};
}

if(require.main===module){
  const tvs=Number(process.argv[2]||2);
  const otherCalls=Number(process.argv[3]||0);
  const results=[tvs,5,10,30,50].filter((n,i,arr)=>arr.indexOf(n)===i).map(n=>estimate({tvs:n,otherCalls}));
  console.log(JSON.stringify({warning:'Calculated periodic client requests only; not official billable invocations. Add other workloads and check Supabase Usage.',scenarios:results},null,2));
}
module.exports={activePollIntervals,estimate};
