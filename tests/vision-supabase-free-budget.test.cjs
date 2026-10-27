const {test}=require('node:test');
const assert=require('node:assert/strict');
const {estimate,activePollIntervals}=require('../scripts/vision-supabase-free-budget.cjs');

test('estimator reads actual player intervals instead of invented assumptions',()=>{
  assert.deepEqual(activePollIntervals(),{heartbeat:120000,manifest:120000,commands:45000});
});
test('traffic for two online TVs at 24/7 matches periodic request estimate',()=>{
  const result=estimate({tvs:2});
  assert.equal(result.perDeviceDaily,3360);
  assert.equal(result.monthlyDeviceCalls,201600);
  assert.equal(result.withinHeadroom,true);
});
test('free tier must not be falsely promised to 5 or 33 always-online TVs',()=>{
  const five=estimate({tvs:5});
  const thirtyThree=estimate({tvs:33});
  assert.ok(five.monthlyDeviceCalls>500000);
  assert.ok(thirtyThree.monthlyDeviceCalls>3000000);
  assert.equal(five.withinPublishedLimit,false);
  assert.equal(thirtyThree.withinHeadroom,false);
});
test('non-player invocations consume remaining shared allowance',()=>{
  const v=estimate({tvs:3,otherCalls:70000});
  assert.equal(v.estimatedTotal,372400);
  assert.equal(v.withinHeadroom,false);
  assert.equal(v.withinPublishedLimit,true);
});
test('reject nonsense device counts',()=>{
  for(const n of [-1,NaN,2.4])assert.throws(()=>estimate({tvs:n}),/Invalid capacity/);
});
