function effectiveDaily({deployment=250,recommended=250,owner=250,overrideActive=false,overrideLimit=0,strict=false}) {
  if (strict) return 0;
  const health = overrideActive ? Math.min(deployment, overrideLimit || recommended) : Math.min(deployment, recommended);
  return Math.max(0, Math.min(deployment, health, owner));
}
function actualRun({campaignMax,settingsRun,remainingDaily,recipients}) {
  const requested = campaignMax || settingsRun;
  return Math.max(0, Math.min(requested, remainingDaily, recipients));
}
const cases = [
  ['new sender owner chooses lower', effectiveDaily({owner:100}), 100],
  ['health recommendation limits without override', effectiveDaily({recommended:100,owner:150}), 100],
  ['owner override still respects owner daily max', effectiveDaily({recommended:100,owner:150,overrideActive:true,overrideLimit:200}), 150],
  ['strict disable cannot be bypassed', effectiveDaily({recommended:50,owner:250,overrideActive:true,overrideLimit:250,strict:true}), 0],
  ['campaign 60 with 20 remaining runs 20', actualRun({campaignMax:60,settingsRun:25,remainingDaily:20,recipients:100}), 20],
  ['campaign override beats settings per-run default', actualRun({campaignMax:60,settingsRun:25,remainingDaily:100,recipients:100}), 60],
  ['blank campaign max uses settings default', actualRun({campaignMax:0,settingsRun:25,remainingDaily:100,recipients:100}), 25],
];
let failed=0;
for (const [name,actual,expected] of cases) {
  const ok=actual===expected;
  console.log(`${ok?'PASS':'FAIL'}  ${name}: ${actual}`);
  if(!ok) failed++;
}
const rows=20000;
const stagingChunks=Math.ceil(rows/1000);
const workerBatches=Math.ceil(rows/250);
const planOk=stagingChunks===20 && workerBatches===80;
console.log(`${planOk?'PASS':'FAIL'}  20k import plan: ${stagingChunks} fast staging chunks, ${workerBatches} bounded background batches`);
if(!planOk) failed++;
if(failed) process.exit(1);
console.log(`Scout v10.42 behavior model passed (${cases.length+1} checks).`);
